"""Application factory.

Usage:
    from app import create_app
    app = create_app()
"""
from flask import Flask
from flask_cors import CORS

from .config import Config
from .extensions import db, jwt
from .logging_config import configure_logging


def create_app(config_object: type = Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object)

    configure_logging(app)
    db.init_app(app)
    jwt.init_app(app)
    CORS(
        app,
        resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
        supports_credentials=True,
    )

    # Import models so SQLAlchemy is aware of them before create_all.
    from . import models  # noqa: F401

    # A key auto-generates on first use; warn only if that failed (e.g. the
    # instance/ folder isn't writable), which would leave tokens in plaintext.
    from .crypto import is_configured as _crypto_configured

    if not _crypto_configured():
        app.logger.warning(
            "Secrets-at-rest encryption is NOT active (could not load or create "
            "a key) — Plaid access tokens will be stored in PLAINTEXT."
        )

    # Register blueprints.
    from .auth.routes import auth_bp
    from .accounts.routes import accounts_bp
    from .goals.routes import goals_bp
    from .recurring.routes import recurring_bp
    from .plaid.routes import plaid_bp
    from .assistant.routes import assistant_bp
    from .admin.routes import admin_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(accounts_bp, url_prefix="/api/accounts")
    app.register_blueprint(goals_bp, url_prefix="/api/goals")
    app.register_blueprint(recurring_bp, url_prefix="/api/recurring")
    app.register_blueprint(plaid_bp, url_prefix="/api/plaid")
    app.register_blueprint(assistant_bp, url_prefix="/api/assistant")
    # Dev-only; the route itself 404s when not in debug mode.
    app.register_blueprint(admin_bp, url_prefix="/api/admin")

    # Translate ApiError raised anywhere in a route into a JSON response.
    from .utils import ApiError, error_response

    @app.errorhandler(ApiError)
    def handle_api_error(err: ApiError):
        return error_response(err.message, err.status)

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    # Create tables on first run. For real schema changes we'll add migrations
    # (Flask-Migrate) later; create_all is fine while the schema is young.
    with app.app_context():
        db.create_all()
        _ensure_account_columns()

    return app


def _ensure_account_columns():
    """Additive, idempotent migration for columns create_all won't add to an
    existing SQLite `accounts` table. Protects data across the schema churn
    while we're pre-Flask-Migrate. No-op on non-SQLite backends.
    """
    from sqlalchemy import text

    if db.engine.dialect.name != "sqlite":
        return
    existing = {
        row[1] for row in db.session.execute(text("PRAGMA table_info(accounts)"))
    }
    additions = {
        "source": "ALTER TABLE accounts ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'manual'",
        "plaid_item_id": "ALTER TABLE accounts ADD COLUMN plaid_item_id INTEGER",
        "plaid_account_id": "ALTER TABLE accounts ADD COLUMN plaid_account_id VARCHAR(64)",
    }
    changed = False
    for col, ddl in additions.items():
        if col not in existing:
            db.session.execute(text(ddl))
            changed = True
    if changed:
        db.session.commit()
