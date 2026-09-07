"""baseline: initial schema (schema_v1.sql)

Revision ID: e272543ef2bb
Revises:
Create Date: 2026-09-07 15:06:16.356581

Bu migration db/schema_v1.sql'in TAMAMINI (extension'lar, tablolar,
fonksiyonlar, trigger'lar, ifade indeksleri, seed veri) olduğu gibi
çalıştırır — SQLAlchemy modellerinden autogenerate ile DEĞİL.

Neden autogenerate değil: schema_v1.sql; CREATE EXTENSION (citext, pgcrypto,
unaccent, pg_trgm), immutable_unaccent/set_updated_at fonksiyonları,
trigger'lar, ifade indeksleri (GIN + immutable_unaccent) ve seed INSERT'leri
içeriyor. Bunların hiçbiri ORM modellerinden türetilemez; autogenerate bunları
sessizce atlar. Ham dosyayı tek parça çalıştırmak, aynı şemayı iki ayrı
temsille (ORM + elle yazılmış op.* çağrıları) tutup senkron kalmaya
güvenmekten daha güvenilir — schema_v1.sql zaten tek gerçek kaynak.

Neden op.execute(sql) değil, ham asyncpg bağlantısı: dosya çok sayıda
noktalı-virgülle ayrılmış komut içeriyor (CREATE TABLE'lar, seed INSERT'ler)
ve set_updated_at() gibi $$ ... $$ gövdeleri kendi içinde ayrıca noktalı
virgül barındırıyor. SQLAlchemy'nin asyncpg dialect'i her execute'u
"prepared statement" (extended protokol) üzerinden yürütür ve bu protokol
tek istemde birden fazla komutu KABUL ETMEZ (asyncpg.exceptions.
PostgresSyntaxError: cannot insert multiple commands into a prepared
statement — denendi, doğrulandı). tests/conftest.py aynı sorunu ham asyncpg
bağlantısıyla (simple-query protokolü) çözüyor; burada da aynı deseni
kullanıyoruz: Alembic'in senkron-görünümlü bağlantısının altındaki gerçek
asyncpg bağlantısına inip dosyayı TEK parça olarak veriyoruz. Kendi dosyamızı
noktalı virgülden bölüp tek tek çalıştırmak da bir seçenekti, ama yorum
satırlarında da noktalı virgül geçtiği için (bkz. dosyanın başındaki
açıklamalar) güvenilir bir bölme mantığı yazmak gereksiz risk olurdu.

KRİTİK — bu migration'ı ÇALIŞTIRMA, STAMPLE:
Docker compose'daki db init script'i (docker-entrypoint-initdb.d) her taze
volume'de schema_v1.sql'i zaten çalıştırıyor. O yüzden:
  • Taze veritabanı + `alembic upgrade head`  → bu migration GERÇEKTEN
    çalışır, şemayı sıfırdan kurar (örn. docker init'siz bir CI/production
    ortamı).
  • Docker init'in zaten kurduğu (veya elle kurulmuş, dolu) bir veritabanı
    → bu migration'ı ASLA upgrade ile çalıştırma (tablolar zaten var,
    CREATE TABLE patlar). Bunun yerine `alembic stamp head` ile "bu migration
    zaten uygulanmış" diye işaretle — hiçbir DDL çalıştırmaz, sadece
    alembic_version tablosuna bu revizyonu yazar.
"""

from pathlib import Path

from sqlalchemy.util import await_only

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e272543ef2bb"
down_revision: str | None = None
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

SCHEMA_SQL_PATH = Path(__file__).resolve().parents[2] / "db" / "schema_v1.sql"


def upgrade() -> None:
    connection = op.get_bind()
    # op.get_bind() burada SQLAlchemy'nin async-sync köprüsünden (greenlet)
    # gelen bir Connection; .connection.driver_connection gerçek asyncpg.
    # Connection'a iner. await_only, zaten bir greenlet içinde olduğumuz
    # için bu coroutine'i senkron bir çağrı gibi çalıştırabilir.
    dbapi_connection = connection.connection
    assert dbapi_connection is not None
    raw_connection = dbapi_connection.driver_connection
    assert raw_connection is not None
    schema_sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")
    await_only(raw_connection.execute(schema_sql))


def downgrade() -> None:
    # Bu, geçmişteki İLK migration — geri almak "her şeyi sil" demek.
    # "DROP SCHEMA public CASCADE" ile tek satırda halletmek daha basit
    # olurdu, ama alembic_version tablosu da public şemasında yaşıyor ve
    # Alembic downgrade() döndükten SONRA o tabloya "bu revizyon geri
    # alındı" diye yazmaya çalışıyor — şemayı toptan silmek o tabloyu da
    # götürüp bookkeeping adımını UndefinedTableError ile patlatıyor
    # (denendi, doğrulandı). Bu yüzden tabloları/fonksiyonları tek tek
    # DROP ediyoruz, alembic_version'a dokunmuyoruz. CASCADE, FK'lere göre
    # elle sıralama yapma ihtiyacını ortadan kaldırıyor.
    op.execute(
        "DROP TABLE IF EXISTS template_exercises, workout_templates, programs, "
        "readiness_logs, sets, workouts, exercise_muscle_groups, exercises, "
        "muscle_groups, refresh_tokens, users CASCADE"
    )
    op.execute("DROP FUNCTION IF EXISTS set_updated_at()")
    op.execute("DROP FUNCTION IF EXISTS immutable_unaccent(text)")
