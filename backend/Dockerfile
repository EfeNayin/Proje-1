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

# Geliştirme: --reload ile kod değişince otomatik yeniden başlar.
# Üretimde --reload kaldırılır, worker sayısı ayarlanır.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]


# ── Geliştirme imajı ──
# pytest, ruff, mypy burada. Testleri çalıştırmak için:
#   docker compose exec backend pytest
FROM base AS dev
RUN pip install --no-cache-dir -r requirements-dev.txt