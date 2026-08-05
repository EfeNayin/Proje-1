# BodyTrack

Hipertrofi-odaklı, bilim-temelli bir bodybuilding antrenman platformu (Türkiye-first).
Çalışma adıdır. Detaylı ürün/strateji bağlamı için `CLAUDE.md` dosyasına bakın.

## Monorepo yapısı

| Klasör     | İçerik                                      | Durum             |
|------------|---------------------------------------------|-------------------|
| `backend/` | FastAPI (async) + PostgreSQL + Redis API'si | Altyapı kuruldu   |
| `mobile/`  | React Native (TypeScript) uygulaması        | Boş (Faz 1 sonu)  |
| `ml/`      | PyTorch — CV / RL / HAR modelleri           | Boş (Faz 4+)      |

## Hızlı başlangıç (yerel)

```bash
cd backend && cp .env.example .env    # değerleri düzenle
cd ..
docker compose up --build             # db + redis + backend ayağa kalkar
```

Backend: http://localhost:8000  ·  Otomatik API dokümanı: http://localhost:8000/docs

> **Not:** `app/` kodu henüz yazılmadı; bu adımda yalnızca altyapı dosyaları
> hazırlandı. Container, `app/main.py` eklendikten sonra tam çalışır.
> Sonraki adım: veritabanı şeması (`schema_v1.sql`) ve FastAPI iskeleti.

## Faz planı (özet)

1. **Faz 1 (Ay 1-3, MVP):** manuel loglama + kas grubu hacim analizi
2. **Faz 2 (Ay 4-6):** sosyal feed, mezocycle, vücut ölçüleri
3. **Faz 3 (Ay 7-8):** akıllı program önerisi + opsiyonel video form check — bitirme teslimi
4. **Faz 4+ :** RL program önerisi, HAR otomatik loglama
