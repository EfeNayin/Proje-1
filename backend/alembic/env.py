import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from app.core.config import settings
from app.core.dburl import engine_arguments
from app.models import Base

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# alembic.ini bilerek sqlalchemy.url boş bırakıldı (şifre dosyaya yazılmasın)
# — bağlantı dizesi app.core.config.settings'ten (yani .env'den) okunur.
# Zaten bir url set edilmişse (örn. tests/conftest.py test veritabanına
# karşı programatik olarak Config().set_main_option(...) çağırıyor)
# ÜZERİNE YAZMA — yoksa testler her zaman .env'deki asıl veritabanına
# migration uygulamaya çalışırdı.
if not config.get_main_option("sqlalchemy.url"):
    # "%%": ConfigParser would read a lone "%" (e.g. in a URL-encoded password) as interpolation.
    config.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("%", "%%"))

# autogenerate için: Base.metadata modellerdeki tüm tabloları tutar.
# app/models/__init__.py her modeli import ediyor, o yüzden buradaki tek
# import yeterli.
target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """In this scenario we need to create an Engine
    and associate a connection with the context.

    """

    section = config.get_section(config.config_ini_section, {})
    # ssl=verify-full becomes a real SSLContext (see app/core/dburl.py); other URLs pass through.
    url, connect_args = engine_arguments(section["sqlalchemy.url"])
    section["sqlalchemy.url"] = url.render_as_string(hide_password=False)
    connectable = async_engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        connect_args=connect_args,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
