"""Plaid client + helpers for the main SaveSmart app.

Reads Plaid credentials from the environment (loaded from backend/.env by
config.py). Kept self-contained so the plaid blueprint and the sync logic can
share one configured client.
"""
import os

import plaid
from plaid.api import plaid_api

_ENV_HOST = {
    "sandbox": plaid.Environment.Sandbox,
    "production": plaid.Environment.Production,
}


class PlaidNotConfigured(RuntimeError):
    """Raised when Plaid credentials are missing/invalid in the environment."""


def get_config() -> dict:
    client_id = os.environ.get("PLAID_CLIENT_ID", "").strip()
    secret = os.environ.get("PLAID_SECRET", "").strip()
    env = os.environ.get("PLAID_ENV", "sandbox").strip().lower()

    if not client_id or not secret:
        raise PlaidNotConfigured(
            "PLAID_CLIENT_ID and PLAID_SECRET are not set. Add them to "
            "backend/.env to enable bank linking."
        )
    if env not in _ENV_HOST:
        raise PlaidNotConfigured(f"PLAID_ENV must be one of {list(_ENV_HOST)}.")

    products = [
        p.strip()
        for p in os.environ.get("PLAID_PRODUCTS", "transactions").split(",")
        if p.strip()
    ]
    countries = [
        c.strip()
        for c in os.environ.get("PLAID_COUNTRY_CODES", "US").split(",")
        if c.strip()
    ]
    return {
        "client_id": client_id,
        "secret": secret,
        "env": env,
        "products": products,
        "country_codes": countries,
    }


def is_configured() -> bool:
    try:
        get_config()
        return True
    except PlaidNotConfigured:
        return False


def get_client() -> plaid_api.PlaidApi:
    cfg = get_config()
    configuration = plaid.Configuration(
        host=_ENV_HOST[cfg["env"]],
        api_key={"clientId": cfg["client_id"], "secret": cfg["secret"]},
    )
    return plaid_api.PlaidApi(plaid.ApiClient(configuration))


def to_account_type(plaid_type, plaid_subtype) -> str:
    """Map Plaid's type/subtype onto our ACCOUNT_TYPES vocabulary."""
    t = str(plaid_type) if plaid_type else ""
    st = str(plaid_subtype) if plaid_subtype else ""
    if t == "credit":
        return "credit_card"
    if t == "loan":
        return "loan"
    if t == "investment":
        return "investment"
    if t == "depository":
        return "savings" if st == "savings" else "checking"
    return "cash"


def balance_to_cents(plaid_account) -> int:
    """Balance in cents, choosing the field that best reflects reality per type.

    Depository (checking/savings/cash): prefer Plaid's ``available`` balance,
    which includes pending credits/debits (a just-made deposit shows here before
    it posts to ``current``). Falls back to ``current`` when unavailable.

    Credit/loan/investment: use ``current`` — for a card that's the amount owed,
    not the remaining credit line (``available`` would be the wrong number).
    """
    balances = plaid_account["balances"]
    acct_type = str(plaid_account.get("type") or "")
    if acct_type == "depository":
        value = balances.get("available")
        if value is None:
            value = balances.get("current")
    else:
        value = balances.get("current")
    return round((value or 0) * 100)
