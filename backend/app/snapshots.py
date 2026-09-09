"""Point-in-time financial snapshots.

The app writes one of these on login (subject to a min-interval guard) so the
assistant can reason about progress over time. Numbers are captured
deterministically here — the source of truth — while the flexible per-goal
detail rides along as JSON. See the Snapshot model for the storage rationale.
"""
import json
import logging
from datetime import datetime, timedelta, timezone

from .cashflow import monthly_cashflow
from .extensions import db
from .models import Account, SavingsGoal, Snapshot, as_utc

log = logging.getLogger("savesmart.snapshots")

# Don't record more than one snapshot per this window (avoids bloat when a user
# logs in repeatedly). Progress tracking only needs periodic samples.
MIN_INTERVAL = timedelta(hours=6)


def build_snapshot_values(user_id: int) -> dict:
    """Compute the current financial state as snapshot column values (cents)."""
    accounts = Account.query.filter_by(user_id=user_id).all()
    assets = sum(a.balance_cents for a in accounts if not a.is_liability)
    liabilities = sum(a.balance_cents for a in accounts if a.is_liability)

    cash = monthly_cashflow(user_id)

    goals = SavingsGoal.query.filter_by(user_id=user_id).all()
    goals_detail = []
    for g in goals:
        target = g.target_cents or 0
        saved = g.saved_cents
        pct = round(saved / target * 100, 1) if target else 0.0
        goals_detail.append(
            {
                "name": g.name,
                "target": round(g.target_cents / 100, 2),
                "current": round(saved / 100, 2),
                "progress_pct": min(pct, 100.0),
            }
        )

    return {
        "net_worth_cents": assets - liabilities,
        "assets_cents": assets,
        "liabilities_cents": liabilities,
        "monthly_income_cents": round(cash["income"]),
        "monthly_expense_cents": round(cash["expense"]),
        "monthly_net_cents": round(cash["net"]),
        "goals_json": json.dumps(goals_detail),
    }


def write_snapshot(user_id: int, note: str | None = None, force: bool = False) -> Snapshot | None:
    """Record a snapshot for the user. Skips if one was taken recently (unless
    force=True). Returns the new Snapshot, or None if skipped."""
    if not force:
        latest = (
            Snapshot.query.filter_by(user_id=user_id)
            .order_by(Snapshot.created_at.desc())
            .first()
        )
        if latest is not None:
            age = datetime.now(timezone.utc) - as_utc(latest.created_at)
            if age < MIN_INTERVAL:
                return None

    snap = Snapshot(user_id=user_id, note=note, **build_snapshot_values(user_id))
    db.session.add(snap)
    db.session.commit()
    log.info("Snapshot recorded for user=%s (net worth %.2f)", user_id, snap.net_worth_cents / 100)
    return snap
