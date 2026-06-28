"""Shared extension instances.

Kept separate from the app factory to avoid circular imports: models import
`db` from here, the factory imports both.
"""
from flask_jwt_extended import JWTManager
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
jwt = JWTManager()
