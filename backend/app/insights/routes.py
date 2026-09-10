"""Transaction history, balance reconstruction, forecast, and calendar.

Everything here is derived data - nothing is authored by the user. The ledger
comes from Plaid, the past comes from replaying it, and the future comes from
the recurring items the user maintains elsewhere in the app.
"""
import logging
from datetime import date, datetime, timedelta, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..forecast import calendar_month, forecast_daily_balances
from ..models import Account, Transaction
from ..plaid_service import PlaidNotConfigured, get_client
from ..transfers import link_transfers, set_override
from ..transactions_service import (
    UNRECONSTRUCTABLE_TYPES,
    backfill_snapshots,
    reconstruct_daily_balances,
    sync_all_transactions,
)
from ..utils import ApiError

insights_bp = Blueprint("insights", __name__)
log = logging.getLogger("savesmart.insights")

# Bounds on the requested window. The past is capped near Plaid's two-year
# ceiling; the future past a year is fiction dressed as a chart.
MAX_PAST_DAYS = 730
MAX_FUTURE_DAYS = 365


def _current_user_id() -> int:
    return int(get_jwt_identity())


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _int_arg(name: str, default: int, low: int, high: int) -> int:
    raw = request.args.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ApiError(f"'{name}' must be a whole number.")
    return max(low, min(high, value))


@insights_bp.post("/sync-transactions")
@jwt_required()
def sync_transactions():
    """Pull the transaction ledger for every linked institution."""
    try:
        client = get_client()
    except PlaidNotConfigured as err:
        raise ApiError(str(err), status=400)

    user_id = _current_user_id()
    result = sync_all_transactions(client, user_id)
    total = Transaction.query.filter_by(user_id=user_id).count()
    return jsonify({**result, "total_transactions": total})


@insights_bp.get("/balance-series")
@jwt_required()
def balance_series():
    """One continuous net-worth timeline: reconstructed past + forecast future.

    Both halves are the same shape so the chart can draw a single line, with
    `actual` marking where evidence ends and projection begins.
    """
    user_id = _current_user_id()
    past = _int_arg("past", 90, 1, MAX_PAST_DAYS)
    future = _int_arg("future", 90, 0, MAX_FUTURE_DAYS)

    today = _today()
    history = reconstruct_daily_balances(user_id, today - timedelta(days=past), today)
    projection = forecast_daily_balances(user_id, future) if future else []

    # Which accounts couldn't be reconstructed, so the UI can say why rather
    # than showing a silently-wrong line.
    carried = [
        {"id": a.id, "name": a.name, "type": a.account_type}
        for a in Account.query.filter_by(user_id=user_id).all()
        if a.account_type in UNRECONSTRUCTABLE_TYPES
    ]
    oldest = (
        Transaction.query.filter_by(user_id=user_id)
        .order_by(Transaction.date.asc())
        .first()
    )

    return jsonify(
        {
            "series": history + projection,
            "today": today.isoformat(),
            "has_transactions": oldest is not None,
            "coverage_start": oldest.date.isoformat() if oldest else None,
            "carried_flat": carried,
        }
    )


@insights_bp.get("/calendar")
@jwt_required()
def calendar_view():
    """Money in and out per day for one month (actuals past, expected future)."""
    today = _today()
    year = _int_arg("year", today.year, 1970, 2200)
    month = _int_arg("month", today.month, 1, 12)
    return jsonify(calendar_month(_current_user_id(), year, month))


@insights_bp.post("/backfill-snapshots")
@jwt_required()
def backfill():
    """Write reconstructed Snapshot rows for the recent past.

    These sit alongside live snapshots rather than replacing them - a live row
    only knew the accounts linked at the time, so the two series can disagree
    for the same date and both still be correct.
    """
    data = request.get_json(silent=True) or {}
    try:
        days = max(1, min(MAX_PAST_DAYS, int(data.get("days", 90))))
        step = max(1, min(90, int(data.get("step_days", 7))))
    except (TypeError, ValueError):
        raise ApiError("'days' and 'step_days' must be whole numbers.")

    result = backfill_snapshots(_current_user_id(), days=days, step_days=step)
    return jsonify(result)


@insights_bp.post("/transfers/relink")
@jwt_required()
def relink_transfers():
    """Re-run counter-leg matching over the whole ledger.

    Runs automatically after each sync; exposed separately so a changed manual
    override can be folded back in without re-pulling from Plaid.
    """
    return jsonify(link_transfers(_current_user_id()))


@insights_bp.post("/transactions/<int:txn_id>/transfer")
@jwt_required()
def override_transfer(txn_id: int):
    """Record a user verdict on whether one transaction is an internal transfer.

    Body: {"verdict": "transfer" | "not_transfer" | null}. The matcher never
    overwrites a verdict, so this is the escape hatch when it guesses wrong.
    """
    data = request.get_json(silent=True) or {}
    verdict = data.get("verdict")
    if verdict not in ("transfer", "not_transfer", None):
        raise ApiError("'verdict' must be 'transfer', 'not_transfer', or null.")

    txn = set_override(_current_user_id(), txn_id, verdict)
    if txn is None:
        raise ApiError("Transaction not found.", status=404)
    return jsonify({"transaction": txn.to_dict()})


@insights_bp.get("/transactions")
@jwt_required()
def list_transactions():
    """Recent transactions, newest first."""
    limit = _int_arg("limit", 100, 1, 500)
    rows = (
        Transaction.query.filter_by(user_id=_current_user_id())
        .order_by(Transaction.date.desc(), Transaction.id.desc())
        .limit(limit)
        .all()
    )
    return jsonify({"transactions": [t.to_dict() for t in rows]})
