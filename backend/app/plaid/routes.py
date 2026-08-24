"""Plaid bank-linking endpoints, scoped to the authenticated user.

Flow mirrors the standalone POC but ties Items to a user and materializes
linked accounts as read-only `Account` rows (source='plaid') so they sit
alongside manual accounts in net-worth math, goals, and snapshots.
"""
import logging

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from plaid.exceptions import ApiException
from plaid.model.accounts_balance_get_request import AccountsBalanceGetRequest
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import (
    ItemPublicTokenExchangeRequest,
)
from plaid.model.item_remove_request import ItemRemoveRequest
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.products import Products

from ..extensions import db
from ..models import Account, PlaidItem
from ..plaid_service import (
    PlaidNotConfigured,
    balance_to_cents,
    get_client,
    get_config,
    is_configured,
    to_account_type,
)
from ..utils import ApiError

plaid_bp = Blueprint("plaid", __name__)
log = logging.getLogger("savesmart.plaid")


def _current_user_id() -> int:
    return int(get_jwt_identity())


def _client_or_error():
    try:
        return get_client()
    except PlaidNotConfigured as err:
        raise ApiError(str(err), status=400)


def _sync_item(client, item: PlaidItem) -> int:
    """Pull balances for one Item and upsert its accounts. Returns count synced."""
    resp = client.accounts_balance_get(
        AccountsBalanceGetRequest(access_token=item.access_token)
    )
    count = 0
    for acct in resp["accounts"]:
        plaid_account_id = acct["account_id"]
        row = Account.query.filter_by(plaid_account_id=plaid_account_id).first()
        if row is None:
            row = Account(
                user_id=item.user_id,
                source="plaid",
                plaid_item_id=item.id,
                plaid_account_id=plaid_account_id,
            )
            db.session.add(row)
        # Refresh mutable fields from Plaid every sync.
        row.name = acct["name"]
        row.account_type = to_account_type(acct["type"], acct.get("subtype"))
        row.institution = item.institution_name
        row.balance_cents = balance_to_cents(acct)
        count += 1
    db.session.commit()
    return count


@plaid_bp.get("/status")
@jwt_required()
def status():
    if not is_configured():
        return jsonify({"configured": False})
    cfg = get_config()
    return jsonify({"configured": True, "env": cfg["env"]})


@plaid_bp.post("/create_link_token")
@jwt_required()
def create_link_token():
    client = _client_or_error()
    cfg = get_config()
    req = LinkTokenCreateRequest(
        products=[Products(p) for p in cfg["products"]],
        client_name="SaveSmart",
        country_codes=[CountryCode(c) for c in cfg["country_codes"]],
        language="en",
        user=LinkTokenCreateRequestUser(client_user_id=str(_current_user_id())),
    )
    try:
        resp = client.link_token_create(req)
    except ApiException as exc:
        log.error("link_token_create failed: %s", exc.body)
        raise ApiError("Could not start bank linking. Check Plaid config.", status=502)
    return jsonify({"link_token": resp["link_token"]})


@plaid_bp.post("/exchange_public_token")
@jwt_required()
def exchange_public_token():
    data = request.get_json(silent=True) or {}
    public_token = data.get("public_token")
    if not public_token:
        raise ApiError("public_token is required.")
    institution_name = (data.get("institution_name") or "").strip() or None

    client = _client_or_error()
    try:
        resp = client.item_public_token_exchange(
            ItemPublicTokenExchangeRequest(public_token=public_token)
        )
    except ApiException as exc:
        log.error("public_token exchange failed: %s", exc.body)
        raise ApiError("Could not link this institution.", status=502)

    user_id = _current_user_id()
    item = PlaidItem.query.filter_by(item_id=resp["item_id"], user_id=user_id).first()
    if item is None:
        item = PlaidItem(user_id=user_id, item_id=resp["item_id"])
        db.session.add(item)
    item.access_token = resp["access_token"]
    item.institution_name = institution_name
    db.session.commit()

    try:
        synced = _sync_item(client, item)
    except ApiException as exc:
        log.error("initial sync failed for %s: %s", item.item_id, exc.body)
        synced = 0

    log.info(
        "Linked item %s (%s) for user=%s, synced %d accounts",
        item.item_id,
        institution_name or "unknown",
        user_id,
        synced,
    )
    return jsonify({"item": item.to_dict(), "accounts_synced": synced}), 201


@plaid_bp.post("/sync")
@jwt_required()
def sync():
    client = _client_or_error()
    user_id = _current_user_id()
    items = PlaidItem.query.filter_by(user_id=user_id).all()
    total = 0
    errors = []
    for item in items:
        try:
            total += _sync_item(client, item)
        except ApiException as exc:
            log.error("sync failed for %s: %s", item.item_id, exc.body)
            errors.append(item.item_id)
    return jsonify({"accounts_synced": total, "items": len(items), "errors": errors})


@plaid_bp.get("/items")
@jwt_required()
def list_items():
    items = PlaidItem.query.filter_by(user_id=_current_user_id()).all()
    return jsonify({"items": [i.to_dict() for i in items]})


@plaid_bp.post("/items/remove")
@jwt_required()
def remove_item():
    data = request.get_json(silent=True) or {}
    item_id = data.get("item_id")
    if not item_id:
        raise ApiError("item_id is required.")

    user_id = _current_user_id()
    item = PlaidItem.query.filter_by(item_id=item_id, user_id=user_id).first()
    if not item:
        raise ApiError("Item not found.", status=404)

    # Best-effort remove at Plaid; we drop our local copy regardless.
    try:
        client = get_client()
        client.item_remove(ItemRemoveRequest(access_token=item.access_token))
    except PlaidNotConfigured:
        pass
    except ApiException as exc:
        log.warning("Plaid item_remove failed, removing locally: %s", exc.body)

    # Delete the synced accounts for this item, then the item itself. Use ORM
    # deletes (not bulk) so goal_accounts links are cleaned up too.
    for acct in Account.query.filter_by(plaid_item_id=item.id, user_id=user_id).all():
        db.session.delete(acct)
    db.session.delete(item)
    db.session.commit()
    log.info("Removed item %s for user=%s", item_id, user_id)
    return jsonify({"removed": item_id})
