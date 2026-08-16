"""Kimlik doğrulama araçları: JWT token'lar ve şifre hash'leme.

İki token türü var:
- access token: kısa ömürlü (dakikalar), her istekte gönderilir, DB'ye
  bakılmadan doğrulanır (stateless).
- refresh token: uzun ömürlü (günler), sadece yeni access token almak
  için kullanılır. Kendisi DB'de HASH olarak tutulur (refresh_tokens
  tablosu) ki "tüm cihazlardan çıkış yap" / token iptali mümkün olsun.
"""

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

_TOKEN_TYPE_ACCESS = "access"
_TOKEN_TYPE_REFRESH = "refresh"


def hash_password(password: str) -> str:
    """Düz şifreyi bcrypt hash'ine çevirir. Hash DB'de saklanır."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    """Girilen şifre ile DB'deki hash eşleşiyor mu kontrol eder."""
    return pwd_context.verify(plain_password, password_hash)


def hash_token(raw_token: str) -> str:
    """Refresh token'ın SHA-256 hash'ini üretir.

    DB'de HAM token değil bu hash tutulur (refresh_tokens.token_hash).
    Böylece veritabanı sızsa bile saldırgan token'ları doğrudan
    kullanamaz — her seferinde gelen ham token'ı hash'leyip DB'dekiyle
    karşılaştırırız.
    """
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def create_access_token(user_id: UUID) -> str:
    """Kısa ömürlü access token üretir. DB'ye yazılmaz (stateless)."""
    expire_at = datetime.now(UTC) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "type": _TOKEN_TYPE_ACCESS,
        "iat": datetime.now(UTC),
        "exp": expire_at,
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(user_id: UUID) -> tuple[str, datetime]:
    """Uzun ömürlü refresh token üretir.

    Ham token'ı ve son geçerlilik tarihini döner. Çağıran taraf (auth
    service) bu ham token'ı kullanıcıya gönderir, hash'ini ise
    refresh_tokens tablosuna kaydeder.
    """
    expire_at = datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "type": _TOKEN_TYPE_REFRESH,
        "iat": datetime.now(UTC),
        "exp": expire_at,
    }
    token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return token, expire_at


def decode_token(token: str) -> dict[str, Any]:
    """JWT'yi çözer ve imzasını doğrular.

    Süresi dolmuş veya imzası bozuk token için jose.JWTError fırlatır;
    çağıran taraf bunu yakalayıp 401 döndürmeli.
    """
    payload: dict[str, Any] = jwt.decode(
        token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
    )
    return payload


def is_access_token(payload: dict[str, Any]) -> bool:
    return payload.get("type") == _TOKEN_TYPE_ACCESS


def is_refresh_token(payload: dict[str, Any]) -> bool:
    return payload.get("type") == _TOKEN_TYPE_REFRESH


__all__ = [
    "JWTError",
    "create_access_token",
    "create_refresh_token",
    "decode_token",
    "hash_password",
    "hash_token",
    "is_access_token",
    "is_refresh_token",
    "verify_password",
]