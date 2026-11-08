"""Sign in with Google and Apple: linked identities, onboarding challenges, nonces.

Revision ID: c7d9f3a2b6e1
Revises: b3c7e9a1d452

Additive, except for one relaxed constraint.

* users.password_hash becomes nullable. An account created with a provider has no
  password; storing a dummy one would be a credential nobody knows and nobody can
  rotate. Every existing row keeps its hash, so nothing about a password account changes.
* user_identities: (provider, subject) is unique, and so is (user_id, provider). Deleted
  with the account.
* social_signup_challenges: a verified provider identity waiting for onboarding. No user
  row exists until onboarding completes. Short-lived; only a hash of its token is stored.
* social_nonces: single-use values an Apple credential must carry. Only hashes.

Rollout: apply this before any code that can create a provider-only account (the feature
is off until SOCIAL_GOOGLE_ENABLED / SOCIAL_APPLE_ENABLED are set, so applying it changes
no behaviour). Code from before this revision treats password_hash as always present, so
it must not run against a database that already holds a provider-only account.

Rollback: downgrade() REFUSES while any account has no password, because putting NOT NULL
back would otherwise have to invent a password for it or delete the account. Turn the
provider flags off, and either give those accounts a password (they can only get one through
a support-assisted reset, as recovery does not apply to passwordless accounts) or delete
them, then downgrade. Dropping the three tables loses every linked identity.
"""

import sqlalchemy as sa

from alembic import op

revision: str = "c7d9f3a2b6e1"
down_revision: str | None = "b3c7e9a1d452"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.alter_column("users", "password_hash", existing_type=sa.Text(), nullable=True)

    op.create_table(
        "user_identities",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("email_verified", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "is_private_email", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("apple_refresh_token_encrypted", sa.Text(), nullable=True),
        sa.Column("authorization_revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "provider IN ('google', 'apple')", name="user_identities_provider_check"
        ),
        sa.CheckConstraint("subject <> ''", name="user_identities_subject_check"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "subject", name="user_identities_provider_subject_key"),
        sa.UniqueConstraint("user_id", "provider", name="user_identities_user_provider_key"),
    )

    op.create_table(
        "social_signup_challenges",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("email_verified", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "is_private_email", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("first_name", sa.Text(), nullable=True),
        sa.Column("last_name", sa.Text(), nullable=True),
        sa.Column("apple_refresh_token_encrypted", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "provider IN ('google', 'apple')", name="social_signup_challenges_provider_check"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "idx_social_signup_challenges_expires_at", "social_signup_challenges", ["expires_at"]
    )

    op.create_table(
        "social_nonces",
        sa.Column("nonce_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("nonce_hash"),
    )
    op.create_index("idx_social_nonces_expires_at", "social_nonces", ["expires_at"])


def downgrade() -> None:
    bind = op.get_bind()
    passwordless = bind.execute(
        sa.text("SELECT count(*) FROM users WHERE password_hash IS NULL")
    ).scalar_one()
    if passwordless:
        raise RuntimeError(
            f"{passwordless} account(s) have no password (created with Google or Apple). "
            "Refusing to downgrade: restoring NOT NULL would have to invent passwords or "
            "delete accounts. Give them a password or delete them first."
        )

    op.drop_index("idx_social_nonces_expires_at", table_name="social_nonces")
    op.drop_table("social_nonces")
    op.drop_index(
        "idx_social_signup_challenges_expires_at", table_name="social_signup_challenges"
    )
    op.drop_table("social_signup_challenges")
    op.drop_table("user_identities")
    op.alter_column("users", "password_hash", existing_type=sa.Text(), nullable=False)
