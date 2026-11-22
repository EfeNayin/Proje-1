"""Encryption at rest for the few provider secrets the server has to keep.

Today that is one thing: the refresh token Apple hands out when a sign-in's authorization
code is exchanged. It is kept only so the account's Apple authorization can be revoked when
the account is deleted (Apple requires this), and it signs nobody in.

Fernet (AES-128-CBC with HMAC-SHA256, from the `cryptography` package that python-jose
already depends on) under a key of its own, SOCIAL_TOKEN_ENCRYPTION_KEY. The key is not
derived from JWT_SECRET_KEY on purpose: rotating the JWT secret signs everyone out, and
should not also make every stored Apple token unreadable. A token that cannot be decrypted
(rotated key, damaged value) is treated as absent: the revocation is skipped, never the
deletion.
"""

from cryptography.fernet import Fernet, InvalidToken


class SecretBox:
    def __init__(self, key: str) -> None:
        # Raises ValueError for anything that is not a url-safe base64 32-byte key.
        self._fernet = Fernet(key.encode())

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, token: str) -> str | None:
        """The plaintext, or None when this key cannot read it."""
        try:
            return self._fernet.decrypt(token.encode()).decode()
        except (InvalidToken, ValueError):
            return None


def is_valid_key(key: str) -> bool:
    try:
        SecretBox(key)
    except ValueError:
        return False
    return True
