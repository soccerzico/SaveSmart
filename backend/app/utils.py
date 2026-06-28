"""Small request-parsing helpers shared across blueprints."""
from flask import jsonify


class ApiError(Exception):
    """Raise inside a route to short-circuit with a JSON error + status."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def error_response(message: str, status: int = 400):
    return jsonify({"error": message}), status


def dollars_to_cents(value, field: str) -> int:
    """Convert an incoming dollar amount (number or numeric string) to cents."""
    if value is None:
        raise ApiError(f"'{field}' is required.")
    try:
        # Round to nearest cent; handles floats like 19.99 cleanly enough.
        return round(float(value) * 100)
    except (TypeError, ValueError):
        raise ApiError(f"'{field}' must be a number.")


def require_str(data: dict, field: str, max_len: int = 255) -> str:
    value = (data.get(field) or "").strip()
    if not value:
        raise ApiError(f"'{field}' is required.")
    if len(value) > max_len:
        raise ApiError(f"'{field}' must be at most {max_len} characters.")
    return value
