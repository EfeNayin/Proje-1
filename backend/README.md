# BodyTrack — Backend

FastAPI (async) tabanlı API. PostgreSQL (veri), Redis (cache/kuyruk).

## Teknolojiler
- **FastAPI** + **Uvicorn** — async web çatısı / ASGI sunucu
- **SQLAlchemy 2.0** (async) + **asyncpg** — ORM ve PostgreSQL sürücüsü
- **Alembic** — şema migration
- **Pydantic v2** + **pydantic-settings** — doğrulama ve ayarlar
- **python-jose** + **passlib[bcrypt]** — JWT ve şifre hash'leme
- **Redis** — kayıt/giriş/yenileme/davet kodu hız sınırlarının paylaşılan sayaçları (bkz. kök README, "Hız sınırları"); cache/kuyruk için henüz kullanılmıyor

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

## Mevcut yapı
```
app/
├── main.py            # FastAPI uygulaması, router'ları bağlar
├── core/              # config, database, security, exceptions, mailer (SMTP)
├── models/            # SQLAlchemy modelleri (13 tablo — bkz. CLAUDE.md)
└── domains/
    ├── auth/          # register, login, refresh (rotasyon), parola kurtarma (kod + oturum geçersiz kılma)
    ├── users/         # GET/PATCH /users/me
    ├── exercises/     # egzersiz kataloğu (arama/filtre)
    ├── workouts/      # antrenman + set CRUD, başlangıç plan anlık görüntüsü
    ├── programs/      # program/şablon CRUD, şablon kaydetme (idempotent)
    ├── readiness/     # günlük toparlanma kaydı (uyku/enerji/ruh hali)
    ├── body/          # kilo ölçümü
    ├── nutrition/     # beslenme hedefi hesaplama
    └── analytics/     # haftalık hacim + dönemsel değerlendirme (teşhis)
```

Domain yapısının kaynağı `app/domains/` klasörüdür; en güncel durum için oraya
bakın — bu liste değişiklik olduğunda elle güncellenmelidir.

Parola kurtarma (kod ömrü/entropi/sınırlar, oturum geçersiz kılma, SMTP ayarları ve yayın
öncesi gerekenler) kök README'deki "Parola kurtarma" bölümündedir. Yerel geliştirmede e-posta
için `SMTP_HOST` ayarlanmazsa kod hiç üretilmez; kodu görmek için yerel bir test SMTP kutusu
(`SMTP_SECURITY=none`, yalnızca development) kullan: testler ve E2E bunun için
`tests/support/smtp_sink.py` içindeki, yalnızca standart kütüphaneyle yazılmış küçük
alıcıyı kullanır. Gerçek SMTP bilgilerini `.env.example`'a ya da Git'e yazma.

## Geliştirme komutları
```bash
ruff check .          # lint
ruff format .         # format
mypy app              # tip kontrol
pytest                # testler
```
