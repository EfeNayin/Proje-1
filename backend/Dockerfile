# ── BodyTrack backend imajı ──
# İki aşamalı: "base" üretim imajı (sadece çalışma zamanı bağımlılıkları),
# "dev" onun üzerine test/lint araçlarını ekler. docker-compose dev hedefini
# kurar; üretimde base kullanılır ve pytest/ruff/mypy imaja hiç girmez.

# slim taban: tam python imajından küçük, ama yine de pip için yeterli.
FROM python:3.12-slim AS base

# Python davranışı: .pyc yazma, stdout/stderr'i tamponlama (logları anında gör)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Önce sadece bağımlılık dosyasını kopyala → Docker katman cache'i:
# kod değişse bile requirements değişmediyse pip adımı yeniden çalışmaz.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Uygulama kodunu kopyala
COPY . .

EXPOSE 8000

# Önce şemayı güncel migration'a getir (alembic upgrade head — zaten
# uygulanmış migration'lar no-op'tur, boş bir veritabanında ise şemayı
# sıfırdan kurar), sonra uygulamayı başlat. Böylece db/schema_v1.sql'e
# ayrıca bağımlı kalmadan hem taze volume hem mevcut veritabanı aynı
# komutla ayağa kalkar.
#
# Geliştirme: --reload ile kod değişince otomatik yeniden başlar.
# Üretimde --reload kaldırılır, worker sayısı ayarlanır.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"]


# ── Geliştirme imajı ──
# pytest, ruff, mypy burada. Testleri çalıştırmak için:
#   docker compose exec backend pytest
FROM base AS dev
RUN pip install --no-cache-dir -r requirements-dev.txt


# ── Üretim / staging imajı ──
# Render gibi platformlar Dockerfile'ın SON aşamasını kurar (hedef seçilemez), bu yüzden
# bu aşama dosyanın sonunda durmalı. base/dev hedefleri (compose, E2E) açıkça seçilir.
#
# base'den farkı: kaynak ağacını kopyalamaz — yalnızca çalışma zamanının gereken yollarını
# (app, alembic, alembic.ini ve baseline migration'ın okuduğu tek SQL dosyası). tests/,
# .env, dump'lar ve araç önbellekleri imaja HİÇ girmez; pytest/ruff/mypy de yok. Root
# olmayan kullanıcıyla çalışır, --reload ve bind mount yoktur.
FROM python:3.12-slim AS production

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin bodytrack

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
# alembic/versions/e272543ef2bb (baseline) bu dosyayı yoldan okur: eksik olursa migration kırılır.
COPY db/schema_v1.sql ./db/schema_v1.sql
COPY deploy/start.sh ./deploy/start.sh

USER bodytrack

EXPOSE 8000

# Liveness: süreç cevap veriyor mu (veritabanı/Redis'e dokunmaz; bkz. /health/ready).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8000'), timeout=4)"

# Önce şema (RUN_MIGRATIONS=false ile kapatılabilir), sonra tek işçili uvicorn.
CMD ["sh", "/app/deploy/start.sh"]
