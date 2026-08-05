"""Builds a configured Plaid API client from environment variables."""
import os

import plaid
from plaid.api import plaid_api

# Map our friendly env name to the Plaid SDK host constant.
_ENV_HOST = {
    "sandbox": plaid.Environment.Sandbox,
    "production": plaid.Environment.Production,
}


def get_config() -> dict:
    """Return the Plaid-related config, raising if required keys are missing."""
    client_id = os.environ.get("PLAID_CLIENT_ID", "").strip()
    secret = os.environ.get("PLAID_SECRET", "").strip()
    env = os.environ.get("PLAID_ENV", "sandbox").strip().lower()

    if not client_id or not secret:
        raise RuntimeError(
            "PLAID_CLIENT_ID and PLAID_SECRET must be set. Copy "
            "dashboard/backend/.env.example to .env and fill in your keys."
        )
    if env not in _ENV_HOST:
        raise RuntimeError(
            f"PLAID_ENV must be one of {list(_ENV_HOST)}; got '{env}'."
        )

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


def get_client() -> plaid_api.PlaidApi:
    cfg = get_config()
    configuration = plaid.Configuration(
        host=_ENV_HOST[cfg["env"]],
        api_key={"clientId": cfg["client_id"], "secret": cfg["secret"]},
    )
    return plaid_api.PlaidApi(plaid.ApiClient(configuration))
