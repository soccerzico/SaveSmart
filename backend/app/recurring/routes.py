"""CRUD for recurring income/expenses, plus a monthly cashflow summary.

Like accounts and goals, every query is scoped to the authenticated user.
"""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..cashflow import monthly_cashflow
from ..extensions import db
from ..models import DIRECTIONS, FREQUENCIES, RecurringTransaction
from ..utils import ApiError, dollars_to_cents, require_str

recurring_bp = Blueprint("recurring", __name__)


def _current_user_id() -> int:
    return int(get_jwt_identity())


def _get_owned(item_id: int) -> RecurringTransaction:
    item = RecurringTransaction.query.filter_by(
        id=item_id, user_id=_current_user_id()
    ).first()
    if not item:
        raise ApiError("Recurring item not found.", status=404)
    return item


def _validate_choice(value: str, allowed: set, field: str) -> str:
    if value not in allowed:
        raise ApiError(f"'{field}' must be one of: {', '.join(sorted(allowed))}.")
    return value


@recurring_bp.get("")
@jwt_required()
def list_recurring():
    items = (
        RecurringTransaction.query.filter_by(user_id=_current_user_id())
        .order_by(RecurringTransaction.created_at.asc())
        .all()
    )
    return jsonify({"recurring": [i.to_dict() for i in items]})


@recurring_bp.get("/summary")
@jwt_required()
def summary():
    cash = monthly_cashflow(_current_user_id())
    return jsonify(
        {
            "monthly_income": round(cash["income"] / 100, 2),
            "monthly_expenses": round(cash["expense"] / 100, 2),
            "monthly_net": round(cash["net"] / 100, 2),
        }
    )


@recurring_bp.post("")
@jwt_required()
def create_recurring():
    data = request.get_json(silent=True) or {}
    amount_cents = dollars_to_cents(data.get("amount"), "amount")
    if amount_cents <= 0:
        raise ApiError("'amount' must be greater than zero.")

    item = RecurringTransaction(
        user_id=_current_user_id(),
        name=require_str(data, "name", max_len=120),
        direction=_validate_choice(
            require_str(data, "direction", max_len=16), DIRECTIONS, "direction"
        ),
        frequency=_validate_choice(
            require_str(data, "frequency", max_len=16), FREQUENCIES, "frequency"
        ),
        amount_cents=amount_cents,
    )
    db.session.add(item)
    db.session.commit()
    return jsonify({"recurring": item.to_dict()}), 201


@recurring_bp.put("/<int:item_id>")
@jwt_required()
def update_recurring(item_id: int):
    item = _get_owned(item_id)
    data = request.get_json(silent=True) or {}

    if "name" in data:
        item.name = require_str(data, "name", max_len=120)
    if "direction" in data:
        item.direction = _validate_choice(
            require_str(data, "direction", max_len=16), DIRECTIONS, "direction"
        )
    if "frequency" in data:
        item.frequency = _validate_choice(
            require_str(data, "frequency", max_len=16), FREQUENCIES, "frequency"
        )
    if "amount" in data:
        amount_cents = dollars_to_cents(data.get("amount"), "amount")
        if amount_cents <= 0:
            raise ApiError("'amount' must be greater than zero.")
        item.amount_cents = amount_cents

    db.session.commit()
    return jsonify({"recurring": item.to_dict()})


@recurring_bp.delete("/<int:item_id>")
@jwt_required()
def delete_recurring(item_id: int):
    item = _get_owned(item_id)
    db.session.delete(item)
    db.session.commit()
    return jsonify({"deleted": item_id})
