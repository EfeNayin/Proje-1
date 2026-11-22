"""Sign-in with a provider (Google, Apple): linked identities and their short-lived records.

Maps to user_identities, social_signup_challenges and social_nonces
(migration c7d9f3a2b6e1).

An identity is keyed by (provider, subject): the subject is the provider's stable id for the
person (Google's and Apple's `sub`). The email a provider reports is contact data and can
change, so it is never a key and never grants access to an account (see
app/domains/auth/social.py).
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at

PROVIDERS = ("google", "apple")


class UserIdentity(Base):
    """One provider account linked to one Aures account.

    Internal and low-volume per user, never in a URL: BIGSERIAL. At most one identity per
    provider per account (a second Google account is refused, not silently added), and a
    provider account belongs to at most one Aures account (unique provider + subject), which
    is what makes concurrent first sign-ins and a link attempt for an identity that is
    already linked elsewhere safe: the database refuses the second writer.
    """

    __tablename__ = "user_identities"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[str] = mapped_column(Text, nullable=False)

    # What the provider last reported. Contact data for display; unverified by us, not unique.
    email: Mapped[str | None] = mapped_column(Text)
    email_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    # Apple's relay address ("...@privaterelay.appleid.com"): a real inbox, but not the
    # person's own address, so it never matches an existing account by itself.
    is_private_email: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    # Apple only: the refresh token the authorization code was exchanged for, encrypted
    # (app/core/secretbox.py). It exists to revoke the authorization when the account is
    # deleted; it signs nobody in.
    apple_refresh_token_encrypted: Mapped[str | None] = mapped_column(Text)
    # Apple told us the person withdrew consent (or deleted their Apple ID). Sessions ended
    # then; signing in with Apple again is a fresh authorization and clears it.
    authorization_revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[created_at]
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("provider", "subject", name="user_identities_provider_subject_key"),
        UniqueConstraint("user_id", "provider", name="user_identities_user_provider_key"),
        CheckConstraint("provider IN ('google', 'apple')", name="user_identities_provider_check"),
        CheckConstraint("subject <> ''", name="user_identities_subject_check"),
    )

    def __repr__(self) -> str:
        return f"<UserIdentity id={self.id} provider={self.provider}>"


class SocialSignupChallenge(Base):
    """A verified provider identity that has no Aures account yet, waiting for onboarding.

    Created when a provider credential verified but matched no linked identity. The app
    then asks for the account details (username, timezone) and calls complete, or links to
    an existing account with its password. Nothing is created before that: no partial
    account exists. Short-lived and single-use: completing or linking marks it consumed in
    the same transaction that creates the account, so a failure (a taken username) leaves it
    usable, and a repeat finds it spent. Only a hash of its token is stored.
    """

    __tablename__ = "social_signup_challenges"

    id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str | None] = mapped_column(Text)
    email_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    is_private_email: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    first_name: Mapped[str | None] = mapped_column(Text)
    last_name: Mapped[str | None] = mapped_column(Text)
    apple_refresh_token_encrypted: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[created_at]

    __table_args__ = (
        CheckConstraint(
            "provider IN ('google', 'apple')", name="social_signup_challenges_provider_check"
        ),
        Index("idx_social_signup_challenges_expires_at", "expires_at"),
    )


class SocialNonce(Base):
    """A server-issued, single-use value an Apple credential must carry (replay protection).

    Only its hash is stored. Using it deletes it in one statement, so two requests presenting
    the same value cannot both succeed; an unused one expires after a few minutes.
    """

    __tablename__ = "social_nonces"

    nonce_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[created_at]

    __table_args__ = (Index("idx_social_nonces_expires_at", "expires_at"),)
