"""Development-only admin endpoint: a full dump of current account state.

Gated to debug mode (returns 404 otherwise), so it never exposes data in a
real deployment. Never includes secrets — Plaid access tokens are omitted.

    GET /api/admin/state           -> all users
    GET /api/admin/state?email=... -> just that user
"""
from datetime import datetime, timezone

from flask import Blueprint, abort, current_app, jsonify, request

from ..cashflow import monthly_cashflow
from ..models import (
    Account,
    PlaidItem,
    RecurringTransaction,
    SavingsGoal,
    Snapshot,
    User,
)

admin_bp = Blueprint("admin", __name__)


def _user_state(user: User) -> dict:
    accounts = Account.query.filter_by(user_id=user.id).all()
    assets = sum(a.balance_cents for a in accounts if not a.is_liability)
    liabilities = sum(a.balance_cents for a in accounts if a.is_liability)
    cash = monthly_cashflow(user.id)
    goals = SavingsGoal.query.filter_by(user_id=user.id).all()
    recurring = RecurringTransaction.query.filter_by(user_id=user.id).all()
    items = PlaidItem.query.filter_by(user_id=user.id).all()
    snaps = (
        Snapshot.query.filter_by(user_id=user.id)
        .order_by(Snapshot.created_at.desc())
        .all()
    )
    return {
        "id": user.id,
        "email": user.email,
        "created_at": user.created_at.isoformat(),
        "net_worth": round((assets - liabilities) / 100, 2),
        "assets": round(assets / 100, 2),
        "liabilities": round(liabilities / 100, 2),
        "monthly_cashflow": {
            "income": round(cash["income"] / 100, 2),
            "expenses": round(cash["expense"] / 100, 2),
            "net": round(cash["net"] / 100, 2),
        },
        "accounts": [a.to_dict() for a in accounts],
        "goals": [g.to_dict() for g in goals],
        "recurring": [r.to_dict() for r in recurring],
        # to_dict() intentionally omits the (encrypted) access token.
        "plaid_items": [i.to_dict() for i in items],
        "snapshots_count": len(snaps),
        "latest_snapshot": snaps[0].to_dict() if snaps else None,
    }


@admin_bp.get("/state")
def state():
    # Dev-only. app.debug is True when run via run.py / dev.py; False in prod.
    if not current_app.debug:
        abort(404)

    query = User.query.order_by(User.id)
    email = (request.args.get("email") or "").strip().lower()
    if email:
        query = query.filter(User.email == email)
    users = query.all()

    return jsonify(
        {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "user_count": len(users),
            "users": [_user_state(u) for u in users],
        }
    )
