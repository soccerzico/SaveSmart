"""Tiny SQLite store for Plaid Items (one row per linked institution).

A Plaid "Item" is a single login at a financial institution. Exchanging a
public_token gives us a long-lived access_token, which we persist here so we
can pull balances later without re-linking.

POC-grade storage: the access_token is kept in plaintext in a local SQLite
file. For anything real, encrypt it at rest / use a secrets manager.
"""
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "dashboard.db"


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS items (
                item_id          TEXT PRIMARY KEY,
                access_token     TEXT NOT NULL,
                institution_name TEXT,
                created_at       TEXT NOT NULL
            )
            """
        )


def save_item(item_id: str, access_token: str, institution_name: str | None):
    with _connect() as conn:
        # Upsert: re-linking the same institution updates the token in place.
        conn.execute(
            """
            INSERT INTO items (item_id, access_token, institution_name, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(item_id) DO UPDATE SET
                access_token = excluded.access_token,
                institution_name = excluded.institution_name
            """,
            (item_id, access_token, institution_name, datetime.now(timezone.utc).isoformat()),
        )


def get_items() -> list[sqlite3.Row]:
    with _connect() as conn:
        return conn.execute(
            "SELECT item_id, access_token, institution_name, created_at "
            "FROM items ORDER BY created_at ASC"
        ).fetchall()


def delete_item(item_id: str):
    with _connect() as conn:
        conn.execute("DELETE FROM items WHERE item_id = ?", (item_id,))
