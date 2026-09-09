"""Database models.

Money is stored in integer cents to avoid floating-point rounding errors.
The API serializes to/from decimal dollars at the edges (see to_dict / the
routes), so the rest of the app and the frontend deal in plain dollar floats.
"""
import json
from datetime import datetime, timezone

from werkzeug.security import check_password_hash, generate_password_hash

from .crypto import decrypt_token, encrypt_token
from .extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def as_utc(value):
    """Re-attach UTC to a datetime read back from the database.

    SQLite has no timezone-aware datetime type, so DateTime(timezone=True)
    columns round-trip as naive values even though we always write aware
    ones. Without this, comparing them to datetime.now(timezone.utc)
    raises TypeError.
    """
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


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

# Where an account's data comes from: hand-entered vs synced from Plaid.
ACCOUNT_SOURCES = {"manual", "plaid"}

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
    plaid_items = db.relationship(
        "PlaidItem", backref="user", cascade="all, delete-orphan", lazy=True
    )
    snapshots = db.relationship(
        "Snapshot", backref="user", cascade="all, delete-orphan", lazy=True
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

    # Provenance. Manual accounts are user-editable; Plaid accounts are synced
    # and treated as a read-only baseline (see the accounts routes).
    source = db.Column(db.String(16), nullable=False, default="manual")
    plaid_item_id = db.Column(
        db.Integer, db.ForeignKey("plaid_items.id"), nullable=True, index=True
    )
    # Plaid's own account identifier; lets us upsert on re-sync. NULL for manual.
    plaid_account_id = db.Column(db.String(64), nullable=True, unique=True, index=True)

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
            "source": self.source,
            # Plaid-synced accounts are a read-only baseline in the UI.
            "editable": self.source == "manual",
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


# Which accounts count toward which goals (many-to-many). A goal's progress is
# the summed balance of its linked asset accounts — no manually-entered amount.
goal_accounts = db.Table(
    "goal_accounts",
    db.Column("goal_id", db.ForeignKey("savings_goals.id"), primary_key=True),
    db.Column("account_id", db.ForeignKey("accounts.id"), primary_key=True),
)


class SavingsGoal(db.Model):
    __tablename__ = "savings_goals"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    name = db.Column(db.String(120), nullable=False)
    target_cents = db.Column(db.Integer, nullable=False)
    # Legacy column, no longer authoritative — progress is derived from linked
    # accounts (see saved_cents). Kept to avoid a destructive migration.
    current_cents = db.Column(db.Integer, nullable=False, default=0)
    target_date = db.Column(db.Date, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    # Accounts whose balances count toward this goal.
    accounts = db.relationship(
        "Account",
        secondary=goal_accounts,
        lazy="selectin",
        backref=db.backref("goals", lazy="selectin"),
    )

    @property
    def saved_cents(self) -> int:
        """Progress toward the goal: total balance of linked asset accounts."""
        return sum(a.balance_cents for a in self.accounts if not a.is_liability)

    def to_dict(self) -> dict:
        target = self.target_cents or 0
        saved = self.saved_cents
        progress = round(saved / target * 100, 1) if target else 0.0
        return {
            "id": self.id,
            "name": self.name,
            "target_amount": round(self.target_cents / 100, 2),
            "current_amount": round(saved / 100, 2),
            "progress_pct": min(progress, 100.0),
            "linked_account_ids": sorted(a.id for a in self.accounts),
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


class PlaidItem(db.Model):
    """A linked financial institution (one Plaid 'Item' = one bank login).

    The access_token is long-lived and lets us re-pull balances without the
    user re-authenticating. POC-grade: stored in plaintext — encrypt at rest
    before this is anything but local/dev.
    """

    __tablename__ = "plaid_items"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    item_id = db.Column(db.String(64), unique=True, nullable=False, index=True)
    # Stored encrypted at rest (Fernet). The `access_token` property below
    # transparently encrypts on set and decrypts on get, so route code is
    # unchanged. DB column keeps its name; Text holds the longer ciphertext.
    _access_token = db.Column("access_token", db.Text, nullable=False)
    institution_name = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    @property
    def access_token(self) -> str:
        return decrypt_token(self._access_token)

    @access_token.setter
    def access_token(self, value: str) -> None:
        self._access_token = encrypt_token(value)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "item_id": self.item_id,
            "institution_name": self.institution_name,
            "created_at": self.created_at.isoformat(),
        }


class Snapshot(db.Model):
    """A point-in-time capture of the user's finances, written on login.

    The numeric columns are the trustworthy, queryable source of truth (the app
    writes them deterministically). `goals_json` holds the flexible per-goal
    detail without needing a child table, and `note` is a free-text lane for
    qualitative/abstract context the assistant can reason over.
    """

    __tablename__ = "snapshots"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    created_at = db.Column(
        db.DateTime(timezone=True), default=_utcnow, nullable=False, index=True
    )

    net_worth_cents = db.Column(db.Integer, nullable=False, default=0)
    assets_cents = db.Column(db.Integer, nullable=False, default=0)
    liabilities_cents = db.Column(db.Integer, nullable=False, default=0)
    monthly_income_cents = db.Column(db.Integer, nullable=False, default=0)
    monthly_expense_cents = db.Column(db.Integer, nullable=False, default=0)
    monthly_net_cents = db.Column(db.Integer, nullable=False, default=0)

    # JSON array of {name, target, current, progress_pct} per goal at capture time.
    goals_json = db.Column(db.Text, nullable=False, default="[]")
    note = db.Column(db.Text, nullable=True)

    def to_dict(self) -> dict:
        try:
            goals = json.loads(self.goals_json)
        except (TypeError, ValueError):
            goals = []
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat(),
            "net_worth": round(self.net_worth_cents / 100, 2),
            "assets": round(self.assets_cents / 100, 2),
            "liabilities": round(self.liabilities_cents / 100, 2),
            "monthly_income": round(self.monthly_income_cents / 100, 2),
            "monthly_expenses": round(self.monthly_expense_cents / 100, 2),
            "monthly_net": round(self.monthly_net_cents / 100, 2),
            "goals": goals,
            "note": self.note,
        }
