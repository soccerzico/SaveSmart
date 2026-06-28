"""CRUD for savings goals.

Mirrors the accounts blueprint: every query is scoped to the authenticated
user. Amounts come in as dollars and are stored as cents.
"""
from datetime import date

import logging

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..cashflow import monthly_cashflow, project_goal
from ..extensions import db
from ..models import SavingsGoal
from ..utils import ApiError, dollars_to_cents, require_str

goals_bp = Blueprint("goals", __name__)
log = logging.getLogger("savesmart.goals")


def _current_user_id() -> int:
    return int(get_jwt_identity())


def _serialize(goal: SavingsGoal, cash: dict = None) -> dict:
    """Goal dict plus its projected achievement date.

    Pass a precomputed `cash` summary when serializing many goals so we only
    query recurring items once.
    """
    if cash is None:
        cash = monthly_cashflow(goal.user_id)
    data = goal.to_dict()
    data["projection"] = project_goal(goal, cash["net"], cash["count"] > 0)
    return data


def _get_owned_goal(goal_id: int) -> SavingsGoal:
    goal = SavingsGoal.query.filter_by(
        id=goal_id, user_id=_current_user_id()
    ).first()
    if not goal:
        raise ApiError("Goal not found.", status=404)
    return goal


def _parse_target_date(value):
    """Accept an ISO date string (YYYY-MM-DD), empty, or None."""
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ApiError("'target_date' must be an ISO date (YYYY-MM-DD).")


@goals_bp.get("")
@jwt_required()
def list_goals():
    user_id = _current_user_id()
    goals = (
        SavingsGoal.query.filter_by(user_id=user_id)
        .order_by(SavingsGoal.created_at.asc())
        .all()
    )
    cash = monthly_cashflow(user_id)
    return jsonify({"goals": [_serialize(g, cash) for g in goals]})


@goals_bp.post("")
@jwt_required()
def create_goal():
    data = request.get_json(silent=True) or {}
    goal = SavingsGoal(
        user_id=_current_user_id(),
        name=require_str(data, "name", max_len=120),
        target_cents=dollars_to_cents(data.get("target_amount"), "target_amount"),
        current_cents=dollars_to_cents(data.get("current_amount", 0), "current_amount"),
        target_date=_parse_target_date(data.get("target_date")),
    )
    if goal.target_cents <= 0:
        raise ApiError("'target_amount' must be greater than zero.")
    db.session.add(goal)
    db.session.commit()
    log.info(
        "Goal created: '%s' target=$%.2f id=%s user=%s",
        goal.name,
        goal.target_cents / 100,
        goal.id,
        goal.user_id,
    )
    return jsonify({"goal": _serialize(goal)}), 201


@goals_bp.put("/<int:goal_id>")
@jwt_required()
def update_goal(goal_id: int):
    goal = _get_owned_goal(goal_id)
    data = request.get_json(silent=True) or {}

    if "name" in data:
        goal.name = require_str(data, "name", max_len=120)
    if "target_amount" in data:
        goal.target_cents = dollars_to_cents(data.get("target_amount"), "target_amount")
        if goal.target_cents <= 0:
            raise ApiError("'target_amount' must be greater than zero.")
    if "current_amount" in data:
        goal.current_cents = dollars_to_cents(
            data.get("current_amount"), "current_amount"
        )
    if "target_date" in data:
        goal.target_date = _parse_target_date(data.get("target_date"))

    db.session.commit()
    return jsonify({"goal": _serialize(goal)})


@goals_bp.delete("/<int:goal_id>")
@jwt_required()
def delete_goal(goal_id: int):
    goal = _get_owned_goal(goal_id)
    db.session.delete(goal)
    db.session.commit()
    log.info("Goal deleted: id=%s user=%s", goal_id, _current_user_id())
    return jsonify({"deleted": goal_id})
