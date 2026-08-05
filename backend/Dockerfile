# ── BodyTrack backend imajı ──
# slim taban: tam python imajından küçük, ama yine de pip için yeterli.
FROM python:3.12-slim

# Python davranışı: .pyc yazma, stdout/stderr'i tamponlama (logları anında gör)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Önce sadece bağımlılık dosyasını kopyala → Docker katman cache'i:
# kod değişse bile requirements değişmediyse pip adımı yeniden çalışmaz.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Uygulama kodunu kopyala (henüz app/ yok — sonraki adımda gelecek)
COPY . .

EXPOSE 8000

# Geliştirme: --reload ile kod değişince otomatik yeniden başlar.
# Üretimde --reload kaldırılır, worker sayısı ayarlanır.
# NOT: app/main.py henüz yazılmadı; bu komut app/ eklendikten sonra çalışır.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
