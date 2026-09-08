"""body_measurements table + users personal fields

Revision ID: 4ffcb5a98d66
Revises: 6ad6922ce3aa
Create Date: 2026-09-08 00:00:00.000000

Kişisel bilgiler (Personal Details) ve kilo geçmişi (Weight History) için.
"Mevcut kilo" users'a tek bir kolon olarak eklenmedi: en son satır zaten
mevcut kilo demek, ama trend ekranı geçmişteki tüm satırlara da ihtiyaç
duyuyor. body_measurements adı weight_logs değil, çünkü ileride vücut yağı
ve çevre ölçümleri de aynı tabloya girecek.

set_updated_at() fonksiyonu zaten schema_v1.sql'de var (readiness_logs,
workouts vb. onu kullanıyor), burada yeniden oluşturmuyoruz.

Gerçek PostgreSQL'e karşı doğrulandı (body_measurements_schema.sql).
"""

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4ffcb5a98d66"
down_revision: str | None = "6ad6922ce3aa"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN height_cm NUMERIC(5,1) "
        "CHECK (height_cm BETWEEN 50 AND 300)"
    )
    op.execute("ALTER TABLE users ADD COLUMN date_of_birth DATE")
    op.execute(
        "ALTER TABLE users ADD COLUMN gender TEXT "
        "CHECK (gender IN ('male','female','other','prefer_not_to_say'))"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN goal_weight_kg NUMERIC(5,1) "
        "CHECK (goal_weight_kg BETWEEN 20 AND 400)"
    )

    op.execute(
        """
        CREATE TABLE body_measurements (
            id            BIGSERIAL    PRIMARY KEY,
            user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            measured_on   DATE         NOT NULL,
            weight_kg     NUMERIC(5,1) NOT NULL CHECK (weight_kg BETWEEN 20 AND 400),
            body_fat_pct  NUMERIC(4,1) CHECK (body_fat_pct BETWEEN 1 AND 70),
            notes         TEXT,
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
            UNIQUE (user_id, measured_on)
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_body_measurements_user_date "
        "ON body_measurements(user_id, measured_on DESC)"
    )
    op.execute(
        """
        CREATE TRIGGER body_measurements_set_updated_at
            BEFORE UPDATE ON body_measurements
            FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE body_measurements")
    op.execute("ALTER TABLE users DROP COLUMN goal_weight_kg")
    op.execute("ALTER TABLE users DROP COLUMN gender")
    op.execute("ALTER TABLE users DROP COLUMN date_of_birth")
    op.execute("ALTER TABLE users DROP COLUMN height_cm")
