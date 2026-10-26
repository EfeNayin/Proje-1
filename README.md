# BodyTrack

Hipertrofi-odaklı, bilim-temelli bir bodybuilding antrenman platformu (Türkiye-first).
Çalışma adıdır. Detaylı ürün/strateji bağlamı için `CLAUDE.md` dosyasına bakın.

## Monorepo yapısı

| Klasör     | İçerik                                      | Durum             |
|------------|---------------------------------------------|-------------------|
| `backend/` | FastAPI (async) + PostgreSQL + Redis API'si | Çalışıyor — auth, egzersiz kataloğu, antrenman kaydı, program/şablon, toparlanma, vücut ölçümü, beslenme hedefi, haftalık hacim ve dönemsel değerlendirme (teşhis) domain'leri kurulu |
| `mobile/`  | React Native + Expo (TypeScript strict) uygulaması | Faz 1 tamam, uçtan uca çalışıyor — kayıt/giriş, antrenman loglama, program/şablon, haftalık hacim, dönemsel değerlendirme, profil/beslenme hedefleri |

`ml/` (PyTorch — CV / RL / HAR modelleri) Faz 4+ için planlanan bir klasördür; depoda henüz oluşturulmadı.

Güncel durumun ayrıntılı ve tarihli dökümü için bkz. `CLAUDE.md` (mimari kararlar, veri modeli, test sayıları) ve `PROJE_1_CODEX_INCELEME.md` (adım adım değişiklik günlüğü).

## Hızlı başlangıç (yerel)

```bash
cd backend && cp .env.example .env    # değerleri düzenle
cd ..
docker compose up --build             # db + redis + backend ayağa kalkar; başlarken alembic upgrade head çalışır
```

Backend: http://localhost:8000  ·  Otomatik API dokümanı: http://localhost:8000/docs

Mobil için:

```bash
cd mobile && npm install
npx expo start
```

### Yerel geliştirme: ağ erişimi ve JWT anahtarı

Bu bölüm **yerel geliştirme** içindir; üretim yapılandırması değildir.

- **JWT anahtarı:** `backend/.env.example` içindeki `JWT_SECRET_KEY` repoda herkese açıktır.
  `.env`'i kopyaladıktan hemen sonra kendi anahtarınla değiştir (en az 32 bayt):
  `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`. Anahtarı değiştirmek
  **mevcut tüm access/refresh token'ları geçersiz kılar**: uygulamada oturum açık olanlar
  bir sonraki istekte çıkış yapılmış olur ve yeniden giriş yapmaları gerekir (hesaplar ve
  veriler silinmez). Değer `env_file` ile konteynere girdiği için `--reload` onu görmez;
  uygula: `docker compose up -d --no-deps backend`.
- **Host portları:** backend yalnızca `127.0.0.1:8000`'de yayınlanır (geliştirme sunucusu:
  `--reload`, `/docs`, geliştirme anahtarı); aynı ağdaki başka cihazlar ona ulaşamaz.
  Redis host'a hiç yayınlanmaz (backend ona compose ağında `redis:6379` olarak erişir ve
  parolasızdır); bakmak için `docker compose exec redis redis-cli`.
- **Telefon:** iOS Simülatörü ve bu makinedeki tarayıcı `http://localhost:8000` ile çalışır
  (`mobile/.env` → `EXPO_PUBLIC_API_URL=http://localhost:8000`). **Fiziksel bir telefon
  LAN üzerinden backend'e ulaşamaz** — loopback bağlaması bunun için bilerek yapıldı.
  Fiziksel cihazla denemek, geliştirme sunucusunu ağa açmak demektir; bu depo bunun için
  hazır bir ayar sunmaz.
- E2E smoke testi (`mobile/README.md`) bunlardan bağımsızdır: kendi veritabanı, Redis,
  backend'i (`127.0.0.1:8100`) ve her koşuda üretilen kendi JWT anahtarı vardır; bu
  `.env`'i ve 8000 portunu kullanmaz.

## Faz planı (özet)

1. **Faz 1 (Ay 1-3, MVP):** manuel loglama + kas grubu hacim analizi
2. **Faz 2 (Ay 4-6):** sosyal feed, mezocycle, vücut ölçüleri
3. **Faz 3 (Ay 7-8):** akıllı program önerisi + opsiyonel video form check — bitirme teslimi
4. **Faz 4+ :** RL program önerisi, HAR otomatik loglama
