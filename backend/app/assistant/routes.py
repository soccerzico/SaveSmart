"""Financial assistant — a Claude Haiku chat scoped to the user's own data.

The app builds a compact context block (current finances + recent snapshot
history) and sends it as the system prompt so the model can answer questions
about goals, balances, and progress over time. It reads snapshots but never
writes the numbers — those are owned by the app (see snapshots.py).

Requires ANTHROPIC_API_KEY in the environment. If it's absent, the endpoints
degrade gracefully with a clear 'not configured' response.
"""
import json
import logging
import os

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..models import Snapshot, User
from ..snapshots import build_snapshot_values, write_snapshot
from ..utils import ApiError

# Imported defensively so the app still boots if 'anthropic' isn't installed.
try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None

assistant_bp = Blueprint("assistant", __name__)
log = logging.getLogger("savesmart.assistant")

# The user explicitly asked for Haiku; it's fast and cheap for this chat use.
MODEL = "claude-haiku-4-5"
MAX_TOKENS = 1024
MAX_HISTORY_MESSAGES = 20  # cap conversation length sent to the API

def _current_user_id() -> int:
    return int(get_jwt_identity())


def _api_key() -> str | None:
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    return key or None


def _dollars(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def _build_system_prompt(user_id: int) -> str:
    """Assemble the model's context: who it is, current finances, and history."""
    now = build_snapshot_values(user_id)
    goals = json.loads(now["goals_json"])

    lines = [
        "You are SaveSmart's financial assistant. You help the user understand "
        "their savings goals, accounts, and financial progress over time. Be "
        "concise, encouraging, and specific. Use the data below; if something "
        "isn't in the data, say so rather than guessing. Do not give regulated "
        "financial, tax, or investment advice — offer general guidance only.",
        "",
        "== CURRENT SNAPSHOT ==",
        f"Net worth: {_dollars(now['net_worth_cents'])}",
        f"Assets: {_dollars(now['assets_cents'])}",
        f"Liabilities: {_dollars(now['liabilities_cents'])}",
        f"Monthly income: {_dollars(now['monthly_income_cents'])}",
        f"Monthly expenses: {_dollars(now['monthly_expense_cents'])}",
        f"Monthly surplus: {_dollars(now['monthly_net_cents'])}",
    ]

    if goals:
        lines.append("Goals:")
        for g in goals:
            lines.append(
                f"  - {g['name']}: ${g['current']:,.2f} of ${g['target']:,.2f} "
                f"({g['progress_pct']}%)"
            )
    else:
        lines.append("Goals: none yet.")

    # Recent history so the model can speak to trends.
    history = (
        Snapshot.query.filter_by(user_id=user_id)
        .order_by(Snapshot.created_at.desc())
        .limit(8)
        .all()
    )
    if len(history) > 1:
        lines.append("")
        lines.append("== RECENT HISTORY (most recent first) ==")
        for s in history:
            lines.append(
                f"  {s.created_at.date().isoformat()}: net worth "
                f"{_dollars(s.net_worth_cents)}, surplus "
                f"{_dollars(s.monthly_net_cents)}"
            )

    return "\n".join(lines)


@assistant_bp.get("/status")
@jwt_required()
def status():
    return jsonify({"configured": _api_key() is not None, "model": MODEL})


@assistant_bp.get("/snapshots")
@jwt_required()
def list_snapshots():
    snaps = (
        Snapshot.query.filter_by(user_id=_current_user_id())
        .order_by(Snapshot.created_at.desc())
        .limit(60)
        .all()
    )
    return jsonify({"snapshots": [s.to_dict() for s in snaps]})


@assistant_bp.post("/snapshots")
@jwt_required()
def capture_snapshot():
    """Force-capture a snapshot now (bypasses the min-interval guard)."""
    snap = write_snapshot(_current_user_id(), force=True)
    return jsonify({"snapshot": snap.to_dict()}), 201


@assistant_bp.post("/chat")
@jwt_required()
def chat():
    if _api_key() is None or anthropic is None:
        raise ApiError(
            "The assistant isn't configured. Add ANTHROPIC_API_KEY to "
            "backend/.env and restart the server.",
            status=400,
        )

    data = request.get_json(silent=True) or {}
    raw_messages = data.get("messages")
    if not isinstance(raw_messages, list) or not raw_messages:
        raise ApiError("'messages' must be a non-empty list.")

    # Sanitize: only user/assistant roles with string content, and cap length.
    messages = []
    for m in raw_messages[-MAX_HISTORY_MESSAGES:]:
        role = m.get("role")
        content = m.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            continue
        messages.append({"role": role, "content": content})
    if not messages or messages[-1]["role"] != "user":
        raise ApiError("The last message must be from the user.")

    user_id = _current_user_id()
    user = User.query.get(user_id)
    if not user:
        raise ApiError("User not found.", status=404)

    client = anthropic.Anthropic(api_key=_api_key())
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=_build_system_prompt(user_id),
            messages=messages,
        )
    except anthropic.APIStatusError as exc:
        message = getattr(exc, "message", str(exc))
        log.error("Anthropic API error (%s): %s", exc.status_code, message)
        # Surface actionable client-side problems (billing, auth, rate limit)
        # directly so the user knows what to fix; hide raw 5xx internals.
        if exc.status_code in (400, 401, 402, 403, 429):
            raise ApiError(f"Assistant error: {message}", status=502)
        raise ApiError("The assistant is temporarily unavailable.", status=502)
    except anthropic.APIConnectionError:
        log.error("Anthropic connection error")
        raise ApiError("Could not reach the assistant service.", status=502)

    reply = next((b.text for b in response.content if b.type == "text"), "")
    log.info("Assistant reply to user=%s (%d output tokens)", user_id, response.usage.output_tokens)
    return jsonify({"reply": reply})
