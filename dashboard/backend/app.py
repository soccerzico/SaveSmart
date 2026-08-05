"""Plaid connection POC — Flask backend.

Implements the minimal Plaid Link server flow:

  1. POST /api/create_link_token        -> short-lived token to open Plaid Link
  2. POST /api/exchange_public_token     -> swap Link's public_token for a stored
                                            access_token (one per institution)
  3. GET  /api/accounts                  -> live balances across all linked items
  4. POST /api/items/remove              -> disconnect an institution

Run: python app.py   (listens on http://127.0.0.1:5100)
"""
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

# Plaid request/response models (typed).
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

import db
from plaid_client import get_client, get_config

load_dotenv(Path(__file__).resolve().parent / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("dashboard")

app = Flask(__name__)
CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                o.strip()
                for o in os.environ.get("CORS_ORIGINS", "http://localhost:5174").split(",")
                if o.strip()
            ]
        }
    },
)

# Single hard-coded user for the POC. In a real app this is your logged-in user.
POC_USER_ID = "poc-dashboard-user"

db.init_db()


def _plaid_error(exc: ApiException):
    """Turn a Plaid ApiException into a clean JSON error + status."""
    log.error("Plaid API error: %s", exc.body)
    # exc.body is a JSON string from Plaid; pass it through for debugging.
    return jsonify({"error": "plaid_error", "detail": exc.body}), 502


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/config")
def config():
    """Lets the frontend confirm the backend has usable Plaid credentials."""
    try:
        cfg = get_config()
        return {"configured": True, "env": cfg["env"], "products": cfg["products"]}
    except RuntimeError as err:
        return {"configured": False, "error": str(err)}


@app.post("/api/create_link_token")
def create_link_token():
    try:
        client = get_client()
        cfg = get_config()
    except RuntimeError as err:
        return jsonify({"error": "not_configured", "detail": str(err)}), 400

    req = LinkTokenCreateRequest(
        products=[Products(p) for p in cfg["products"]],
        client_name="SaveSmart Dashboard",
        country_codes=[CountryCode(c) for c in cfg["country_codes"]],
        language="en",
        user=LinkTokenCreateRequestUser(client_user_id=POC_USER_ID),
    )
    try:
        resp = client.link_token_create(req)
    except ApiException as exc:
        return _plaid_error(exc)

    log.info("Created link token (env=%s)", cfg["env"])
    return jsonify({"link_token": resp["link_token"], "expiration": resp["expiration"]})


@app.post("/api/exchange_public_token")
def exchange_public_token():
    data = request.get_json(silent=True) or {}
    public_token = data.get("public_token")
    if not public_token:
        return jsonify({"error": "public_token is required"}), 400
    institution_name = (data.get("institution_name") or "").strip() or None

    try:
        client = get_client()
    except RuntimeError as err:
        return jsonify({"error": "not_configured", "detail": str(err)}), 400

    try:
        resp = client.item_public_token_exchange(
            ItemPublicTokenExchangeRequest(public_token=public_token)
        )
    except ApiException as exc:
        return _plaid_error(exc)

    item_id = resp["item_id"]
    db.save_item(item_id, resp["access_token"], institution_name)
    log.info("Linked item %s (%s)", item_id, institution_name or "unknown institution")
    return jsonify({"item_id": item_id, "institution_name": institution_name})


@app.get("/api/accounts")
def accounts():
    try:
        client = get_client()
    except RuntimeError as err:
        return jsonify({"error": "not_configured", "detail": str(err)}), 400

    items_out = []
    for row in db.get_items():
        try:
            resp = client.accounts_balance_get(
                AccountsBalanceGetRequest(access_token=row["access_token"])
            )
        except ApiException as exc:
            # One bad item shouldn't sink the whole response.
            log.error("Balance fetch failed for %s: %s", row["item_id"], exc.body)
            items_out.append(
                {
                    "item_id": row["item_id"],
                    "institution_name": row["institution_name"],
                    "error": "balance_fetch_failed",
                    "accounts": [],
                }
            )
            continue

        accounts_out = []
        for acct in resp["accounts"]:
            balances = acct["balances"]
            accounts_out.append(
                {
                    "account_id": acct["account_id"],
                    "name": acct["name"],
                    "official_name": acct.get("official_name"),
                    "mask": acct.get("mask"),
                    "type": str(acct["type"]),
                    "subtype": str(acct.get("subtype")) if acct.get("subtype") else None,
                    "current": balances.get("current"),
                    "available": balances.get("available"),
                    "iso_currency_code": balances.get("iso_currency_code"),
                }
            )
        items_out.append(
            {
                "item_id": row["item_id"],
                "institution_name": row["institution_name"],
                "accounts": accounts_out,
            }
        )

    return jsonify({"items": items_out})


@app.post("/api/items/remove")
def remove_item():
    data = request.get_json(silent=True) or {}
    item_id = data.get("item_id")
    if not item_id:
        return jsonify({"error": "item_id is required"}), 400

    row = next((r for r in db.get_items() if r["item_id"] == item_id), None)
    if not row:
        return jsonify({"error": "item not found"}), 404

    try:
        client = get_client()
        client.item_remove(ItemRemoveRequest(access_token=row["access_token"]))
    except RuntimeError as err:
        return jsonify({"error": "not_configured", "detail": str(err)}), 400
    except ApiException as exc:
        # Even if Plaid rejects (e.g. already removed), drop our local copy.
        log.warning("Plaid item_remove failed, deleting locally anyway: %s", exc.body)

    db.delete_item(item_id)
    log.info("Removed item %s", item_id)
    return jsonify({"removed": item_id})


if __name__ == "__main__":
    log.info("Starting Plaid dashboard API on http://127.0.0.1:5100")
    app.run(host="127.0.0.1", port=5100, debug=True)
