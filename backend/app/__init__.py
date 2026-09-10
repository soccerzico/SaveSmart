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
    from .insights.routes import insights_bp
    from .admin.routes import admin_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(accounts_bp, url_prefix="/api/accounts")
    app.register_blueprint(goals_bp, url_prefix="/api/goals")
    app.register_blueprint(recurring_bp, url_prefix="/api/recurring")
    app.register_blueprint(plaid_bp, url_prefix="/api/plaid")
    app.register_blueprint(assistant_bp, url_prefix="/api/assistant")
    app.register_blueprint(insights_bp, url_prefix="/api/insights")
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
        _ensure_columns()

    return app


# Columns create_all() won't add to tables that already exist. Keyed by table,
# each entry is column name -> the ALTER that introduces it.
_ADDITIVE_COLUMNS = {
    "accounts": {
        "source": "ALTER TABLE accounts ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'manual'",
        "plaid_item_id": "ALTER TABLE accounts ADD COLUMN plaid_item_id INTEGER",
        "plaid_account_id": "ALTER TABLE accounts ADD COLUMN plaid_account_id VARCHAR(64)",
    },
    "plaid_items": {
        "transactions_cursor": "ALTER TABLE plaid_items ADD COLUMN transactions_cursor TEXT",
    },
    "transactions": {
        "transfer_group_id": "ALTER TABLE transactions ADD COLUMN transfer_group_id VARCHAR(64)",
        "transfer_confidence": "ALTER TABLE transactions ADD COLUMN transfer_confidence INTEGER",
        "transfer_override": "ALTER TABLE transactions ADD COLUMN transfer_override VARCHAR(16)",
    },
    "snapshots": {
        # Existing rows predate reconstruction, so they are live by definition.
        "source": "ALTER TABLE snapshots ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'live'",
        "is_partial": "ALTER TABLE snapshots ADD COLUMN is_partial BOOLEAN NOT NULL DEFAULT 0",
    },
}


def _ensure_columns():
    """Additive, idempotent migration for columns create_all won't add to
    existing SQLite tables. Protects data across the schema churn while we're
    pre-Flask-Migrate. No-op on non-SQLite backends.
    """
    from sqlalchemy import text

    if db.engine.dialect.name != "sqlite":
        return

    changed = False
    for table, additions in _ADDITIVE_COLUMNS.items():
        rows = list(db.session.execute(text(f"PRAGMA table_info({table})")))
        if not rows:
            continue  # create_all() just made it with every column present
        existing = {row[1] for row in rows}
        for col, ddl in additions.items():
            if col not in existing:
                db.session.execute(text(ddl))
                changed = True
    if changed:
        db.session.commit()
