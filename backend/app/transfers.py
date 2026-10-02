"""Detecting money you moved rather than money you made or spent.

A transfer between two accounts we both track leaves net worth unchanged, but
the ledger sees only two unrelated rows: a debit in one account and a credit in
another. Two things go wrong if we take them at face value.

1. The legs often post a day apart, so for one day the money exists in both
   places at once and net worth spikes by the transfer amount.
2. The calendar paints them green and red, so moving $9,000 into savings reads
   as $9,000 of income followed by $9,000 of spending.

The fix is to find the counter-leg. Two rows pair when they sit in *different*
accounts of the same user, carry opposite signs and near-equal amounts, and land
within a few days of each other. Matching is greedy and one-to-one, closest
candidate first, so one debit can never claim two credits.

Credit-card payments are the common case, not the exception: paying a card from
checking is a transfer from an asset to a liability, and net worth doesn't move.
Those are six of the ten pairs in a typical month here.

A user verdict always wins - `transfer_override` is never overwritten by a run.
"""
import logging
import uuid
from datetime import timedelta

from .extensions import db
from .models import Account, Transaction

log = logging.getLogger("savesmart.transfers")

# Floor for pairing on amount alone. This is false-positive control, not a
# statement about which transfers matter: two unrelated $12 charges could
# coincide, two unrelated $200 ones rarely do. Transfer-flavoured categories
# below bypass it, since Plaid has already told us what the row is.
MIN_CENTS = 20000  # $200

# Plaid's legacy top-level categories that mean "this moved between accounts".
# "Payment" is what a credit-card payment arrives as.
TRANSFER_CATEGORIES = {"Transfer", "Payment"}

# ACH between institutions typically clears in 1-3 days.
WINDOW_DAYS = 3

# Rows that qualify only on category (below MIN_CENTS) must land within a day
# of each other. Small amounts collide easily - a $13 Zelle to a friend and an
# unrelated $13 card autopay three days later are not a pair - so the weaker
# amount evidence has to be paid for with stronger date evidence. Every genuine
# sub-floor pair in practice is same-day or next-day; the false ones straggle.
SUB_FLOOR_WINDOW_DAYS = 1

# Wires and some transfers shave a fee off in flight, so the legs can differ by
# a few dollars. Tight enough that unrelated amounts don't collide.
TOLERANCE_CENTS = 500  # $5.00

# Rows newer than this may simply be waiting for their counter-leg to post, so
# the UI holds them as provisional rather than committing to green or red.
PROVISIONAL_DAYS = 4


def _eligible(txn: Transaction) -> bool:
    """Whether a row may be considered for pairing at all."""
    if txn.transfer_override == "not_transfer":
        return False
    if txn.amount_cents == 0:
        return False
    if (txn.category or "") in TRANSFER_CATEGORIES:
        return True
    return abs(txn.amount_cents) >= MIN_CENTS


def _confidence(gap_days: int, delta_cents: int, category: str | None) -> int:
    """Rough 0-100 score. Same-day, exact-amount, category-confirmed scores top."""
    score = 100
    score -= gap_days * 8
    score -= min(30, delta_cents // 100)
    if (category or "") not in TRANSFER_CATEGORIES:
        score -= 15
    return max(1, min(100, score))


def link_transfers(user_id: int, reset: bool = True) -> dict:
    """Pair up counter-legs across a user's accounts.

    Idempotent: by default it clears previous *automatic* pairings and rebuilds
    them, so a re-run after new transactions arrive can revise old guesses.
    Manual overrides are left untouched.
    """
    account_ids = {
        a.id for a in Account.query.filter_by(user_id=user_id).with_entities(Account.id)
    }
    if not account_ids:
        return {"pairs": 0, "cleared": 0}

    # Pending rows are matched too: now that the calendar shows them, a pending
    # transfer between two of the user's accounts should read gray, not as a
    # green deposit and a red withdrawal. When a pending leg posts, Plaid
    # replaces it with a new row, and the rematch after that sync re-pairs it.
    rows = Transaction.query.filter(Transaction.user_id == user_id).all()

    cleared = 0
    if reset:
        for row in rows:
            if row.transfer_group_id and row.transfer_override != "transfer":
                row.transfer_group_id = None
                row.transfer_confidence = None
                cleared += 1

    candidates = [t for t in rows if _eligible(t)]
    outflows = sorted(
        [t for t in candidates if t.amount_cents > 0], key=lambda t: (t.date, t.id)
    )
    inflows = sorted(
        [t for t in candidates if t.amount_cents < 0], key=lambda t: (t.date, t.id)
    )

    claimed = set()
    pairs = 0

    for out in outflows:
        if out.id in claimed:
            continue
        best = None
        for inc in inflows:
            if inc.id in claimed or inc.account_id == out.account_id:
                continue
            delta = abs(abs(inc.amount_cents) - abs(out.amount_cents))
            if delta > TOLERANCE_CENTS:
                continue
            gap = abs((inc.date - out.date).days)
            both_large = (
                abs(inc.amount_cents) >= MIN_CENTS
                and abs(out.amount_cents) >= MIN_CENTS
            )
            if gap > (WINDOW_DAYS if both_large else SUB_FLOOR_WINDOW_DAYS):
                continue
            # Prefer the nearest date, then the closest amount, then stability.
            rank = (gap, delta, inc.id)
            if best is None or rank < best[0]:
                best = (rank, inc)

        if best is None:
            continue

        gap, delta, _ = best[0]
        inc = best[1]
        group = uuid.uuid4().hex
        score = _confidence(gap, delta, out.category or inc.category)
        for leg in (out, inc):
            if leg.transfer_override == "not_transfer":
                continue
            leg.transfer_group_id = group
            leg.transfer_confidence = score
        claimed.add(out.id)
        claimed.add(inc.id)
        pairs += 1

    db.session.commit()
    log.info(
        "Transfer matching for user=%s: %d pairs (%d prior links cleared)",
        user_id,
        pairs,
        cleared,
    )
    return {"pairs": pairs, "cleared": cleared}


def effective_dates(txns) -> dict:
    """Map transaction id -> the date its balance effect should be applied on.

    Both legs of a pair are pinned to the later of the two dates. The spike
    exists only because the legs straddle a day boundary; collapsing them onto
    one date removes it without discarding either row - so a wire fee, where the
    two amounts differ slightly, still lands on net worth.
    """
    latest = {}
    for txn in txns:
        gid = txn.transfer_group_id
        if not gid or txn.transfer_override == "not_transfer":
            continue
        if gid not in latest or txn.date > latest[gid]:
            latest[gid] = txn.date

    out = {}
    for txn in txns:
        gid = txn.transfer_group_id
        if gid and gid in latest and txn.transfer_override != "not_transfer":
            out[txn.id] = latest[gid]
        else:
            out[txn.id] = txn.date
    return out


def set_override(user_id: int, transaction_id: int, verdict: str | None) -> Transaction:
    """Record a user's verdict on one transaction.

    'not_transfer' unlinks the row (and releases its partner, which is no longer
    a pair). 'transfer' pins the current pairing. None returns it to automatic.
    """
    txn = Transaction.query.filter_by(id=transaction_id, user_id=user_id).first()
    if txn is None:
        return None

    if verdict == "not_transfer":
        partners = (
            Transaction.query.filter(
                Transaction.user_id == user_id,
                Transaction.transfer_group_id == txn.transfer_group_id,
                Transaction.id != txn.id,
            ).all()
            if txn.transfer_group_id
            else []
        )
        for partner in partners:
            # The counter-leg is only a transfer by virtue of this pairing.
            if partner.transfer_override != "transfer":
                partner.transfer_group_id = None
                partner.transfer_confidence = None
        txn.transfer_group_id = None
        txn.transfer_confidence = None

    txn.transfer_override = verdict
    db.session.commit()
    log.info("Transfer override set: txn=%s -> %s", transaction_id, verdict)
    return txn
