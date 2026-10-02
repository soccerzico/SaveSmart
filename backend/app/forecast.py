"""Forward balance projection and the expected-transaction calendar.

The past half of the timeline comes from `transactions_service` (real ledger,
replayed backwards). This module owns the future half: it walks each recurring
item forward and applies it to today's balance, day by day, so the chart is one
continuous series across "then" and "next".

Recurring items carry no explicit start date - only `created_at` - so that is
the anchor every cadence steps from. An item created on the 15th recurs on the
15th. This is a real limitation, not a modelling choice: if a user's paycheck
actually lands on the 1st but they entered it on the 15th, the forecast is two
weeks out of phase until the schema grows a proper anchor date.
"""
import calendar as _calendar
from datetime import date, datetime, timedelta, timezone

from .models import Account, RecurringTransaction, Transaction
from .transfers import MIN_CENTS, PROVISIONAL_DAYS, effective_dates

# How many days one step of each cadence advances. Month-based cadences are
# handled by calendar arithmetic instead (see _add_months), so that a monthly
# item on the 31st doesn't drift backwards through short months.
_DAY_STEPS = {"weekly": 7, "biweekly": 14}
_MONTH_STEPS = {"monthly": 1, "quarterly": 3, "annually": 12}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _add_months(anchor: date, months: int) -> date:
    """Advance a date by whole months, clamping to the target month's length.

    Jan 31 + 1 month is Feb 28 (or 29), not Mar 3. Clamping from the original
    anchor each time - rather than stepping month by month off the last result -
    keeps a 31st-of-the-month item on the 31st in every month that has one.
    """
    total = anchor.month - 1 + months
    year = anchor.year + total // 12
    month = total % 12 + 1
    last_day = _calendar.monthrange(year, month)[1]
    return date(year, month, min(anchor.day, last_day))


def occurrences(item: RecurringTransaction, start: date, end: date) -> list:
    """Every date in [start, end] this recurring item is expected to land on."""
    anchor = (item.created_at or _utcnow()).date()
    hits = []

    if item.frequency in _DAY_STEPS:
        step = _DAY_STEPS[item.frequency]
        # Jump straight to the first occurrence at or after `start` rather than
        # looping from the anchor, which may be years back.
        if anchor < start:
            gap = (start - anchor).days
            current = anchor + timedelta(days=((gap + step - 1) // step) * step)
        else:
            current = anchor
        while current <= end:
            if current >= start:
                hits.append(current)
            current += timedelta(days=step)
        return hits

    months = _MONTH_STEPS.get(item.frequency)
    if not months:
        return hits

    index = 0
    current = anchor
    if anchor < start:
        # Approximate the starting index, then walk back a step to be safe.
        rough = (start.year - anchor.year) * 12 + (start.month - anchor.month)
        index = max(0, (rough // months) * months)
        current = _add_months(anchor, index)
        while current < start:
            index += months
            current = _add_months(anchor, index)
    while current <= end:
        if current >= start:
            hits.append(current)
        index += months
        current = _add_months(anchor, index)
    return hits


def expected_events(user_id: int, start: date, end: date) -> list:
    """Projected recurring income/expenses over a window, one entry per landing."""
    items = RecurringTransaction.query.filter_by(user_id=user_id).all()
    events = []
    for item in items:
        for day in occurrences(item, start, end):
            events.append(
                {
                    "date": day.isoformat(),
                    "name": item.name,
                    "direction": item.direction,
                    "amount": round(item.amount_cents / 100, 2),
                    "frequency": item.frequency,
                    "actual": False,
                }
            )
    events.sort(key=lambda e: (e["date"], e["name"]))
    return events


def current_net_worth_cents(user_id: int) -> int:
    accounts = Account.query.filter_by(user_id=user_id).all()
    assets = sum(a.balance_cents for a in accounts if not a.is_liability)
    liabilities = sum(a.balance_cents for a in accounts if a.is_liability)
    return assets - liabilities


def forecast_daily_balances(user_id: int, days: int = 90, today: date = None) -> list:
    """Project net worth forward one point per day, starting tomorrow.

    Today itself belongs to the reconstructed series, so the forecast starts the
    following day and carries today's balance as its opening value - the two
    halves meet without duplicating or skipping a point.

    `today` is the user's local date. Defaulting to UTC puts "today" a day ahead
    every US evening, which shifts the seam between history and forecast.
    """
    today = today or _utcnow().date()
    start = today + timedelta(days=1)
    end = today + timedelta(days=days)

    by_day = {}
    for event in expected_events(user_id, start, end):
        delta = round(event["amount"] * 100)
        if event["direction"] == "expense":
            delta = -delta
        by_day[event["date"]] = by_day.get(event["date"], 0) + delta

    running = current_net_worth_cents(user_id)
    series = []
    day = start
    while day <= end:
        running += by_day.get(day.isoformat(), 0)
        series.append(
            {
                "date": day.isoformat(),
                "net_worth": round(running / 100, 2),
                "actual": False,
                "partial": False,
            }
        )
        day += timedelta(days=1)
    return series


def calendar_month(user_id: int, year: int, month: int, today: date = None) -> dict:
    """Day-keyed money movement for one month.

    Past days show what actually happened (real Plaid transactions); today and
    future days show what is expected from recurring items. A month that spans
    the boundary gets both, each entry flagged so the UI never presents a
    projection as a fact.

    Pending transactions are included and flagged. They're excluded from balance
    reconstruction (they mutate and can vanish), but a calendar is exactly where
    someone looks for what they spent this week - and this week's activity is
    pending by nature. Hiding it made the last few days look empty.

    `today` is the user's local date; see forecast_daily_balances.
    """
    last_day = _calendar.monthrange(year, month)[1]
    first = date(year, month, 1)
    last = date(year, month, last_day)
    today = today or _utcnow().date()

    days = {}
    # day -> transfer group ids already added to that day's `transferred` total.
    counted_groups = {}

    def bucket(day_iso: str) -> dict:
        return days.setdefault(
            day_iso,
            {
                "date": day_iso,
                "inflow": 0.0,
                "outflow": 0.0,
                # Money that moved between the user's own accounts. Kept out of
                # inflow/outflow so a day of shuffling reads as net zero.
                "transferred": 0.0,
                "events": [],
            },
        )

    # --- Actuals: real transactions up to and including today.
    if first <= today:
        rows = (
            Transaction.query.filter(
                Transaction.user_id == user_id,
                Transaction.date >= first,
                # Pending rows can be dated a day or two ahead of the user's
                # clock (scheduled transfers are), so allow them past `today`.
                Transaction.date <= min(last, today + timedelta(days=2)),
            )
            .order_by(Transaction.date.asc())
            .all()
        )
        # Both legs of a pair are shown on the same day as the reconstruction
        # applies them, so a transfer reads as one event on one date instead of
        # half of one on each side of a settlement gap.
        applied_on = effective_dates(rows)
        for row in rows:
            day_iso = applied_on.get(row.id, row.date).isoformat()
            if day_iso not in days and not (first <= applied_on.get(row.id, row.date) <= last):
                day_iso = row.date.isoformat()  # partner sits outside this month
            entry = bucket(day_iso)
            # Plaid sign: positive means money left the account.
            amount = round(-row.amount_cents / 100, 2)
            transfer = row.is_transfer

            # A large recent movement may simply be waiting for its counter-leg
            # to post. Rather than commit it to green or red, hold it as
            # provisional until the window closes or a partner turns up.
            # Pending is its own, stronger "not settled" state, so it doesn't
            # also need the provisional treatment.
            provisional = (
                not transfer
                and not row.pending
                and abs(row.amount_cents) >= MIN_CENTS
                and (today - row.date).days <= PROVISIONAL_DAYS
            )

            if transfer:
                # Count each pair once per day, not once per leg.
                seen = counted_groups.setdefault(entry["date"], set())
                if row.transfer_group_id not in seen:
                    seen.add(row.transfer_group_id)
                    entry["transferred"] += abs(amount)
            elif amount >= 0:
                entry["inflow"] += amount
            else:
                entry["outflow"] += -amount

            entry["events"].append(
                {
                    "id": row.id,
                    "name": row.merchant_name or row.name,
                    "amount": abs(amount),
                    "direction": "transfer"
                    if transfer
                    else ("income" if amount >= 0 else "expense"),
                    "category": row.category,
                    "actual": True,
                    "pending": row.pending,
                    "provisional": provisional,
                    "confidence": row.transfer_confidence,
                }
            )

    # --- Expected: recurring items from tomorrow onward.
    if last > today:
        for event in expected_events(user_id, max(first, today + timedelta(days=1)), last):
            entry = bucket(event["date"])
            if event["direction"] == "income":
                entry["inflow"] += event["amount"]
            else:
                entry["outflow"] += event["amount"]
            entry["events"].append(
                {
                    "id": None,
                    "name": event["name"],
                    "amount": event["amount"],
                    "direction": event["direction"],
                    "category": None,
                    "actual": False,
                    "pending": False,
                    "provisional": False,
                    "confidence": None,
                }
            )

    for entry in days.values():
        entry["inflow"] = round(entry["inflow"], 2)
        entry["outflow"] = round(entry["outflow"], 2)
        entry["transferred"] = round(entry["transferred"], 2)
        entry["net"] = round(entry["inflow"] - entry["outflow"], 2)

    newest = (
        Transaction.query.filter(
            Transaction.user_id == user_id, Transaction.pending.is_(False)
        )
        .order_by(Transaction.date.desc())
        .first()
    )

    return {
        "year": year,
        "month": month,
        "days": [days[k] for k in sorted(days)],
        "today": today.isoformat(),
        # Banks post card activity a few business days late. Surfacing the
        # newest posted date lets the UI say "not arrived yet" instead of
        # leaving recent days looking like no money moved.
        "latest_posted": newest.date.isoformat() if newest else None,
    }
