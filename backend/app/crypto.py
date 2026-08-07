"""Symmetric encryption for secrets at rest (Plaid access tokens).

Uses Fernet (authenticated AES-128-CBC + HMAC) with a key from the
TOKEN_ENCRYPTION_KEY environment variable. Encrypted values are tagged with an
"enc:v1:" prefix so we can tell them apart from legacy plaintext and migrate
incrementally.

Generate a key with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""
import logging
import os

from cryptography.fernet import Fernet, InvalidToken

log = logging.getLogger("savesmart.crypto")

_PREFIX = "enc:v1:"


def _fernet() -> Fernet | None:
    key = os.environ.get("TOKEN_ENCRYPTION_KEY", "").strip()
    if not key:
        return None
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError):
        log.error(
            "TOKEN_ENCRYPTION_KEY is set but invalid; secrets will not be encrypted."
        )
        return None


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
