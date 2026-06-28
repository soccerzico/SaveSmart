"""Application configuration loaded from environment variables.

Defaults are dev-friendly. Anything secret must be overridden via a .env file
(see .env.example) before this runs anywhere that isn't your laptop.
"""
import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

# Load .env sitting next to the backend/ root.
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Config:
    # Dev defaults are >=32 bytes so JWT signing doesn't warn. NEVER ship these:
    # set SECRET_KEY / JWT_SECRET_KEY via .env in any real environment.
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-secret-key-change-me-please-0123456789")
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-only-jwt-secret-change-me-please-0123456789")

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
