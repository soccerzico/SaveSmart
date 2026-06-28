"""Database models.

Money is stored in integer cents to avoid floating-point rounding errors.
The API serializes to/from decimal dollars at the edges (see to_dict / the
routes), so the rest of the app and the frontend deal in plain dollar floats.
"""
from datetime import datetime, timezone

from werkzeug.security import check_password_hash, generate_password_hash

from .extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


# Account types we support today. Manual entry only for now; later these map
# onto whatever an aggregation API (Plaid, etc.) hands us.
ACCOUNT_TYPES = {
    "checking",
    "savings",
    "credit_card",
    "investment",
    "loan",
    "cash",
}

# Recurring cashflow items are either money in or money out.
DIRECTIONS = {"income", "expense"}

# Supported recurrence intervals and how many times they occur per month, used
# to normalize everything onto a common monthly basis for cashflow math.
# (Weekly/biweekly use the average: 52 and 26 occurrences spread over 12 months.)
FREQUENCIES = {"weekly", "biweekly", "monthly", "quarterly", "annually"}
_MONTHLY_FACTOR = {
    "weekly": 52 / 12,
    "biweekly": 26 / 12,
    "monthly": 1.0,
    "quarterly": 1 / 3,
    "annually": 1 / 12,
}


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    accounts = db.relationship(
        "Account", backref="user", cascade="all, delete-orphan", lazy=True
    )
    goals = db.relationship(
        "SavingsGoal", backref="user", cascade="all, delete-orphan", lazy=True
    )

    def set_password(self, password: str) -> None:
        # pbkdf2:sha256 is bundled with werkzeug — no native deps to compile.
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "created_at": self.created_at.isoformat(),
        }


class Account(db.Model):
    __tablename__ = "accounts"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    name = db.Column(db.String(120), nullable=False)
    account_type = db.Column(db.String(32), nullable=False)
    institution = db.Column(db.String(120), nullable=True)
    # Stored in cents. For credit cards / loans this represents what you owe
    # (a balance you carry); the frontend labels it as a liability.
    balance_cents = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    @property
    def is_liability(self) -> bool:
        return self.account_type in {"credit_card", "loan"}

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "account_type": self.account_type,
            "institution": self.institution,
            "balance": round(self.balance_cents / 100, 2),
            "is_liability": self.is_liability,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class SavingsGoal(db.Model):
    __tablename__ = "savings_goals"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    name = db.Column(db.String(120), nullable=False)
    target_cents = db.Column(db.Integer, nullable=False)
    current_cents = db.Column(db.Integer, nullable=False, default=0)
    target_date = db.Column(db.Date, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    def to_dict(self) -> dict:
        target = self.target_cents or 0
        progress = round(self.current_cents / target * 100, 1) if target else 0.0
        return {
            "id": self.id,
            "name": self.name,
            "target_amount": round(self.target_cents / 100, 2),
            "current_amount": round(self.current_cents / 100, 2),
            "progress_pct": min(progress, 100.0),
            "target_date": self.target_date.isoformat() if self.target_date else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class RecurringTransaction(db.Model):
    """A recurring income or expense, used to derive monthly cashflow.

    Manual entry for now. Each row is normalized to a monthly amount via
    `monthly_cents` so income and expenses on different cadences can be summed.
    """

    __tablename__ = "recurring_transactions"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    name = db.Column(db.String(120), nullable=False)
    direction = db.Column(db.String(16), nullable=False)  # income | expense
    amount_cents = db.Column(db.Integer, nullable=False)
    frequency = db.Column(db.String(16), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    @property
    def monthly_cents(self) -> float:
        """This item's contribution to a monthly budget, in (fractional) cents."""
        return self.amount_cents * _MONTHLY_FACTOR[self.frequency]

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "direction": self.direction,
            "frequency": self.frequency,
            "amount": round(self.amount_cents / 100, 2),
            "monthly_amount": round(self.monthly_cents / 100, 2),
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
