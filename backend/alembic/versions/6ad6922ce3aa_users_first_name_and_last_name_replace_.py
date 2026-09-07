"""users first_name and last_name replace display_name

Revision ID: 6ad6922ce3aa
Revises: e272543ef2bb
Create Date: 2026-09-07 20:28:41.344491

display_name'i first_name/last_name'e böler ve display_name kolonunu siler.
İki örtüşen kavram (display_name + first/last) tutmak senkron kalmaz; gösterim
adı artık first_name + last_name'den türetiliyor (ikisi de boşsa username).

Bölme kuralı: ilk boşluktan önceki kısım first_name, sonrası last_name.
Tek isimlilerde (boşluk yok) last_name NULL kalır — split_part boşluk
bulamazsa tüm string'i döner, substring(... FROM position(...)+1) de aynı
durumda tüm string'i döner, bu yüzden NULLIF ile "sonuç orijinalle aynıysa
NULL say" diyoruz. Gerçek PostgreSQL'e karşı doğrulandı.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6ad6922ce3aa"
down_revision: str | None = "e272543ef2bb"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN first_name TEXT")
    op.execute("ALTER TABLE users ADD COLUMN last_name TEXT")
    op.execute(
        "UPDATE users SET "
        "first_name = split_part(display_name, ' ', 1), "
        "last_name = NULLIF("
        "substring(display_name FROM position(' ' IN display_name) + 1), "
        "display_name"
        ") "
        "WHERE display_name IS NOT NULL"
    )
    op.execute("ALTER TABLE users DROP COLUMN display_name")


def downgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN display_name TEXT")
    # concat_ws NULL parçaları atlayıp tek boşlukla birleştirir; ikisi de
    # NULL'sa '' döner, NULLIF('', '') bunu NULL'a çevirir — orijinal
    # "boşsa NULL" davranışını korur.
    op.execute(
        "UPDATE users SET "
        "display_name = NULLIF(trim(concat_ws(' ', first_name, last_name)), '')"
    )
    op.execute("ALTER TABLE users DROP COLUMN first_name")
    op.execute("ALTER TABLE users DROP COLUMN last_name")
