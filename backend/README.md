# BodyTrack — Backend

FastAPI (async) tabanlı API. PostgreSQL (veri), Redis (cache/kuyruk).

## Teknolojiler
- **FastAPI** + **Uvicorn** — async web çatısı / ASGI sunucu
- **SQLAlchemy 2.0** (async) + **asyncpg** — ORM ve PostgreSQL sürücüsü
- **Alembic** — şema migration
- **Pydantic v2** + **pydantic-settings** — doğrulama ve ayarlar
- **python-jose** + **passlib[bcrypt]** — JWT ve şifre hash'leme
- **Redis** — cache / kuyruk

## Kurulum (Docker — önerilen)
Kök dizinden:
```bash
cd backend && cp .env.example .env && cd ..
docker compose up --build
```

## Kurulum (Docker'sız, lokal venv)
```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env               # DATABASE_URL'deki host'u localhost yap
uvicorn app.main:app --reload
```

## Planlanan yapı (henüz yazılmadı — sonraki adımlar)
```
app/
├── main.py            # FastAPI uygulaması, router'ları bağlar
├── core/              # config, database, security, exceptions
├── models/            # SQLAlchemy modelleri
└── domains/
    ├── auth/          # register, login, refresh (JWT + bcrypt)
    └── users/         # GET /me, PATCH /me
```

## Geliştirme komutları
```bash
ruff check .          # lint
ruff format .         # format
mypy app              # tip kontrol
pytest                # testler
```
