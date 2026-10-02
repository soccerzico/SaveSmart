"""Plaid transaction ingest and historical balance reconstruction.

Plaid has no "balance as of a past date" endpoint, so history is derived: take
today's balance and replay the ledger backwards.

    asset:      balance(T) = balance_now + sum(amount of txns after T)
    liability:  owed(T)    = owed_now    - sum(amount of txns after T)

The sign flip is the whole game. Plaid's `amount` is positive when money leaves
the account, so a $100 card purchase arrives as +100 and *increases* what you
owe. Adding where you should subtract silently inverts every credit-card series,
which is why Transaction stores the raw Plaid sign and the interpretation lives
here (see the Transaction model docstring).

Coverage is not uniform, and the caller is told so rather than being handed a
confident wrong number - see `_coverage_floor` and the `partial` flag.
"""
import logging
from datetime import date, datetime, time, timedelta, timezone

from plaid.exceptions import ApiException
from plaid.model.transactions_sync_request import TransactionsSyncRequest
from plaid.model.transactions_sync_request_options import (
    TransactionsSyncRequestOptions,
)

from .extensions import db
from .models import Account, PlaidItem, Snapshot, Transaction
from .transfers import WINDOW_DAYS, effective_dates, link_transfers

log = logging.getLogger("savesmart.transactions")

# Max history Plaid will fetch when Transactions is first added to an Item.
# Has no effect on Items that already have the product (Plaid's rule), so the
# existing links stay at whatever their 90-day default pulled; new ones get two
# years. Raising it for an existing Item means re-linking.
DAYS_REQUESTED = 730

# Investment balances move on market price, not cash flow. Replaying
# transactions would reconstruct contributions while assuming today's share
# prices held all along, so these are carried flat and flagged instead.
UNRECONSTRUCTABLE_TYPES = {"investment"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------
# Ingest
# --------------------------------------------------------------------------


def sync_item_transactions(client, item: PlaidItem) -> dict:
    """Pull one Item's transaction delta via /transactions/sync.

    Cursor-based: the first call (cursor NULL) walks the Item's full available
    history, later calls return only what changed. Returns per-op counts.
    """
    accounts = {
        a.plaid_account_id: a
        for a in Account.query.filter_by(plaid_item_id=item.id).all()
        if a.plaid_account_id
    }
    added = modified = removed = 0
    cursor = item.transactions_cursor
    has_more = True

    while has_more:
        kwargs = {"access_token": item.access_token}
        if cursor:
            kwargs["cursor"] = cursor
        else:
            # Only meaningful on an Item that doesn't have Transactions yet.
            kwargs["options"] = TransactionsSyncRequestOptions(
                days_requested=DAYS_REQUESTED
            )
        resp = client.transactions_sync(TransactionsSyncRequest(**kwargs))

        for raw in resp["added"]:
            if _upsert(raw, accounts, item.user_id):
                added += 1
        for raw in resp["modified"]:
            if _upsert(raw, accounts, item.user_id):
                modified += 1
        for raw in resp["removed"]:
            row = Transaction.query.filter_by(
                plaid_transaction_id=raw["transaction_id"]
            ).first()
            if row is not None:
                db.session.delete(row)
                removed += 1

        cursor = resp["next_cursor"]
        has_more = resp["has_more"]

    item.transactions_cursor = cursor
    db.session.commit()
    log.info(
        "Transactions synced for item %s: +%d ~%d -%d",
        item.item_id,
        added,
        modified,
        removed,
    )
    return {"added": added, "modified": modified, "removed": removed}


def _upsert(raw, accounts: dict, user_id: int) -> bool:
    """Insert or update one Plaid transaction. False if its account is unknown."""
    account = accounts.get(raw["account_id"])
    if account is None:
        # A Plaid account we never materialized (balance sync hasn't run yet).
        return False

    row = Transaction.query.filter_by(
        plaid_transaction_id=raw["transaction_id"]
    ).first()
    if row is None:
        row = Transaction(plaid_transaction_id=raw["transaction_id"], user_id=user_id)
        db.session.add(row)

    row.account_id = account.id
    row.date = raw["date"]
    row.amount_cents = round(float(raw["amount"]) * 100)
    row.name = (raw.get("name") or "")[:255]
    merchant = raw.get("merchant_name")
    row.merchant_name = merchant[:255] if merchant else None
    row.category = _category_of(raw)
    row.pending = bool(raw.get("pending"))
    return True


def _category_of(raw):
    """Plaid's legacy `category` is a list, most-general first."""
    cats = raw.get("category")
    if not cats:
        return None
    try:
        return str(cats[0])[:120]
    except (TypeError, IndexError):
        return None


def sync_all_transactions(client, user_id: int) -> dict:
    """Sync every linked Item for a user. Item failures are collected, not fatal."""
    totals = {"added": 0, "modified": 0, "removed": 0}
    errors = []
    for item in PlaidItem.query.filter_by(user_id=user_id).all():
        try:
            counts = sync_item_transactions(client, item)
            for key in totals:
                totals[key] += counts[key]
        except ApiException as exc:
            log.error("transaction sync failed for %s: %s", item.item_id, exc.body)
            errors.append(item.institution_name or item.item_id)
    totals["errors"] = errors
    # A leg that arrives now may pair with one already on file, so rematch the
    # whole ledger rather than only what just landed.
    totals["transfers"] = link_transfers(user_id)
    return totals


# --------------------------------------------------------------------------
# Reconstruction
# --------------------------------------------------------------------------


def _coverage_floor(account, txns_by_account: dict, item_floor: dict) -> date:
    """Earliest date this account's history can be trusted back to.

    An account's own oldest transaction is the best evidence. An account with no
    transactions at all is ambiguous - genuinely idle, or simply not covered -
    so it falls back to the oldest transaction anywhere in its Item, then to
    when we linked it. Never claims more history than Plaid actually returned.
    """
    own = txns_by_account.get(account.id)
    if own:
        return min(t.date for t in own)
    if account.plaid_item_id and item_floor.get(account.plaid_item_id):
        return item_floor[account.plaid_item_id]
    created = account.created_at or _utcnow()
    return created.date()


def reconstruct_daily_balances(user_id: int, start: date, end: date) -> list:
    """Daily net-worth series over [start, end], newest-anchored and walked back.

    Each point is the balance at the *end* of that day. `partial` marks days
    where at least one account had to be carried flat rather than reconstructed.
    """
    if start > end:
        return []

    accounts = Account.query.filter_by(user_id=user_id).all()
    if not accounts:
        return []

    txns = (
        Transaction.query.filter(
            Transaction.user_id == user_id,
            Transaction.pending.is_(False),
            # Reach back past `start`: pinning a pair to its later leg can move
            # a transaction forward across the boundary.
            Transaction.date > start - timedelta(days=WINDOW_DAYS),
        )
        .order_by(Transaction.date.desc())
        .all()
    )

    # Both legs of a transfer are applied on the same day, so the pair never
    # straddles a boundary and can't produce a one-day phantom spike.
    applied_on = effective_dates(txns)

    txns_by_account = {}
    for txn in txns:
        txns_by_account.setdefault(txn.account_id, []).append(txn)

    # Oldest transaction per Item, used as the fallback coverage floor.
    item_floor = {}
    by_id = {a.id: a for a in accounts}
    for acct_id, rows in txns_by_account.items():
        acct = by_id.get(acct_id)
        if acct and acct.plaid_item_id:
            oldest = min(r.date for r in rows)
            current = item_floor.get(acct.plaid_item_id)
            if current is None or oldest < current:
                item_floor[acct.plaid_item_id] = oldest

    # Per-day, per-account signed deltas in Plaid's convention.
    deltas = {}
    for txn in txns:
        day = applied_on.get(txn.id, txn.date)
        if day <= start:
            continue  # shifted out of the window entirely
        per_day = deltas.setdefault(txn.account_id, {})
        per_day[day] = per_day.get(day, 0) + txn.amount_cents

    running = {a.id: a.balance_cents for a in accounts}
    floors = {a.id: _coverage_floor(a, txns_by_account, item_floor) for a in accounts}

    series = []
    day = end
    while day >= start:
        assets = liabilities = 0
        carried = 0
        uncovered = 0
        for acct in accounts:
            balance = running[acct.id]
            if acct.is_liability:
                liabilities += balance
            else:
                assets += balance
            if acct.account_type in UNRECONSTRUCTABLE_TYPES or day < floors[acct.id]:
                # No ledger for this account on this day, so its balance is
                # today's value held still rather than anything we can evidence.
                carried += abs(balance)
                uncovered += 1

        total = abs(assets) + abs(liabilities)
        series.append(
            {
                "date": day.isoformat(),
                "assets": round(assets / 100, 2),
                "liabilities": round(liabilities / 100, 2),
                "net_worth": round((assets - liabilities) / 100, 2),
                # `partial` alone is near-useless here: one investment account
                # makes every single day partial. These say *how much* of the
                # day is evidence and how much is carried forward, so the UI can
                # distinguish "a rounding error" from "mostly guesswork".
                "partial": uncovered > 0,
                "carried_flat": round(carried / 100, 2),
                "uncovered_accounts": uncovered,
                "confidence": round(max(0.0, min(1.0, 1 - carried / total)), 3)
                if total
                else 1.0,
                "actual": True,
            }
        )

        # Step back one day by undoing that day's transactions. Assets add back
        # what was spent; liabilities do the reverse (see module docstring).
        for acct in accounts:
            if acct.account_type in UNRECONSTRUCTABLE_TYPES:
                continue  # carried flat - no ledger to replay
            delta = deltas.get(acct.id, {}).get(day, 0)
            if delta:
                running[acct.id] += -delta if acct.is_liability else delta
        day -= timedelta(days=1)

    series.reverse()
    return series


def _measured_cashflow(user_id: int, days: list, window_days: int = 30) -> dict:
    """Measured income/expense for each day in `days`, from real transactions.

    Sums actual non-transfer activity in the `window_days` ending on each day,
    rather than reading today's `RecurringTransaction` config - recurring items
    change over time (a loan gets paid off, a rate drops, a raise lands), so
    "what the setup looks like today" is not "what was true back then". This is
    the same income/expense classification `Transaction.to_dict` already uses
    (is_transfer excluded, is_inflow decides the sign), just aggregated into a
    rolling window instead of listed transaction-by-transaction.

    One bulk query covers every requested day; each day then sums its own
    window from the same in-memory rows. A day within `window_days` of the
    start of the ledger gets a genuinely short window and reads low rather than
    being scaled up to a guessed monthly figure - measured-but-partial beats
    invented-but-round, same trade the reconstruction itself makes elsewhere.
    """
    if not days:
        return {}
    earliest = min(days) - timedelta(days=window_days - 1)
    latest = max(days)
    rows = Transaction.query.filter(
        Transaction.user_id == user_id,
        Transaction.pending.is_(False),
        Transaction.date >= earliest,
        Transaction.date <= latest,
    ).all()
    real = [r for r in rows if not r.is_transfer]

    result = {}
    for day in days:
        window_start = day - timedelta(days=window_days - 1)
        in_window = [r for r in real if window_start <= r.date <= day]
        income = sum(-r.amount_cents for r in in_window if r.is_inflow)
        expense = sum(r.amount_cents for r in in_window if not r.is_inflow)
        result[day] = {"income": income, "expense": expense, "net": income - expense}
    return result


def backfill_snapshots(user_id: int, days: int = 90, step_days: int = 7) -> dict:
    """Persist reconstructed Snapshot rows across the recent past.

    Weekly by default: snapshots feed the assistant's progress reasoning, and a
    daily row for every day would swamp that context without adding signal. Rows
    are written with source='reconstructed' and skipped where one already exists
    for that date, so re-running is idempotent.
    """
    today = _utcnow().date()
    start = today - timedelta(days=days)
    series = reconstruct_daily_balances(user_id, start, today)
    if not series:
        return {"written": 0, "skipped": 0, "days": 0}

    existing = {
        snap.created_at.date()
        for snap in Snapshot.query.filter_by(
            user_id=user_id, source="reconstructed"
        ).all()
    }

    points = series[::step_days]
    wanted_days = [date.fromisoformat(p["date"]) for p in points]
    cash_by_day = _measured_cashflow(user_id, wanted_days)
    written = skipped = 0

    for point in points:
        day = date.fromisoformat(point["date"])
        if day in existing:
            skipped += 1
            continue
        stamp = datetime.combine(day, time(23, 59), tzinfo=timezone.utc)
        cash = cash_by_day[day]
        db.session.add(
            Snapshot(
                user_id=user_id,
                created_at=stamp,
                net_worth_cents=round(point["net_worth"] * 100),
                assets_cents=round(point["assets"] * 100),
                liabilities_cents=round(point["liabilities"] * 100),
                # Measured from the ledger for the 30 days ending on this day -
                # see _measured_cashflow - not today's recurring setup.
                monthly_income_cents=round(cash["income"]),
                monthly_expense_cents=round(cash["expense"]),
                monthly_net_cents=round(cash["net"]),
                goals_json="[]",
                source="reconstructed",
                is_partial=point["partial"],
                note="Reconstructed from transaction history; income/expense "
                "measured over the trailing 30 days, not today's recurring setup.",
            )
        )
        written += 1

    db.session.commit()
    log.info(
        "Backfilled %d reconstructed snapshots for user=%s (%d skipped)",
        written,
        user_id,
        skipped,
    )
    return {"written": written, "skipped": skipped, "days": len(series)}
