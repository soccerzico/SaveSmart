"""Authentication: register, login, and 'who am I'.

JWT access tokens are returned to the client, which stores them and sends them
as `Authorization: Bearer <token>`. We use the user id (as a string) for the
token identity.
"""
from email_validator import EmailNotValidError, validate_email
from flask import Blueprint, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    get_jwt_identity,
    jwt_required,
)

from ..extensions import db
from ..models import User
from ..utils import ApiError, require_str

auth_bp = Blueprint("auth", __name__)

MIN_PASSWORD_LEN = 8


def _normalize_email(raw: str) -> str:
    try:
        # check_deliverability=False keeps registration offline-friendly and
        # avoids a DNS lookup on every signup.
        return validate_email(raw, check_deliverability=False).normalized.lower()
    except EmailNotValidError as exc:
        raise ApiError(f"Invalid email: {exc}")


@auth_bp.post("/register")
def register():
    data = request.get_json(silent=True) or {}
    email = _normalize_email(require_str(data, "email"))
    password = data.get("password") or ""

    if len(password) < MIN_PASSWORD_LEN:
        raise ApiError(f"Password must be at least {MIN_PASSWORD_LEN} characters.")

    if User.query.filter_by(email=email).first():
        raise ApiError("An account with that email already exists.", status=409)

    user = User(email=email)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    token = create_access_token(identity=str(user.id))
    return jsonify({"access_token": token, "user": user.to_dict()}), 201


@auth_bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    email = _normalize_email(require_str(data, "email"))
    password = data.get("password") or ""

    user = User.query.filter_by(email=email).first()
    # Same error whether the email is unknown or the password is wrong, so we
    # don't leak which emails are registered.
    if not user or not user.check_password(password):
        raise ApiError("Invalid email or password.", status=401)

    token = create_access_token(identity=str(user.id))
    return jsonify({"access_token": token, "user": user.to_dict()})


@auth_bp.get("/me")
@jwt_required()
def me():
    user = User.query.get(int(get_jwt_identity()))
    if not user:
        raise ApiError("User not found.", status=404)
    return jsonify({"user": user.to_dict()})
