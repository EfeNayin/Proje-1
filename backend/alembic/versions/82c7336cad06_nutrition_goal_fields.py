"""nutrition goal fields

Revision ID: 82c7336cad06
Revises: 4ffcb5a98d66
Create Date: 2026-09-08 18:35:56.393414

Kalori ve makro hedefleri (Beslenme Hedefleri ekranı) için. users'a
eklendiler çünkü bunlar ZAMAN SERİSİ DEĞİL, o anki geçerli hedefler
(kilo öyle değil, o body_measurements'ta).

activity_level ve nutrition_goal, Mifflin-St Jeor formülünün başka yerden
türetilemeyen iki girdisi. calorie_goal/protein_goal_g/carb_goal_g/
fat_goal_g otomatik hesaplanır AMA kullanıcı üzerine yazabilir; o yüzden
türetilmiş değil, saklanan değerler. CHECK sınırları saçma girişleri
(300 kcal, 900 g protein) engelliyor — sağlıkla ilgili sayılar.

`alembic revision --autogenerate` CHECK constraint'leri yakalamadı (beklenen
davranış, bkz. CLAUDE.md) — elle eklendi. Gerçek PostgreSQL'e karşı
doğrulandı (nutrition_goals_schema.sql).
"""

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "82c7336cad06"
down_revision: str | None = "4ffcb5a98d66"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN activity_level TEXT "
        "CHECK (activity_level IN ('sedentary','light','moderate','active','very_active'))"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN nutrition_goal TEXT "
        "CHECK (nutrition_goal IN ('cut','maintain','bulk'))"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN calorie_goal INTEGER "
        "CHECK (calorie_goal BETWEEN 800 AND 8000)"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN protein_goal_g SMALLINT "
        "CHECK (protein_goal_g BETWEEN 0 AND 500)"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN carb_goal_g SMALLINT "
        "CHECK (carb_goal_g BETWEEN 0 AND 1000)"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN fat_goal_g SMALLINT "
        "CHECK (fat_goal_g BETWEEN 0 AND 400)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN fat_goal_g")
    op.execute("ALTER TABLE users DROP COLUMN carb_goal_g")
    op.execute("ALTER TABLE users DROP COLUMN protein_goal_g")
    op.execute("ALTER TABLE users DROP COLUMN calorie_goal")
    op.execute("ALTER TABLE users DROP COLUMN nutrition_goal")
    op.execute("ALTER TABLE users DROP COLUMN activity_level")
