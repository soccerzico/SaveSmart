"""Symmetric encryption for secrets at rest (Plaid access tokens).

Uses Fernet (authenticated AES-128-CBC + HMAC). Encrypted values are tagged with
an "enc:v1:" prefix so we can tell them apart from legacy plaintext and migrate
incrementally.

Key resolution (first match wins), so a fresh install "just works":
  1. TOKEN_ENCRYPTION_KEY environment variable (explicit; set this in prod)
  2. an existing key file at backend/instance/token.key
  3. otherwise, generate a new key and persist it to that file

The key file lives in the gitignored instance/ folder, so it's never committed
and each install gets its own stable key.
"""
import logging
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

log = logging.getLogger("savesmart.crypto")

_PREFIX = "enc:v1:"
_KEY_FILE = Path(__file__).resolve().parent.parent / "instance" / "token.key"

# Resolve the key once per process.
_cached: Fernet | None = None
_resolved = False


def _resolve_key() -> bytes | None:
    env = os.environ.get("TOKEN_ENCRYPTION_KEY", "").strip()
    if env:
        return env.encode()

    try:
        if _KEY_FILE.exists():
            data = _KEY_FILE.read_text().strip()
            if data:
                return data.encode()
    except OSError as exc:
        log.error("Could not read key file %s: %s", _KEY_FILE, exc)

    # Auto-generate and persist so the next run reuses the same key.
    try:
        _KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
        key = Fernet.generate_key()
        _KEY_FILE.write_text(key.decode())
        try:
            os.chmod(_KEY_FILE, 0o600)  # best-effort; no-op on some platforms
        except OSError:
            pass
        log.info("Generated a new secrets-encryption key at %s", _KEY_FILE)
        return key
    except OSError as exc:
        log.error("Could not create key file %s: %s", _KEY_FILE, exc)
        return None


def _fernet() -> Fernet | None:
    global _cached, _resolved
    if _resolved:
        return _cached
    key = _resolve_key()
    if key is None:
        _cached = None
    else:
        try:
            _cached = Fernet(key)
        except (ValueError, TypeError):
            log.error("Encryption key is invalid; secrets will not be encrypted.")
            _cached = None
    _resolved = True
    return _cached


def is_configured() -> bool:
    return _fernet() is not None


def encrypt_token(plaintext: str | None) -> str | None:
    """Return an encrypted, prefixed value. No-ops on empty, already-encrypted,
    or (dev fallback) when no key is configured."""
    if not plaintext or plaintext.startswith(_PREFIX):
        return plaintext
    f = _fernet()
    if f is None:
        # No key: store plaintext so the app still works in dev. A warning is
        # logged at app startup (see the factory) rather than per-write.
        return plaintext
    return _PREFIX + f.encrypt(plaintext.encode()).decode()


def decrypt_token(stored: str | None) -> str | None:
    """Inverse of encrypt_token. Legacy plaintext (no prefix) passes through."""
    if not stored or not stored.startswith(_PREFIX):
        return stored
    f = _fernet()
    if f is None:
        raise RuntimeError(
            "Encrypted token found but TOKEN_ENCRYPTION_KEY is missing/invalid."
        )
    try:
        return f.decrypt(stored[len(_PREFIX):].encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError("Cannot decrypt token — key mismatch.") from exc
