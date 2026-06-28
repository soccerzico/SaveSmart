"""Application factory.

Usage:
    from app import create_app
    app = create_app()
"""
from flask import Flask
from flask_cors import CORS

from .config import Config
from .extensions import db, jwt


def create_app(config_object: type = Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object)

    db.init_app(app)
    jwt.init_app(app)
    CORS(
        app,
        resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
        supports_credentials=True,
    )

    # Import models so SQLAlchemy is aware of them before create_all.
    from . import models  # noqa: F401

    # Register blueprints.
    from .auth.routes import auth_bp
    from .accounts.routes import accounts_bp
    from .goals.routes import goals_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(accounts_bp, url_prefix="/api/accounts")
    app.register_blueprint(goals_bp, url_prefix="/api/goals")

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

    return app
