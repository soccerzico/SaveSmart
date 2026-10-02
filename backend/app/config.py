"""Application configuration loaded from environment variables.

Defaults are dev-friendly. Anything secret must be overridden via a .env file
(see .env.example) before this runs anywhere that isn't your laptop.
"""
import os
import secrets
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

# Load .env sitting next to the backend/ root.
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
INSTANCE_DIR = BASE_DIR / "instance"


def _secret(name: str) -> str:
    """Resolve a signing secret so a fresh install never runs on a published one.

    First match wins:
      1. the environment variable (explicit; set this in prod)
      2. an existing key file at backend/instance/<name>.key
      3. otherwise, generate a random one and persist it to that file

    instance/ is gitignored, so each install gets its own stable secret and
    sessions survive restarts.
    """
    env = os.environ.get(name, "").strip()
    if env:
        return env
    key_file = INSTANCE_DIR / f"{name.lower()}.key"
    if key_file.exists():
        data = key_file.read_text().strip()
        if data:
            return data
    key = secrets.token_hex(32)
    INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
    key_file.write_text(key)
    try:
        os.chmod(key_file, 0o600)  # best-effort; no-op on some platforms
    except OSError:
        pass
    return key


class Config:
    # Unset -> a random per-install secret (see _secret), never a hardcoded one.
    SECRET_KEY = _secret("SECRET_KEY")
    JWT_SECRET_KEY = _secret("JWT_SECRET_KEY")

    # Enables the unauthenticated /api/admin/state dump. Off unless explicitly
    # opted in, independent of debug mode (which the dev entrypoint always sets).
    ADMIN_ENABLED = os.environ.get("SAVESMART_ADMIN", "").strip() == "1"

    # Default to a SQLite file living in backend/instance/savesmart.db.
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL", f"sqlite:///{BASE_DIR / 'savesmart.db'}"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    JWT_ACCESS_TOKEN_EXPIRES = timedelta(
        minutes=int(os.environ.get("JWT_ACCESS_MINUTES", "60"))
    )

    CORS_ORIGINS = [
        origin.strip()
        for origin in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
        if origin.strip()
    ]
