"""CRUD for manually-entered accounts (bank, credit card, cash, etc.).

Every query is scoped to the authenticated user so one user can never see or
touch another's accounts.
"""
import logging

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..extensions import db
from ..models import ACCOUNT_TYPES, Account
from ..utils import ApiError, dollars_to_cents, require_str

accounts_bp = Blueprint("accounts", __name__)
log = logging.getLogger("savesmart.accounts")


def _current_user_id() -> int:
    return int(get_jwt_identity())


def _get_owned_account(account_id: int) -> Account:
    account = Account.query.filter_by(
        id=account_id, user_id=_current_user_id()
    ).first()
    if not account:
        raise ApiError("Account not found.", status=404)
    return account


def _validate_type(account_type: str) -> str:
    if account_type not in ACCOUNT_TYPES:
        allowed = ", ".join(sorted(ACCOUNT_TYPES))
        raise ApiError(f"'account_type' must be one of: {allowed}.")
    return account_type


@accounts_bp.get("")
@jwt_required()
def list_accounts():
    accounts = (
        Account.query.filter_by(user_id=_current_user_id())
        .order_by(Account.created_at.asc())
        .all()
    )
    return jsonify({"accounts": [a.to_dict() for a in accounts]})


@accounts_bp.post("")
@jwt_required()
def create_account():
    data = request.get_json(silent=True) or {}
    account = Account(
        user_id=_current_user_id(),
        name=require_str(data, "name", max_len=120),
        account_type=_validate_type(require_str(data, "account_type", max_len=32)),
        institution=(data.get("institution") or "").strip() or None,
        balance_cents=dollars_to_cents(data.get("balance", 0), "balance"),
    )
    db.session.add(account)
    db.session.commit()
    log.info(
        "Account created: '%s' (%s) id=%s user=%s",
        account.name,
        account.account_type,
        account.id,
        account.user_id,
    )
    return jsonify({"account": account.to_dict()}), 201


@accounts_bp.put("/<int:account_id>")
@jwt_required()
def update_account(account_id: int):
    account = _get_owned_account(account_id)
    data = request.get_json(silent=True) or {}

    if "name" in data:
        account.name = require_str(data, "name", max_len=120)
    if "account_type" in data:
        account.account_type = _validate_type(
            require_str(data, "account_type", max_len=32)
        )
    if "institution" in data:
        account.institution = (data.get("institution") or "").strip() or None
    if "balance" in data:
        account.balance_cents = dollars_to_cents(data.get("balance"), "balance")

    db.session.commit()
    return jsonify({"account": account.to_dict()})


@accounts_bp.delete("/<int:account_id>")
@jwt_required()
def delete_account(account_id: int):
    account = _get_owned_account(account_id)
    db.session.delete(account)
    db.session.commit()
    log.info("Account deleted: id=%s user=%s", account_id, _current_user_id())
    return jsonify({"deleted": account_id})
