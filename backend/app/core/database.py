"""Async veritabanı bağlantısı.

SQLAlchemy 2.0 async API kullanılır (requirements.txt'te asyncpg sürücüsüyle).
FastAPI endpoint'lerine `db: AsyncSession = Depends(get_db)` ile inject edilir.
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.dburl import engine_arguments

# echo=True → geliştirmede çalışan her SQL'i logla (yalnızca development'ta; staging
# dahil diğer ortamlarda kapalı). hide_parameters her ortamda açık: bağlı
# parametreler e-posta, bcrypt şifre hash'i, refresh token hash'i ve sağlık
# verisi taşır ve log'a düşmemeli (SQL metni yine görünür).
_url, _connect_args = engine_arguments(settings.DATABASE_URL)
engine = create_async_engine(
    _url,
    connect_args=_connect_args,
    echo=settings.is_development,
    hide_parameters=True,
    pool_pre_ping=True,  # bağlantı havuzundaki ölü bağlantıları kullanmadan önce yakala
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_recycle=settings.DB_POOL_RECYCLE_SECONDS,
)

# expire_on_commit=False: commit sonrası obje alanlarına erişince otomatik
# yeniden sorgu atılmasın (async'te bu ekstra bir await gerektirir ve
# response modeline serialize ederken sorun çıkarır).
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: her istek için yeni session aç, sonunda kapat.

    Hata durumunda rollback yapar ki yarım kalan bir transaction
    bağlantı havuzunda kirli bırakılmasın.

    Kullanım:
        @router.get("/me")
        async def me(db: Annotated[AsyncSession, Depends(get_db)]): ...
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()