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

### Hız sınırları (giriş, kayıt, yenileme, davet kodu)

Sayaçlar **Redis'te** tutulur; bu yüzden tüm backend süreçleri arasında ortaktır ve backend
yeniden başlayınca sıfırlanmaz (`backend/app/core/ratelimit.py`). Her sınır "pencere başına
N izinli istek"tir: pencere ilk izinli istekle açılır, süre dolunca Redis anahtarı siler
(sabit pencere; pencere sınırında iki hak art arda harcanabilir, bu ölçekte kabul edildi).
Karar tek bir Lua betiğidir: okuma, karşılaştırma ve artırma bölünemez, paralel bir yığın
limiti aşamaz. Bir istek birden çok kovaya sayılıyorsa ya hepsinden geçer ya hiçbirinden;
reddedilen istek hiçbir sayacı artırmaz. Anahtarlara e-posta, adres ya da kullanıcı kimliği
açık yazılmaz: konu, sunucu gizlisinden türetilmiş anahtarlı bir özetle (HMAC-SHA256)
anahtara dönüşür; her anahtarın ömrü penceresiyle sınırlıdır. (JWT anahtarı değişirse özet
anahtarı da değişir ve sayaçlar bir kez sıfırlanır.) Aşılınca `429` döner:
`{"detail": "... Try again in 12 minutes."}` ve saniye cinsinden `Retry-After` başlığı.

| İşlem | Kova (kimin sayacı) | Varsayılan | Ne sayılır |
|---|---|---|---|
| Giriş | istemci adresi | 40 / 10 dk | her deneme, bcrypt'ten önce |
| Giriş | hesap + adres | 5 / 15 dk | yalnız **başarısız** denemeler |
| Giriş | hesap (her yerden) | 50 / 1 saat | yalnız başarısız denemeler |
| Kayıt | istemci adresi | 20 / 1 saat | her deneme (409 "zaten kayıtlı" da) |
| Yenileme | istemci adresi | 60 / 10 dk | her deneme |
| Yenileme | hesap | 30 / 10 dk | yalnız **imzası doğrulanmış** refresh token'dan |
| Davet kodu (önizleme+kabul) | giriş yapmış hesap | 10 / 10 dk | yalnız hiçbir koda uymayan denemeler |
| Davet kodu | istemci adresi | 30 / 10 dk | yalnız hiçbir koda uymayan denemeler |
| Parola kurtarma: kod isteği | istemci adresi | 15 / 1 saat | her istek |
| Parola kurtarma: kod isteği | yazılan e-posta | 5 / 1 saat + 60 sn bekleme | her istek (hesap var mı bakılmaz) |
| Parola kurtarma: kod girişi | istemci adresi | 30 / 15 dk | her deneme |
| Parola kurtarma: kod girişi | yazılan e-posta | 10 / 15 dk | her deneme; başarılı sıfırlamada iade |

Gerekçeler:
- **Yalnız adrese güvenilmez:** ortak NAT/CGNAT arkasındaki herkes tek adrestir, saldırgan
  adres değiştirir. Bu yüzden tahmin sınırı hesap bazlıdır; adres sınırı kaba bir ön
  barajdır (bcrypt CPU'sunu ve bir adresin kaç hesap deneyebileceğini kısıtlar).
- **Başkasını dışarıda bırakmak kolay değil:** 5'lik sınır "hesap + adres" çiftine aittir;
  bir yabancı kurbanın e-postasını bin kez yanlış girse yalnız kendi adresinin kovasını
  doldurur, kurban başka adresten girebilir. Adresler arası dağıtık tahmini durduran tavan
  (50/saat) ise ancak birkaç farklı adresten süren bir çabayla dolar ve **bir pencere**
  sürer, kalıcı kilit olmaz. Bilinen takas: böyle bir saldırgan o saat kurbanın girişini
  engelleyebilir; MFA/CAPTCHA bu kilometre taşında yok.
- **Var olan/olmayan hesap aynı:** hesap kovası, yazılan e-postadan (küçük harfe çevrilmiş)
  türetilir, hesabın var olup olmadığından değil; ikisi de aynı sayılır ve aynı yanıtı alır.
- **Sayaç şifre denenmeden önce artırılır**, doğru şifrede geri verilir; paralel istekler
  limiti aşamaz. Reddedilen giriş şifreyi doğrulamaz (doğru şifre bile `429` alır).
- **Yenileme:** hesap kovası yalnız `decode_token` imza/süre/tür doğrulamasından sonra, token
  içindeki `sub` ile sayılır. Sahte, süresi dolmuş ya da access türündeki token hesabın
  hakkını harcamaz. `429`, token satırına dokunmadan döner: token iptal/rotasyon edilmez ve
  yeniden kullanım (çalıntı) olarak yorumlanmaz.
- Kapsam dışı (bilerek): `/auth/logout` (sahip olunan token'ı siler), davet **oluşturma**,
  `/health` ve diğer tüm rotalar sınırlanmaz.

Ayarlar `backend/.env.example` içinde (yorum satırı olarak) `RATE_LIMIT_*` adlarıyla durur;
`backend/.env`'e eklenmedikçe varsayılan geçerlidir.

**İstemci adresi kim belirler?** Bu depoda önde bir proxy yoktur: uvicorn doğrudan dinler ve
adres, TCP bağlantısının karşı ucudur (`request.client`). `X-Forwarded-For`, `X-Real-IP`,
`Forwarded` gibi başlıkları uygulama **hiç okumaz**; uvicorn da bunları yalnız
`FORWARDED_ALLOW_IPS`'te (varsayılan `127.0.0.1`) listelenen eşten gelirse uygular.
Compose'ta eş, Docker köprüsünün geçididir (canlıda `172.20.0.1` görüldü); bu yüzden başlık
sahteciliği kova değiştirmez (canlı denendi) ve **bu makineden gelen tüm istekler tek adres
sayılır** (Docker Desktop NAT'ı): yerel geliştirmede adres kovası (örn. 40 giriş/10 dk) tek
paylaşılan kovadır. Bir ters proxy arkasına geçilirse: proxy backend'e ulaşan tek yol olmalı,
gelen `X-Forwarded-For`'u ezmeli ve `FORWARDED_ALLOW_IPS` yalnız proxy'nin adresi olmalıdır;
aksi halde ya tüm kullanıcılar proxy'nin adresinde birleşir ya da başlık sahte olabilir.
IPv6 istemciler /64 bloğuna göre gruplanır. Bu bölüm bir proxy kurmaz, ağ açılımını
değiştirmez. Render arkasında ne olduğu, `FORWARDED_ALLOW_IPS`'in neden `*` olamayacağı ve uvicorn'un
başlığı nasıl okuduğu "Staging'e dağıtım" bölümünde.

**Redis çalışmazsa:** karar verilemediğinde istek **geçirilmez** ve işlem-başına sayaç gibi
bir yedeğe de düşülmez: `503` + `Retry-After: 10` döner ("The service is temporarily
unavailable..."). Bağlantı ve okuma zaman aşımı 0,5 sn'dir (`RATE_LIMIT_REDIS_TIMEOUT_SECONDS`),
yeniden deneme yoktur; bir hatadan sonra süreç 2 sn boyunca Redis'e hiç sormadan anında `503`
verir (hata başına bir zaman aşımı, istek başına değil) ve sonra tekrar dener. Günlüğe yalnız
hata sınıfı yazılır. Etkilenen yalnız kayıt, giriş, yenileme ve davet kodu rotalarıdır;
`/health`, mevcut access token'la yapılan istekler ve çıkış çalışmaya devam eder. Mobil
uygulama `429`/`503`'ü oturum geçersizliği saymaz: yalnız `401` oturumu bitirir.

Operasyonel notlar: sayaçlar Redis belleğindedir; Redis konteyneri yeniden *oluşturulursa*
sayaçlar kaybolur (durdur/başlat'ta Redis'in kendi RDB'si yüzünden kalabildiği gözlendi, buna
güvenme). Anahtar sayısı, penceresi içinde saldırganın üretebildiği kadardır (giriş için
adres başına ≤ 40 deneme/10 dk); üretimde Redis'e `maxmemory` ve `volatile-ttl` tanımla.
Yerel sayaçlara bakmak için `docker compose exec redis redis-cli --scan --pattern 'bt:rl:*'`;
tek bir anahtarı `DEL` ile silebilirsin, `FLUSHALL`/`FLUSHDB` kullanma (testler `bt:rl:test:…`
önekini ve Redis veritabanı 15'i kullanır; E2E yığınının kendi Redis'i var).

### Oturum yaşam döngüsü: çıkış, yenileme, hesap değiştirme

Bir **oturum**, bir girişin ürettiği refresh token zinciridir: her `refresh` token'ı iptal eder
(`revoked_at`) ve bir halef üretir; halef aynı `refresh_tokens.family_id`'yi taşır.

- **`POST /auth/logout`** sunulan token'ın **ailesinin** hâlâ geçerli tüm token'larını ve sunulan
  token'ın kendisini **siler**; hesabın diğer cihazlarının oturumları (başka aileler) etkilenmez.
  Daha önce rotasyonla iptal edilmiş eski token kayıtları **kalır** (yeniden kullanım tespiti
  onlara dayanır); silinen token'ın geç gelen yenilemesi düz `401`'dir ve çalıntı sinyali sayılmaz.
  Her zaman `204`, token'ın gerçek olup olmadığını söylemez.
- **Yarış:** logout ile aynı anda sürmekte olan bir yenileme, logout'un göremediği (henüz
  commit edilmemiş) bir halef token ekleyebilirdi; önceden de yenileme logout'tan önce commit
  olduysa halef geçerli kalıyordu (Adım 63'te kanıtlandı). Yenileme ve logout artık aynı oturumun
  `pg_advisory_xact_lock`'unu sırayla alır (aile kilidi; başka oturumu bloklamaz), böylece hangisi
  ikinci gelirse ilkinin commit ettiği her şeyi görür.
- **Access token'lar** durumsuzdur: çıkıştan sonra **süresi dolana kadar** (`ACCESS_TOKEN_EXPIRE_MINUTES`,
  30 dk) geçerli kalır; anında sunucu tarafı access iptali **yoktur**. Çıkış yenileme yeteneğini bitirir.
- **Mobil:** her kimlik doğrulamalı istek ve yenileme, başladığı oturumun "dönemine" (`authEpoch`)
  bağlıdır. Çıkış, oturum süresinin dolması ve yeni bir giriş denemesi dönemi ilerletir; önceki
  dönemden havada kalan istek token yazamaz/silemez, oturum sonu bildiremez ve cevabını çağırana
  vermez (`SessionChangedError`). Token yazma/silme işlemleri tek sırada (kuyrukta) çalışır;
  çıkışta yerel durum ve özel store'lar **hemen** sıfırlanır, sunucuya çıkış isteği yalnız bir kez
  ve beklenmeden gönderilir. Yerel temizlik (`localClear`) ile sunucu iptalinin onayı (`revocation`:
  `confirmed`/`unconfirmed`/`none`) ayrı şeylerdir: istek başarısız olursa token cihazdan silinmiş
  olur ama sunucuda süresi dolana kadar (14 gün) geçerli kalır; arka planda yeniden deneme yoktur.

## Windows 11 + WSL2 geliştirme ortamına taşıma (hazırlık — 5 Kasım 2026)

Bu bölüm taşıma **planıdır**. Windows tarafı henüz kurulmadı ve aşağıdaki kontroller orada **geçene kadar taşıma tamamlanmış sayılmaz**; o zamana dek Mac'teki proje ve veritabanı olduğu gibi kalır.

### Neyin nereden geleceği

| Ne | Nereden | Not |
|---|---|---|
| Kaynak kod (tüm dallar uzakta) | `git clone` (GitHub) | Dal `feat/registration-phone-number`; Mac'te `git rev-list --left-right --count HEAD...@{u}` → `0 0` doğrulandı |
| Commit'lenmemiş sahip değişiklikleri | özel transfer paketi (`uncommitted/*.patch`) | `docker-compose.yml` (db'nin 5432'yi host'a açan `ports` satırı kaldırıldı) ve `mobile/app.json` (`ITSAppUsesNonExemptEncryption: false`). **Commit'lenmedi**; `git apply` ile yeniden uygulanır |
| Kök `AGENTS.md`, hazırlık metni | özel transfer paketi | Git'e eklenmez |
| Ortam yapılandırması (`.env`'ler, staging sırları) | özel transfer paketi, **kaynaktan ayrı ve şifreli** kanalla | Git'e girmez; Keychain **kopyalanmaz** |
| Yerel PostgreSQL verisi | taze `pg_dump` (aşağıda) | Yalnız Docker sağlıklıyken alınır. Eylül'deki dump güncel yedek **değildir** |
| `node_modules`, venv, simülatör, önbellek, `Docker.raw`, volume dosyaları | **taşınmaz** | Hedefte yeniden kurulur |

Hosted staging'i kullanmak (mobil → `EXPO_PUBLIC_API_URL=https://proje-1-t6lh.onrender.com`) için **staging sırlarına gerek yoktur**; onlar yalnız staging veritabanını yönetmek içindir. Staging'e Windows'tan da migration/sıfırlama yapılmaz.

### Mac'te, taşımadan önce (yerel veritabanı gerekiyorsa)

Docker Desktop sağlıklı ve yeterli boş disk varken (veritabanı küçüktür; yine de önce `df -h /` bak):

```bash
docker compose ps                      # db healthy mi?
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > ~/bodytrack-local-$(date +%Y%m%d).dump
docker compose exec -T db sh -c 'pg_restore --list' < ~/bodytrack-local-*.dump | head   # arşiv okunabiliyor mu
```

Parola konteynerin kendi ortamından gelir, komut satırında görünmez. Dump dosyası Git dışında kalır (`*.dump` `.gitignore`'dadır) ve sırlarla birlikte aynı şifreli kanalla taşınır.

### Windows'ta sırayla

1. Windows 11'de yönetici PowerShell: `wsl --install -d Ubuntu-24.04`, yeniden başlat. Ubuntu'da kullanıcıyı oluştur.
2. Docker Desktop'u kur; *Settings → General → Use the WSL 2 based engine*, *Resources → WSL integration → Ubuntu-24.04* açık olsun.
3. Editör: VS Code + *WSL* uzantısı; projeyi Ubuntu içinde `code .` ile aç. **Depoyu Windows diskinde (`/mnt/c/...`) değil, WSL Linux dosya sisteminde (`~/Proje-1`) tut** (hız, dosya izleme, Docker bind mount'ları).
4. Ubuntu'da araçlar:
   ```bash
   sudo apt update && sudo apt install -y git build-essential curl ca-certificates
   git config --global core.autocrlf input      # Mac ile aynı; 'true' YAPMA
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash   # sonra yeni terminal
   nvm install 24 && nvm alias default 24
   ```
   - **Node:** Mac'te `v24.14.0` / npm `11.9.0` kullanıldı. Bağımlılıkların gerektirdiği: React Native 0.86.3 ve Metro 0.84.5 → `^20.19.4 || ^22.13.0 || ^24.3.0 || >=25`. Yani **24.x (≥24.3) önerilir**; 22.13+ de karşılar.
   - **Python:** backend Docker içinde `python:3.12-slim` ile çalışır ve testler konteynerde koşar; **ana makinede Python gerekmez**. (Mac'in 3.13.5'i backend tarafından kullanılmıyor.) Yine de yerelde venv istenirse `3.12` kullan.
   - **Java/Maestro:** yalnız iOS E2E içindir; Windows'ta kurulmaz (aşağı bak).
5. Depoyu klonla ve doğru dalı al:
   ```bash
   cd ~ && git clone https://github.com/EfeNayin/Proje-1.git && cd Proje-1
   git switch feat/registration-phone-number && git rev-parse HEAD     # b47ff4c5cf61251b77234934ed1aa6ab8cd73daa
   ```
6. Özel paketten (şifresini çözdükten sonra, kaynak dizinin **dışında**) sahip değişikliklerini uygula ve yapılandırmayı yerleştir:
   ```bash
   git apply /yol/uncommitted/docker-compose.yml.patch /yol/uncommitted/mobile-app.json.patch
   git status --short        # yalnız docker-compose.yml ve mobile/app.json 'M' olmalı; commit'leme
   cp /yol/uncommitted/AGENTS.md .                  # Git'e eklenmez (untracked kalır)
   ```
   `backend/.env` için **önerilen**: `cp backend/.env.example backend/.env`, `JWT_SECRET_KEY`'i yeniden üret (yukarıdaki komut) — yeni yerel veritabanı için eski geliştirme sırrını taşımaya gerek yok. Eski dosyayı kullanmak istersen paketten `chmod 600` ile koy. `mobile/.env` yalnız `EXPO_PUBLIC_API_URL` içerir.
7. Kontroller (aşağıdaki liste) → geçerse yerel DB'yi geri yükle.

### Hedefte geçmesi gereken kontroller

| # | Kontrol | Komut | Beklenen |
|---|---|---|---|
| 1 | Bağımlılık kurulumu | `cd mobile && npm ci` | hatasız; `package-lock.json` değişmez (`git status`) |
| 2 | Mobil testler | `node --test tests/*.test.cjs` | Mac'te son koşu **729/729** |
| 3 | Tip denetimi | `npx tsc --noEmit` | 0 hata |
| 4 | Lint | `npm run lint` | 0 hata, **0 uyarı** |
| 5 | Yerel backend | `docker compose up --build -d` sonra `curl -fsS localhost:8000/health` | `{"status":"ok",...}`; `docker compose ps` db/redis healthy |
| 6 | Backend testleri | `docker compose exec backend pytest` | Mac'te son tam koşu **1247 geçti**; `ruff check .` ve `mypy app` temiz |
| 7 | Şema | `docker compose exec backend alembic check` | "No new upgrade operations" |
| 8 | DB geri yükleme, **ayrı yerel veritabanına** (hosted'a asla) | `docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" bodytrack_restore && pg_restore -U "$POSTGRES_USER" -d bodytrack_restore --no-owner' < ~/bodytrack-local-….dump` | hatasız; `users`, `workouts`, `sets` satır sayıları Mac'tekiyle eşleşir; `alembic_version` = head. Doğrulamadan sonra bunu asıl geliştirme veritabanı yapmak istersen, yalnız bu **yeni Windows ortamında** (Mac'te asla) backend'i başlatmadan önce `docker compose down -v && docker compose up -d db` ile boş veritabanına geri yükle |

### Windows'a uyarlanacak/uyarlanamayacak noktalar (envanter)

- **macOS'a özgü, Windows'ta çalışmaz:** `mobile/e2e/scripts/*.sh` (`xcrun simctl`, Homebrew yolu `/opt/homebrew/opt/openjdk@*`, `~/.maestro`, `~/.cache/bodytrack-e2e`) ve Maestro ile iOS Simülatörü doğrulamaları. **iOS Simülatörü yalnız macOS'ta vardır; bu betikler Windows'ta (WSL dahil) denenmedi ve çalışacağı iddia edilmez.** `backend/deploy/local-staging/run.sh` Linux/bash tabanlıdır ama WSL'de denenmedi.
- **Çalıştırma izni:** izlenen `.sh` dosyaları Git'te `100644` (Mac'te `core.fileMode=false`); klonda `+x` olmaz → `bash dosya.sh` ile çalıştır. Docker imajı `sh /app/deploy/start.sh` kullandığı için etkilenmez.
- **Satır sonları:** `.gitattributes` yok. İzlenen 53 dosyada (32 `.py`, 10 `.ts`, 5 `.tsx`, `.json`, `.ini`, `.mako`, `.sql`, `.cjs`) CRLF var, **hiçbir `.sh`/Dockerfile/`.yml`'de yok**. Python ve TypeScript bunları sorunsuz okur. Windows tarafında `core.autocrlf=true` açma (gereksiz diff üretir); `.gitattributes` ile toplu normalleştirme **bu taşımada yapılmadı** (yüzlerce satırlık gürültülü diff olur).
- **Kimlik korunur:** Expo `owner: efe_nayn`, `projectId: 751aebe3-68ef-4617-ac03-9060ce2d0d81`, slug/şema `aures`, iOS paket kimliği `com.efenayin.aures`, ad `Aures` değişmeden gelir; imzalama ilişkisi Apple hesabında ve EAS'te durur, Windows'a dosya olarak taşınacak bir sertifika yoktur. `eas login` ile aynı Expo hesabına girilir.

### iPhone'da test etmenin dört yolu (hangisi Windows'ta ne yapar)

| Yol | Windows'ta | Durum |
|---|---|---|
| **Expo Go, fiziksel iPhone** | Metro WSL2'de çalışır; telefon aynı ağdan ona bağlanır | WSL2 NAT'ı telefonu engelleyebilir: `%UserProfile%\.wslconfig` içinde `[wsl2] networkingMode=mirrored` (Win 11 22H2+) veya `npx expo start --tunnel` (ek paket ister). **Hedefte denenmedi.** Hosted staging'e bağlanmak için `mobile/.env`'e URL yeter |
| **EAS development build (fiziksel iPhone)** | `eas build` bulutta çalışır, Mac gerekmez | **Bugün yok:** `eas.json`'da yalnız `testflight-staging` profili var; `development` profili ve `expo-dev-client` bağımlılığı eklenmedi (bu görevde bağımlılık değiştirilmedi). Apple Developer hesabı, cihaz kaydı ve telefonda Developer Mode gerekir |
| **TestFlight** | `eas build --profile testflight-staging` bulutta; `eas submit` | Profil var. 5 Kasım itibarıyla imzalama **sahibin etkileşimli Apple girişi** yüzünden bekliyor. `ITSAppUsesNonExemptEncryption` kararı sahipte (yerel `app.json` değişikliği) |
| **Uzak iOS simülatörü** | tarayıcı/CLI üzerinden | 5 Kasım 2026'da doğrulandı: Expo **EAS Simulator = sınırlı erişimli ön izleme**, planlara dahil değil, bekleme listesi ([docs](https://docs.expo.dev/preview/simulators/introduction.md)), fiyat yayımlanmamış, Maestro desteği doğrulanmadı (agent-device/Argent/Appium belgelenmiş). **Appetize** (3. taraf): Free $0 (30 dk/ay, 3 dk oturum), Starter $59/ay yıllık faturalı (500 dk), Premium $319/ay ([fiyat sayfası](https://appetize.io/pricing)); simülatör derlemesi için `eas.json`'da `ios.simulator: true` profili gerekir (bugün yok). **Hiçbir abonelik satın alınmadı ve önerilmiyor**; önce bekleme listesi/ücretsiz katman denenebilir |

**Önemli sınır:** Maestro ile yapılan yerel iOS Simülatörü klavye/dokunma doğrulaması Windows'ta yeniden üretilemez; yarım kalan klavye görevi için bir Mac, fiziksel iPhone veya yukarıdaki uzak simülatörlerden biri gerekir (bkz. `PROJE_1_CODEX_INCELEME.md` Adım 78 kontrol noktası).

## Parola kurtarma

Giriş ekranındaki **Forgot password?** → e-posta adresi → genel bir "istek alındı" yanıtı →
e-postayla gelen tek kullanımlık kod → yeni parola + tekrarı → "Password updated" → normal
giriş. Sıfırlama **otomatik giriş yapmaz**. Kod yalnız bu işe yarar: hiçbir API ucuna erişim
yetkisi vermez. Kod: `app/domains/auth/recovery.py`, e-posta: `app/core/mailer.py`.

**Uç noktalar** (kimlik doğrulaması yok, `extra="forbid"`):
- `POST /auth/password-recovery/request` `{email}` → **her zaman aynı `202` gövdesi** (hesap
  var, yok, silinmiş, geçersiz biçimde bile). E-posta, yanıt döndükten **sonra** arka planda
  gönderilir; bu yüzden ne durum kodu ne süre hesabın varlığını ele verir (olmayan adres de
  eşdeğer HMAC işini yapar).
- `POST /auth/password-recovery/confirm` `{email, code, new_password}` → `204`. Yanlış, süresi
  dolmuş, kullanılmış, yenisiyle değiştirilmiş, bilinmeyen adres, bozuk biçim: hepsi **aynı
  sabit `400`** gövdesi ("That code is not valid, or it has expired or was already used..."). Parola kuralları
  kayıttakiyle aynıdır (72 bayt bcrypt sınırı dahil, sessizce kesilmez, `422`); `422` yanıtlarında
  girdi geri yansıtılmaz.

**Kod:** 8 rakam, `secrets` ile üretilir (≈ 26,6 bit); ömrü **15 dk** (`PASSWORD_RESET_CODE_TTL_SECONDS`);
bir koda en fazla **5 yanlış deneme** (`PASSWORD_RESET_MAX_ATTEMPTS`) — deneme hakkı karşılaştırmadan
**önce, veritabanında atomik** harcanır, yani paralel işçiler de limiti aşamaz. Hesap başına **tek bekleyen
kod** vardır: yeni istek eskisini geçersiz kılar (yeniden gönderim = yeni kod isteği; her zaman
"son gelen kod geçerli"); başarılı sıfırlama kodu siler (tek kullanım). Veritabanında kodun
kendisi tutulmaz: `HMAC-SHA256(JWT_SECRET_KEY'den türetilmiş alt anahtar, amaç ‖ challenge_id ‖
user_id ‖ kod)` saklanır. 8 hanelik kod için salt'sız hızlı özet çevrimdışı saniyeler içinde
kırılırdı; anahtar sunucuda olduğundan veritabanı sızıntısı tek başına kodu vermez. **Bilinen
sonuç:** JWT anahtarı döndürülürse bekleyen kodlar da geçersizleşir (kullanıcı yeni kod ister).
Kod; yanıtlarda, URL'de, doğrulama hatalarında, günlükte, ya da depoda **yer almaz**.

**Sınırlar** (paylaşılan Redis; tablo yukarıda): kova anahtarı **yazılan e-postadır** (küçük
harf), hesabın varlığı değil; bu yüzden olmayan adres de aynı `429`'u alır. Giriş kovalarından
ayrıdır: kurtarma istekleri **normal girişi kilitlemez**. Redis çalışmazsa `503` (kod
üretilmez/denenmez). Bilinen takas: biri bir adres için saatte 5 istek harcayıp o adrese kod
isteyen asıl sahibi bir süre bekletebilir (kod gelmiş olsa da kullanılabilir); IP başına
15/saat bunu sınırlar.

**Oturumlar ve token'lar:** `users.credential_version` (varsayılan 0). Access ve refresh token'lar
`cv` claim'ini taşır (yoksa 0 sayılır → mevcut hesaplar ve token'lar **ilk sıfırlamaya kadar**
çalışır). Sıfırlama tek işlemde: parolayı değiştirir, `credential_version`'ı artırır, hesabın
**tüm** refresh token'larını ve bekleyen kodu siler. Eski access token'lar, süreleri dolmadan,
bir sonraki istekte `401` alır (zaman damgası değil sürüm karşılaştırılır, aynı saniye sınır
hatası olmaz). Giriş ve yenileme kullanıcı satırını `FOR SHARE` kilitler; sıfırlama oturum
ailelerini (sıralı) → kullanıcı satırını → kod satırını kilitler (hesap silmeyle aynı sıra);
çakışmalarda en fazla 3 yeniden deneme, olmazsa `503` "Nothing was changed". Hesap silme
kilit altında `credential_version`'ı yeniden doğrular. Silinmiş hesap için istek/onay
hesabı **yeniden oluşturmaz**; başka hesaplar etkilenmez. Parola değişti bildirimi e-postası
parolayı içermez; gönderilemese de tamamlanmış sıfırlama geri alınmaz.

**E-posta teslimatı (yapılandırma):** iki küçük taşıyıcı, `MAIL_TRANSPORT` ile **açıkça** seçilir (`smtp`
varsayılan | `resend`); biri diğerine otomatik geçmez. Resend (HTTPS) için bkz. "Staging'e dağıtım". Aşağıdaki SMTP ayrıntıları `smtp` içindir: standart
kütüphane `smtplib` (yeni bağımlılık yok). Sağlayıcı **seçilmedi**; `backend/.env.example` yalnızca yer tutucu içerir.
`SMTP_SECURITY=starttls` (varsayılan; TLS **sunulmalı ve sertifika doğrulanmalı**, yoksa
gönderilmez) | `implicit` | `none` (yalnız development, yerel test kutusu). `staging`/`production`
`SMTP_HOST` olmadan ya da `none` ile **açılmaz**. Gerçek değerler yalnızca kendi
`backend/.env`'ine girer. Zaman aşımı soket işlemi başınadır (en kötü durum ≈ 5 × `SMTP_TIMEOUT_SECONDS`);
eşzamanlı gönderim (`SMTP_MAX_CONCURRENT`) ve bekleyen iş (`SMTP_MAX_PENDING`) sınırlıdır. `SMTP_HOST`
boşsa kod üretilmez ve **hiçbir yerde** (yanıt, günlük) gösterilmez: üretim için geri düşüş yoktur.
Günlüğe yalnız hata sınıfı yazılır. **Dayanıklılık yok:** gönderim süreç içi arka plan işidir;
süreç yanıttan hemen sonra ölürse e-posta gitmez, yeniden deneme/outbox yoktur. Güvenli yol:
kullanıcı "Send a new code" ile yeni kod ister (eskisini geçersiz kılar). E-postalar yalnız
İngilizcedir. **Yayın öncesi yapılması gerekenler (yapılmadı):** bir SMTP sağlayıcısı ve gönderen
alan adı seçmek, SPF/DKIM/DMARC kurmak, gerçek bir alıcıyla teslimatı doğrulamak.

**Mobil:** `app/(auth)/forgot-password.tsx` (+ `src/auth/recovery*.ts`). Kod için yapıştırma/
otomatik doldurma (`one-time-code`), parola göster/gizle, tekrar eşleşmesi, klavyeye duyarlı
yerleşim, 60 sn yeniden gönderim sayacı, süresi dolmuş/geçersiz kod, deneme hakkı bitti, limit
ve geçici hata durumları. Kod ve parolalar **yalnızca bileşen durumundadır** (depoda, SecureStore'da,
günlükte yok; adım ekrandan gidince silinir); e-posta adresi tek paylaşılan değerdir. "Parola
değişti" yalnızca `204` sonrası söylenir; ağ/5xx'te dürüstçe "onaylanamadı" denir. Hesap
değişirse (oturum dönemi) gecikmiş yanıt atılır; kurtarma hiçbir oturum açmaz/kapatmaz.

**Test:** gerçek PostgreSQL + Redis ve ayrı bir test SMTP kutusu (`backend/tests/support/smtp_sink.py`).
Native doğrulama ve e2e kutusu: `mobile/README.md`.

## Staging'e dağıtım (Render + Neon + Upstash + Resend, ücretsiz planlar)

> **Durum (5 Kasım 2026): Neon ve Upstash gerçek servislere karşı doğrulandı, staging
> veritabanına şema kuruldu; sahip Render'a dağıttı (`https://proje-1-t6lh.onrender.com`; ben dağıtmadım,
> yalnız dışarıdan doğruladım) ve çekirdek antrenman yolculuğu iOS simülatöründe bu adrese karşı
> çalıştı. Hiçbir gerçek e-posta gönderilmedi; gerçek iPhone ve genel yayın hazırlığı DOĞRULANMADI.**
> Ayrıntı ve kanıt: aşağıda "Barındırılan doğrulama (Neon + Upstash)" ve "Mobil istemci ↔ staging". "Yerel prova" gerçek
> servislere dokunmaz; yalnızca aynı imajı, TLS'li PostgreSQL/Redis ve bir HTTPS Resend taklidiyle
> çalıştırır. Sağlayıcı davranışı için kaynak 4 Kasım 2026'da okunan resmi dokümanlardır; Resend,
> Render ve istemci adresi hâlâ doğrulanmadı. Bu bir satın alma ya da yayın izni değildir.

### Parçalar

| Parça | Dosya | Not |
|---|---|---|
| Üretim imajı | `backend/Dockerfile`, **son aşama** `production` | Render Dockerfile'ın son aşamasını kurar (hedef seçilemiyor), bu yüzden `production` dosyanın sonundadır. `base`/`dev` hedefleri (compose, E2E) açıkça seçilir ve **değişmedi**. Kaynak ağacını kopyalamaz: yalnız `app/`, `alembic/`, `alembic.ini`, `db/schema_v1.sql` (baseline migration bunu yoldan okur), `deploy/start.sh`. `tests/`, `.env`, dump, araç yok; root olmayan kullanıcı (uid 10001); `--reload`/bind mount yok. |
| Giriş noktası | `backend/deploy/start.sh` | `RUN_MIGRATIONS` (`true` varsayılan \| `false`, başka değer hata) → `alembic upgrade head`, sonra **tek işçili** `uvicorn` `${PORT:-8000}` üzerinde. Migration başarısızsa konteyner **hizmet vermeden** çıkar. |
| Gizli dosyalar | `backend/.dockerignore` | `.env*`, anahtar/sertifika, dump ve `*.sql` (yalnız `db/schema_v1.sql` hariç) build bağlamına girmez; `production` aşaması zaten açık yol listesiyle kopyalar. (Eskiden `.dockerignore` yoktu ve `COPY . .` `backend/.env`'i imajın içine alıyordu.) |
| Blueprint (isteğe bağlı) | `render.yaml` | Panelden elle girmenin eşi. Sırlar `sync: false` (panelde yazılır), `JWT_SECRET_KEY` Render üretir. **Render'a karşı doğrulanmadı.** |
| Hazırlık denetimi | `python -m app.preflight` | Salt okunur; gerçek servislere karşı koşulur (aşağıda). |
| Yerel prova | `backend/deploy/local-staging/` | `bash …/run.sh up \| verify \| down`. |

### Ortam değişkenleri (adlar `backend/.env.example` ile aynı)

Hepsi **Render panelinde: servis → Environment** (veya Blueprint ilk uygulanırken sorulur). Hiçbiri
mobil pakete, depoya, `render.yaml`'a ya da bir `.env` dosyasına girmez. Parola/anahtar içerenleri
günlüğe, ekran görüntüsüne ve sohbete yapıştırma.

| Değişken | Değer | Gizli? |
|---|---|---|
| `ENVIRONMENT` | `staging` | hayır |
| `DATABASE_URL` | `postgresql+asyncpg://KULLANICI:PAROLA@HOST/VERITABANI?ssl=verify-full` (Neon, **doğrudan** host, `-pooler` değil) | **evet** |
| `REDIS_URL` | `rediss://default:TOKEN@HOST:6379` (Upstash, TLS) | **evet** |
| `JWT_SECRET_KEY` | ≥ 32 bayt rastgele (Blueprint üretir; elle: `python -c "import secrets; print(secrets.token_urlsafe(48))"`). Değiştirmek tüm oturumları ve bekleyen kurtarma kodlarını geçersiz kılar | **evet** |
| `MAIL_TRANSPORT` | `resend` | hayır |
| `RESEND_API_KEY` | Resend panelinden | **evet** |
| `MAIL_FROM` | Resend'de **doğrulanmış alan adında** bir adres, örn. `BodyTrack <no-reply@alanadin.com>` | hayır |
| `PASSWORD_WORK_WORKERS` / `PASSWORD_WORK_MAX_QUEUED` | `2` / `16` (küçük örnek; bkz. bcrypt notu) | hayır |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` / `DB_POOL_RECYCLE_SECONDS` | `3` / `2` / `1800` | hayır |
| `RUN_MIGRATIONS` | `true` (veya elle yönetim için `false`) | hayır |
| `PORT` | **ayarlama** — Render atar (varsayılan 10000), `start.sh` bunu dinler | hayır |
| `FORWARDED_ALLOW_IPS` | **boş bırak** (aşağıdaki proxy bölümüne bak); `*` staging/production'da açılışı reddettirir | hayır |

**Açılış güvenlik kontrolleri** (`staging`/`production`'da hata verip hiç başlamaz; mesajlar sırrı yinelemez):
JWT anahtarı ≥ 32 bayt; seçilen taşıyıcı tam yapılandırılmış (`resend`: anahtar, **https** URL, gerçek
gönderen adresi — `*.invalid` ve `@`'sız adres reddedilir; `smtp`: ana makine ve `starttls`/`implicit`);
`DATABASE_URL` sonu **`?ssl=verify-full`** (libpq'nin `sslmode`/`channel_binding`/`sslrootcert`'i
asyncpg'de geçmez, açık bir mesajla reddedilir); `REDIS_URL` **`rediss://`** ve URL'de
`ssl_cert_reqs`/`ssl_check_hostname` yok; `FORWARDED_ALLOW_IPS` içinde `*` yok. Staging'de
`/docs`, `/redoc` ve `/openapi.json` de kapalıdır (yalnız development'ta açık).

### Bulunan ve düzeltilen uyumluluk sorunları (yerel provada)

1. **asyncpg `ssl=verify-full` = "CA dosyası yok" hatası.** asyncpg bu düz dizeyi görünce sistem
   CA'larını değil `~/.postgresql/root.crt`'yi arar; yoksa bağlanmaz (`ClientConfigurationError`).
   `app/core/dburl.py`: `verify-full` gerçek bir `ssl.SSLContext`'e çevrilir (sistem CA'ları veya
   `SSL_CERT_FILE`, zincir **ve ana makine adı** zorunlu). Uygulama, Alembic ve preflight aynı
   fonksiyondan geçer. Neon sertifikası herkese açık bir otoriteden (Let's Encrypt/ISRG Root X1; Neon
   dokümanı) olduğundan Debian CA deposu yeter (imajda var).
2. **redis-py 5.2 `rediss://` ana makine adını DOĞRULAMIYOR** (`ssl_check_hostname` varsayılanı
   `False`; yalnız zincir kontrol edilir). `ratelimit.py` artık `rediss://` için
   `ssl_cert_reqs=required` + `ssl_check_hostname=True` verir ve URL bunu gevşetemez (açılış reddeder).
3. **Alembic `.ini` içinde `%`:** URL'deki `%` (URL-kodlu parola) ConfigParser'da enterpolasyon sayılırdı;
   `env.py` kaçırır.

### Ücretsiz plan sınırları (resmî dokümanlar, 4 Kasım 2026)

- **Render (web servisi):** 15 dk gelen trafik yoksa uyur, uyanma ≈ 1 dk; çalışma alanı başına ayda
  **750** ücretsiz örnek saati (bitince tümü ay sonuna kadar askıya alınır); geçici dosya sistemi
  (yeniden dağıtım/yeniden başlatma/uyku siler; kalıcı disk yok); **SSH/panel kabuğu yok**;
  tek örnek; Render istediği an yeniden başlatabilir; **giden 25, 465 ve 587 portları kapalı** (bu
  yüzden SMTP yerine Resend/HTTPS). Önceden-dağıtım (pre-deploy) komutu sayfada anılmıyor: **varsayılma**,
  migration bu yüzden konteyner açılışında koşar. Ücretsiz Render PostgreSQL kullanılmıyor (30 gün sonra
  süresi dolar, yedek yok).
- **Neon (ücretsiz):** proje başına 1 GB; ayda 100 CU-saat; 5 dk işlemsizlikte **otomatik askıya alma**
  (kapatılamaz; ilk bağlantı bir uyanma gecikmesi taşır); geçmiş penceresi **yalnız 6 saat** ve 1 GB
  değişiklik (bu bir yedek **değildir**); ayda 5 GB çıkış; 0,25 CU'da `max_connections` 104 (97'si
  uygulamaya), bu yüzden havuz küçük tutulur. Pooler (`-pooler`, PgBouncer işlem modu) **kullanılmaz**:
  oturum durumu/oturum seviyesinde advisory lock desteklenmez ve migration doğrudan bağlantı ister
  (kod yalnız işlem-seviyesi `pg_advisory_xact_lock` kullanır; yine de doğrudan host seçildi).
- **Upstash Redis (ücretsiz):** ayda **500 000 komut**, 250–256 MB (sayfa iki değer veriyor), ayda 10 GB
  bant, saniyede 10 000 komut, 1 veritabanı; TLS her zaman açık, `rediss://default:TOKEN@HOST:PORT`. Lua
  (`EVAL`/`EVALSHA`/`SCRIPT LOAD`) dokümanda destekli; `EVAL`'ın tek komut mu sayıldığı sayfada **yok**.
  Sınırlayıcı kayıt/giriş/yenileme/kurtarma başına 1–2 betik çağırır (reddedilen ve iade edilen de);
  `PING` faturalanmaz (readiness bunu kullanır). Aylık kota dolunca sınırlayıcı Redis'e ulaşamaz ve
  **fail-closed 503** verir: giriş/kayıt durur.
- **Resend (ücretsiz):** günde **100**, ayda 3 000 e-posta; istek sınırı saniyede 10 (ekip geneli);
  kota aşımı `429 daily_quota_exceeded`/`monthly_quota_exceeded`. **Alan adı doğrulanmadan yalnız kendi
  e-posta adresine test gönderilebilir** ("testing mode"); başkalarına göndermek için sahibi olduğun bir
  alan adını doğrulayıp `MAIL_FROM`'u o alanda kullanmak gerekir (SPF/DKIM DNS kayıtları). Paylaşılan/
  herkese açık alan adı kabul edilmez. **Alan adın yoksa kurtarma e-postası yalnız senin adresine gider.**

### Kalıcılık ve yedek

Veritabanı yalnız Neon'dadır; Render diski geçicidir. Neon ücretsiz planda 6 saatlik geçmiş penceresinden
başka yedek yoktur ve proje bitince/kota dolunca bu yetmez. Gerçek bir yedek için doğrudan bağlantıyla
kendi bilgisayarından `pg_dump` al (dump dosyası **Git dışında** tutulur; `.gitignore` `*.dump`/`*.backup`/`*.sql.gz`'i, `.dockerignore`
bunlara ek `*.sql`'i dışlar). Redis'teki sayaçlar kalıcılığa güvenilmeden tasarlandı: kaybolurlarsa
sınırlar sıfırlanır, başka veri kaybolmaz. Kurtarma kodları ve oturumlar PostgreSQL'dedir.

### Migration prosedürü (ücretsiz planla uyumlu)

Panel kabuğu ve önceden-dağıtım işi **varsayılmaz**. Şema yalnız Alembic'ten gelir (`schema_v1.sql`
dondurulmuştur, imaja yalnız baseline migration okusun diye girer).

1. **Önce dışarıdan, bilgisayarından** (geliştirme veritabanına DEĞİL, Neon staging'e): üretim imajını
   yerelde kur (`docker build --target production -t bodytrack-staging backend`), staging değerlerini
   **Git dışındaki** bir env dosyasına yaz (`~/secrets/body-track-staging.env`, dizin 700, dosya 600;
   `docker --env-file` **tırnağı değerin parçası sayar**, bu yüzden değerler tırnaksız yazılır). Sağlayıcıdan
   kopyalanan dizeler olduğu gibi yapıştırılır; sürücü/`ssl` dönüşümü ayrı bir **çalışma dosyasına**
   (`body-track-staging.runtime.env`, mod 600) yapılır: `postgresql://` → `postgresql+asyncpg://`,
   `sslmode`/`channel_binding` silinir, `ssl=verify-full` eklenir (kullanıcı adı/parola kaçışına
   dokunulmaz; `-pooler` ana makinesi ve `neon.tech` olmayan host reddedilir); Redis `redis://` →
   `rediss://`, sorgu seçeneği yok, REST URL'si değil. Sonra:
   `docker run --rm --env-file ~/secrets/body-track-staging.runtime.env bodytrack-staging python -m app.preflight`
   — kontroller geçmeden ilerleme. Sonra bir kez:
   `docker run --rm --env-file … bodytrack-staging alembic upgrade head`
   ve `… alembic check` (sıfır fark). (Çalışma dosyasındaki `RUN_MIGRATIONS=false` yalnız `start.sh`'i
   etkiler; doğrudan `alembic` komutu her zaman çalışır.)
2. **Dağıtımda** `RUN_MIGRATIONS=true` kalır: zaten uygulanmış migration'lar no-op, yenileri uygular;
   hata olursa konteyner çıkar, yeni sürüm sağlıklı olmaz ve önceki sürümün çalışmaya devam etmesi
   beklenir (Render davranışı — **barındırılan doğrulama adımı**).
3. **Geriye uyumluluk kuralı:** yeni sürüm migration'ı uygularken eski kod hâlâ çalışıyor olabilir. Her
   migration bir önceki sürümle de uyumlu olmalı (önce ekle, sonra kullan, en son sil). Kolon eklemek
   güvenli; kolon silmek/yeniden adlandırmak iki dağıtıma bölünür.
4. Migration'ı elle yönetmek istersen `RUN_MIGRATIONS=false` yap ve 1. adımı her sürümde tekrarla.
5. Geliştirme veritabanına hiçbir adım dokunmaz; yerel provada kendi Postgres'i vardır.

### Ağ, istemci adresi ve sağlık

- **Render'dan okunabilen resmî bilgi:** yük dengeleyici TLS'i sonlandırır ve isteği servise HTTP ile
  iletir; her web servisi `0.0.0.0:$PORT` dinlemelidir (varsayılan 10000). **İstemci adresi başlıkları
  (`X-Forwarded-For`, `True-Client-IP`) ve proxy adres aralıkları için resmî bir sözleşme bulamadım.**
  Topluluk raporları: Render gelen `X-Forwarded-For`'u silmez, **ekler** (yani sahte değer ekleyebilirsin);
  önünde Cloudflare olduğu söyleniyor. Bunlar resmî değil, doğrulanmadı.
- **Bu yüzden varsayılan korunur:** uygulama başlıkları hiç okumaz (`requester_address`); uvicorn yalnız
  `FORWARDED_ALLOW_IPS`'teki eşten gelen başlığı işler (varsayılan `127.0.0.1`, yani hiç). Sonuç: Render
  arkasında **tüm kullanıcılar proxy'nin adresinde birleşir** ve adres kovaları (giriş 40/10 dk, kayıt
  20/saat, …) **herkes için tek paylaşılan kova** olur. Bu güvenli yöndedir (sahtecilikle kova seçilemez,
  hesap-bazlı tahmin sınırı sürer) ama birkaç kullanıcılık staging için bile "bir kişinin denemeleri
  herkesi kilitleyebilir" demektir; test ederken sınırlara dikkat et ya da bu ortamda `RATE_LIMIT_*_IP_LIMIT`
  değerlerini bilerek yükselt.
- **`FORWARDED_ALLOW_IPS=*` asla:** uvicorn `*` ile `X-Forwarded-For`'un **en soldaki** değerini alır ve
  bu değeri istemci seçer. Bu yüzden `staging`/`production` `*` ile açılmaz. Adres listesi verilirse uvicorn
  zinciri **sağdan sola** gezer ve güvenilir olmayan ilk değeri istemci sayar (`ProxyHeadersMiddleware`,
  uvicorn 0.32.1 kaynağı okundu); proxy'nin eklediği değer güvenilir değilse istemci olarak o seçilir.
- **Kullanıcı başına adresi açmak için (barındırılan adım, yapılmadı):** (1) dağıtımdan sonra farklı
  ağlardan (Wi‑Fi, hücresel) birkaç istek at ve Render günlüğünde uvicorn erişim satırındaki eş adresine
  bak: sabit bir özel aralık mı? (2) Ancak o **kesin** adres/aralık Render tarafından belgelenmiş veya
  tekrar tekrar gözlenmişse `FORWARDED_ALLOW_IPS` olarak yaz (joker yok). (3) Dışarıdan `X-Forwarded-For:
  1.2.3.4` ekleyerek istek at ve kovanın bu değere göre **seçilmediğini** doğrula (örn. 6 yanlış girişten
  sonra başka bir sahte değerle 429 almaya devam ediyorsun). Seçilebiliyorsa geri al.
- **Canlılık ≠ hazırlık.** `GET /health` yalnız süreç cevap veriyor mu (veritabanı/Redis'e dokunmaz) —
  **Render `healthCheckPath`'i ve çalışma izleyicileri bunu kullanmalı.** `GET /health/ready` Neon'a
  `SELECT 1` ve Upstash'e `PING` atar (her biri 4 sn ile sınırlı), yanıtı **5 sn önbelleğe alır** ve
  eşzamanlı çağıranlar tek kontrolü paylaşır; gövde yalnız `{"status":"ready"}` / `{"status":"unavailable"}`
  (503), ayrıntı yok. Platform sondasına bağlamak Neon'u 7/24 uyanık tutar ve Upstash kotasını yer; **yapma**.
  Servisi uyanık tutmak için **yapay trafik eklenmedi** ve eklenmemeli (Render 15 dk sonra uyur; ilk istek
  ≈ 1 dk + Neon uyanması sürer, mobil uygulama bunu ağ zaman aşımı gibi görebilir).
- **Çok küçük CPU:** ücretsiz örnek bir CPU'nun küçük bir kesrini alır; bcrypt (~0,2 sn tam çekirdekte)
  orada çok daha yavaş olabilir. Bu yüzden `PASSWORD_WORK_WORKERS=2`, kuyruk 16 (dolunca 503 + Retry-After).
  Gerçek giriş gecikmesi barındırılan adımda ölçülmeli.
- **Redis zaman aşımı korundu (0,5 sn).** Render ↔ Upstash arası bölge farkı veya soğuk TLS el sıkışması bunu
  aşarsa sınırlayıcı fail-closed `503` verir. Aynı bölgeyi seç (Frankfurt/eu-central-1); yaşanırsa zaman
  aşımını **bilinçli** yükseltmek `RATE_LIMIT_REDIS_TIMEOUT_SECONDS` (en çok 5) ile mümkündür ama güvenlik
  değerlendirmesi ister.

### Yerel prova (barındırılan doğrulama DEĞİL)

`bash backend/deploy/local-staging/run.sh up` (betik çalıştırılabilir bit taşımaz; depo genelinde `core.fileMode` kapalı) üretim imajını `ENVIRONMENT=staging`, `PORT=10000`, TLS'li
PostgreSQL 16 (`verify-full`) ve TLS'li Redis 7 (ana makine adı denetimli) ile çalıştırır; Resend yerine
`tests/support/resend_stub.py` (HTTPS, atılabilir CA) vardır. `run.sh verify` şunları denetler ve hepsi
geçti (4 Kasım 2026): root olmayan süreç, `--reload` yok, imajda `tests`/`.env`/`.git` yok, `PORT`'a
dinleme; `/health`, `/health/ready` ve kapalı `/docs`; açılışta migration'ın head'e gelmesi ve `alembic
check` sıfır fark; kayıt/giriş; **TLS Redis üzerinden Lua sınırlayıcı** (5 yanlış sonra 429 + `Retry-After`);
kurtarma akışı (kod Resend taklidine HTTPS ile gelir, sıfırlama, eski parola ve eski refresh token ölü);
sağlayıcı 429 verirken bile genel yanıt; **Redis düşünce** `/health/ready` 503 (gövdede ayrıntı yok),
giriş 503 (geçirilmez), canlılık 200, dönünce toparlanma; **veritabanı düşünce** aynısı ve havuzun ölü
bağlantıları değiştirmesi; backend günlüğünde parola, sır, kod veya adres yok. Ayrıca: boş bir veritabanında
`python -m app.preflight` + elle `alembic upgrade head` + `alembic check`; bozuk `RUN_MIGRATIONS`,
düz `redis://`, `sslmode=` kopyası, yanlış veritabanı parolası ve güvenilmeyen CA'nın her biri açık bir
mesajla sıfırdan farklı kodla çıkar, hiçbiri hizmet vermez ve parola çıktıya sızmaz.

### Barındırılan doğrulama (Neon + Upstash) — 5 Kasım 2026

Üretim imajı (`--target production`), bilgisayardan, sahibin yeni `body-track` Neon (PostgreSQL 16,
AWS Frankfurt) ve Upstash (Free, Frankfurt) örneklerine karşı. **Render, Resend ve gerçek e-posta bu
turda yok.** Çıktılar URL/host/parola içermez.

| Kontrol | Sonuç |
|---|---|
| Açılış güvenlik kontrolleri (`staging`, `resend`, `ssl=verify-full`, `rediss://`) | geçti |
| Sunucu sürümü | PostgreSQL **16.15**, bağlanma ≈ 0,16–0,19 sn (uyanık hesapla) |
| Veritabanı bağlantısı TLS (**istemci tarafı**) | TLS 1.3, `TLS_AES_256_GCM_SHA384`, sertifika zorunlu, host adı denetimli |
| Collation | `datcollate/datctype = C.UTF-8 / C.UTF-8`; `lower('GÖĞÜS')='göğüs'`, `lower('INCLINE')='incline'` geçti (**Neon varsayılanı bu projede `C.UTF-8`**; önceki "doğrulanamadı" notu kapandı) |
| Uzantılar | `citext`, `pgcrypto`, `unaccent`, `pg_trgm` kurulabilir; migration kurdu |
| Yetki | rol `public` şemasında obje oluşturabiliyor (süper kullanıcı değil) |
| Redis TLS + `PING` | geçti (≈ 0,32–0,43 sn **soğuk** bağlantı, TLS el sıkışması dahil) |
| Sınırlayıcı Lua betikleri (Upstash'te) | limit aşımı reddi, anahtarda TTL (≈ 29,9 sn), iade geçti; ilk `admit` ≈ 0,05–0,16 sn (üretim zaman aşımı 0,5 sn, **değiştirilmedi**) |
| Migration | `alembic upgrade head`: 20 adım, head `d3f8a6b1c294`; `alembic check` sıfır fark; ikinci `upgrade head` **no-op** (0 "Running upgrade") |
| Şema ve seed | 20 uygulama tablosu + `alembic_version`, 61 indeks (3 GIN), 6 trigger, `immutable_unaccent`/`set_updated_at`, 17 kas grubu, 96 egzersiz, 194 egzersiz–kas bağı (102 primary), `gogus`→`Göğüs` aksan-duyarsız arama ve `citext` Türkçe katlama çalışıyor; kullanıcı/antrenman/set/token satırı **0**. Aynı zincirle kurulan yerel test veritabanıyla bu sorgu çıktıları **birebir aynı** |

**Salt okunur / yazan ayrımı (dürüst):** veritabanı tarafındaki preflight yalnız `SELECT`/`SHOW` çalıştırır.
**Redis probu yazar:** `bt:preflight:<rastgele>` önekli geçici bir anahtar oluşturur (30 sn TTL), iade eder ve
siler. Temizlik doğrulandı: koşular sonunda `bt:preflight:*` ile eşleşen anahtar kalmadı; yalnız bu önek silinir.
Şemayı yazan tek adım bilinçli `alembic upgrade head`'dir.

**Preflight'ta bulunup düzeltilen gerçek bir hata:** ilk koşuda "database connection is TLS-encrypted"
**başarısız** oldu. Kontrol PostgreSQL'in `pg_stat_ssl` görünümüne bakıyordu; Neon'un proxy'si TLS'i
sonlandırıp işlem düğümüne kendi iç ağından (özel adres, `ssl=off`) bağlandığı için arka uç "şifresiz"
görüyordu — oysa istemci bağlantısı TLS 1.3 ve sertifika/host doğrulamalıydı. TLS gevşetilmedi: kontrol
artık **bu sürecin kontrol ettiği hattı** ölçer (oturum var mı, TLS 1.2/1.3, `CERT_REQUIRED`, host adı denetimi;
biri eksikse başarısız). `pg_stat_ssl` yalnız bilgi satırıdır. Doğrulanamayan kısım: Neon proxy → işlem düğümü
iç hattı sağlayıcının güven sınırıdır.

**Hedefin kimliği:** yalnızca PG16, boş (kullanıcı ilişkisi/fonksiyon yok, yalnız `plpgsql`, ≈ 7,5 MB) olması
yetmedi — veritabanı/rol adları (`yeahbuddy` / `yeahbuddy_owner`) Neon varsayılanı olmadığından sahip, `body-track`
projesinde bu adları gördüğünü açıkça onayladı; ancak ondan sonra migration uygulandı.

**Dar pay (sayı, yorum değil):** soğuk `PING` ≈ 0,32–0,43 sn ile 0,5 sn zaman aşımının altında ama yakın. Bu
ölçüm bilgisayardan (Türkiye → Frankfurt) yapıldı; Render ↔ Upstash arası farklı olabilir. Zaman aşımı **artırılmadı**;
barındırılan adımda ilk istekte 503 görülürse ayrıca değerlendirilir (aşağıda 7. madde).

**Resend (sınırlı test yapılandırması):** `MAIL_FROM=BodyTrack <onboarding@resend.dev>` yalnızca Resend
hesap sahibinin kendi e-posta adresine gönderebilir; rastgele kullanıcılara parola kurtarma e-postası
**gönderemez**. Gönderim bu turda denenmedi; yalnız anahtarın yapılandırıldığı (`mail transport 'resend' is
configured`) görüldü, anahtarın geçerliliği ve teslimat doğrulanmadı.

### Mobil istemci ↔ staging (5 Kasım 2026, iOS simülatörü; fiziksel cihaz DEĞİL)

**Yapılandırma.** Yalnız yerel, Git dışı `mobile/.env` içinde `EXPO_PUBLIC_API_URL=https://proje-1-t6lh.onrender.com`
(istemci `/api/v1`'i kendisi ekler; URL'ye yazılmaz; kaynakta sabit adres yok; `.env.example`'ın amacı —
yerel geliştirme — değişmedi). Önceki yerel değer `.env`'de yorum satırı olarak durur. `EXPO_PUBLIC_*` değerleri
pakete **düz metin** girer: backend sırları, JWT anahtarı, veritabanı adresi ve Resend anahtarı mobil
yapılandırmaya **asla** yazılmaz. Expo belgesine göre `.env` düzenlemesi için CLI'yi yeniden başlatmak gerekmez,
çalışan uygulamada **tam yeniden yükleme** (Expo Go'da sallayıp *Reload*) gerekir; bu bilgi *canlı* belge
sayfasından okundu (v57'ye özel sayfa değil) ve kabuk ortam değişkeninin `.env`'e önceliğini belge söylemiyor.
Deneysel doğrulama: yalnız `.env` ile başlatılan Metro'nun ürettiği iOS paketinde `EXPO_PUBLIC_API_URL`
hosted adrese sabitlendi, `localhost:8000` yalnızca yorum ve hata metninde geçiyor. Yeniden yükleme işe
yaramazsa Metro'yu `npx expo start --clear` ile yeniden başlat.

**Dışarıdan sağlık (bağımsız):** `/health` 200 `{"status":"ok","environment":"staging"}` (≈ 0,41 sn),
`/health/ready` 200 `{"status":"ready"}` (≈ 0,31 sn), `/docs` 404. Servis o anda **uyanıktı**; **soğuk başlangıç
ölçülmedi**.

**Yöntem ve sınır.** Mevcut `e2e/scripts/up.sh|run.sh|down.sh` kasıtlı olarak **yerel Docker yığınına** bağlı
(hesabı `127.0.0.1`'e kaydeder, `down -v` ile hacim siler); hosted staging'e **yönlendirilmedi** ve korumaları
gevşetilmedi. Yalnız özel `BodyTrack-E2E` simülatörü (Expo Go SDK 57, temiz Keychain), mevcut adım dosyaları
(`open-app`, `sign-out`, `sign-in`) ve depo dışında yazılan, tek kullanımlık Maestro akışları kullanıldı;
bu akışlar depoya **eklenmedi**. Maestro `--udid` ile yalnız özel simülatöre bağlandı; sahibin cihazına/
Keychain'ine dokunulmadı.

**Geçici hesap:** `bt-staging-test-9a5500@example.com` / `bt_stg_9a5500` (`example.com`'a posta gitmez; kurtarma
e-postası **gönderilmedi**). Hız sınırları açık bırakıldı: 1 kayıt, 1 arayüz girişi (çıkıştan sonra), 1 API giriş
denemesi (silme sonrası, 401); başarısızlık döngüsü yok, yazma isteklerine otomatik yeniden deneme eklenmedi.

| # | Doğrulama (simülatör, native UI) | Sonuç |
|---|---|---|
| 1 | Kayıt (arayüzden) ve giriş | geçti — kayıt sonrası doğrudan Training ekranı; ayrıca çıkıştan sonra yeniden giriş geçti |
| 2 | Training ekranı katalogu yüklüyor | geçti — seçici filtresiz liste ve "Barbell Bench" araması (Barbell/Decline Barbell/Incline Barbell Bench…) geldi |
| 3 | Antrenman başlat, egzersiz ekle | geçti (check-in "Skip" ile atlandı) |
| 4 | **Tam bir** çalışma seti, 80 kg × 8 | geçti — "Set 1, 80 … 8 reps", "1 working sets", "Set 2" yok |
| 5 | Antrenmanı bitir | geçti (onay iletişim kutusu "Finish") |
| 6 | Geçmişten aç, seti doğrula | geçti — "…, 1 sets" → "Edit workout", "Barbell Bench Press", "1 working sets", "80 kg", "× 8" |
| 7 | Uygulamayı kapatıp aç: oturum + veri | geçti — giriş ekranı **görünmedi**, "Profile" sekmesi geldi, geçmiş ve set aynı |
| 8 | Çıkış → özel veri temizliği | geçti — çıkış sonrası "Recent workouts", "…, 1 sets", "Barbell Bench Press" yok; kapatıp açınca hâlâ çıkış durumunda; yeniden girişte veri **sunucudan** geri geldi |
| 9 | Hesap silme (temizlik) | geçti — uygulamadan silme, "Your account has been deleted" bildirimi, yeniden açılışta oturum kapalı; API'de silinen bilgilerle giriş **401** |

Kanıt: Maestro komut kayıtları (`commands.json`) — yolculuk 83 komut (81 tamamlandı, 2 atlandı), çıkış/yeniden
giriş 37 (35 tamamlandı, 2 atlandı), silme onayı + yeniden açılış 16 (15 tamamlandı, 1 atlandı); **hiçbiri
başarısız değil**. Atlananların hepsi koşullu `runFlow`: iOS'un "Open in Expo Go?" iletişim kutusu bu açılışlarda
görünmediği için "Open" dokunuşu atlandı (yolculuk akışının 2 yeniden açılışı, çıkış akışının 2'si, silme
akışının 1'i); Expo Go ilk kurulum tanıtması ise çalıştı. Ekran görüntüleri depo dışındaki geçici dizinde.

**Dürüstçe sınırlar ve bulgular:**
- Bu bir **simülatör**; fiziksel iPhone, VoiceOver, Dynamic Type, hücresel ağ ve gerçek Keychain davranışı denenmedi.
  Uygulama Expo Go içinde (geliştirme sunucusu) çalıştı; **imzalı/TestFlight yapısı denenmedi**.
- "Özel veri temizlendi" yalnızca **ekrandan** doğrulandı; SecureStore/Keychain ve cihaz depolama içeriği
  doğrudan incelenmedi. Silinen hesabın veritabanı satırlarının gittiği sunucu veritabanında **incelenmedi**
  (uygulama bildirimi + giriş 401); katalog seed'ine dokunulmadı.
- **Uygulama kusuru bulunmadı; kaynak değişmedi.** Üç sorun **araç/ortam** kaynaklıydı: (a) kayıt formunda
  `tapOn: "Email"` etiketi giriş alanı yerine etiket metnine denk geldi (yalnız "First name" doluydu); sunucuya
  göndermeden placeholder metinleriyle düzeltildi; (b) **makinenin diski doldu** (ENOSPC): Maestro'nun terminal
  çıktısı kayboldu ve komutlar çalışmadı — sonuçlar `commands.json`'dan çıkarıldı, silme akışı disk açılana
  kadar bekledi; (c) silme akışında `scrollUntilVisible: id delete-account-confirm` 15 sn'de zaman aşımına
  uğradı, oysa düğme ekranda görünürdü — nedeni **açıklanamadı** (yerel yığındaki aynı akış önceden geçmişti);
  onay "Yes, delete my account" metniyle verildi. Erişilebilirlik kimliğinin bu panelde ağaçta olup olmadığı
  ayrıca incelenmeli.
- Docker Desktop disk dolunca başlamaz hale geldi (`Docker Desktop is unable to start`); geliştirme servisleri
  (backend/db/redis) bu yüzden durmuş olabilir. Docker'a, hacimlere ve imajlara **dokunulmadı**.
- Yeni dağıtımın doğruladıkları bu yolculukla **sınırlı**. Birkaç başarılı istek ve sağlıklı `/health` genel yayın
  hazırlığını göstermez.

### İlk iPhone test yapısı: Aures, TestFlight, staging (5 Kasım 2026)

**Durum: yapılandırma doğrulandı; bulutta derleme ve imzalama için sahibin Apple oturumu gerekir. Hiçbir yapı
henüz yüklenmedi, hiçbir tester'a dağıtılmadı, gerçek iPhone'da hiçbir şey denenmedi.** Bu bölüm üç şeyi ayırır:
*yapılandırma doğrulaması* (aşağıda yapıldı), *bulut derlemesinin tamamlanması* (yapı durumu için proje günlüğüne,
Adım 76'ya bak) ve *gerçek iPhone davranışı* (hiç yapılmadı).

**Kimlik.** Görünen ad **Aures**, `slug` ve URL şeması `aures`, iOS paket kimliği `com.efenayin.aures`
(`mobile/app.json`). *Aures* sahibin bilinçli seçimidir; aynı adı kullanan ilgisiz uygulamalar olduğu bilinerek
korundu. **App Store adı uygunluğu ve marka taraması YAPILMADI.** `CFBundleDisplayName` (telefonda görünen ad)
App Store Connect'teki *liste adından* bağımsızdır; Apple liste adını reddederse başka bir ad **sessizce
seçilmeyecek**, karar sahibe döner. Dahili adlar (backend, veritabanı, migration, `bodytrack.*` depolama anahtarları,
`package.json` adı `mobile`) bilerek değişmedi: depolama anahtarlarını değiştirmek kayıtlı oturumları düşürürdü.
`mobile://` şemasına kodda, testlerde ve E2E akışlarında hiçbir başvuru yoktu (yalnız `app.json`).

**Expo sahipliği.** Önceden `owner`/`projectId`/`eas.json` yoktu; korunacak bir ilişki bulunmadı. `eas init` ile
kişisel hesapta **`@efe_nayn/aures`** (ID `751aebe3-68ef-4617-ac03-9060ce2d0d81`) oluşturuldu; `owner: efe_nayn` ve
`extra.eas.projectId` `app.json`'a yazıldı. Sahibin ikinci bir Expo hesabı (`efenayns-team`) de var; **kullanılmadı** —
projeyi ekibe taşımak istenirse ayrı bir karar. `eas init` ayrıca EAS panelindeki proje ikonunu uygulamanın
**şablon** ikonundan ayarladı (aşağıya bak).

**Derleme profili `testflight-staging`** (`mobile/eas.json`): `distribution: "store"`, `autoIncrement: true`,
`cli.appVersionSource: "remote"` (derleme numarasını EAS tutar ve her derlemede artırır; `version` `1.0.0`; ilk numarayı EAS belirler, **bu işte henüz bir derleme olmadı**) ve
`env.EXPO_PUBLIC_API_URL=https://proje-1-t6lh.onrender.com` **açıkça verilir** (yerel, Git dışı `.env` buluta gitmez
ve gerekmez). `EXPO_PUBLIC_*` değerleri pakete düz metin girer ve `eas.json` depoda durur: yalnız herkese açık
adres vardır, **sır yoktur**. Bu profil App Store Connect'e **yüklemez** (yükleme ayrı `eas submit` adımıdır;
bu işte yapılmadı); OTA güncelleme, abonelik, bildirim, analitik SDK'sı eklenmedi.

**Buluta ne gider (kanıtlandı).** EAS, `.easignore` varsa **tüm `.gitignore` dosyalarının yerine** onu okur ve
yalnız Git deposu kökünden. Bu yüzden kökteki `.easignore` mevcut kuralları aynen tekrarlar ve ayrıca `backend/`,
`render.yaml`, `docker-compose.yml`, `mobile/e2e/`, `mobile/tests/`, kökteki `*.md`/`*.txt`, tüm `.env*`,
`.claude/` ve `.git`'i dışlar (kabuk bir klonun `.git`'i dışlanan backend kaynağını ve notları da taşırdı).
`eas build:inspect --platform ios --stage archive --profile testflight-staging --output <boş dizin>` ile arşiv
**yerelde** üretilip incelendi: 192 dosya, **hepsi Git'te izlenen dosya**; `backend/`, `e2e`, `tests` yalnız **boş
dizin iskeleti**; `.env`, dump, `*.sql`, anahtar/sertifika, `AGENTS.md`, Unicode hazırlık metni, kanıt dosyası
**yok**. `cli.requireCommit` **kullanılmadı**: kirli çalışma ağacında (sizin commit'lenmesini istemediğiniz
`docker-compose.yml` değişikliği ve izlenmeyen iki dosya) derlemeyi tümden engeller; bu dosyalar zaten
`.easignore` ile dışlanır. Derlemenin kaynağı, EAS'in kaydettiği Git commit'i ve temiz `mobile/` ile
tanımlanır. Her derlemeden önce yeniden denetle: `git status --short mobile .easignore` boş olmalı.

**ATS (App Transport Security).** Çözümlenen yapılandırmada `NSAllowsArbitraryLoads: true` (+ `localhost`
istisnası) çıktı; bu açık metin HTTP'ye izin verir. API HTTPS olduğundan `app.json`'da `ios.infoPlist.
NSAppTransportSecurity = {NSAllowsArbitraryLoads: false}` açıkça verildi ve yeniden çözümlenerek doğrulandı.
Expo Go bundan etkilenmez; ileride bir *geliştirme istemcisi* yapısı yerel HTTP'ye bağlanacaksa ayrıca istisna ister.

**Cihaz desteği.** Yalnız iPhone (`supportsTablet: false`, dikey yön). iPad'de uygulama yüklenebilir ama iPhone
uyumluluk modunda çalışır; **tasarlanmadı ve denenmedi**. Android bu yapıda yok. Minimum iOS sürümü ve gerçek
cihaz uyumluluğu SDK 57 varsayılanına bırakıldı; **doğrulanmadı**.

**İzinler.** Kamera, mikrofon, konum, kişiler, fotoğraf, bildirim, arka plan modu **yok** (ilgili paketler
bağımlılıklarda yok). Tek `NS*UsageDescription`: `NSFaceIDUsageDescription` — `expo-secure-store` eklentisinin
varsayılanı; kodda biyometrik/`requireAuthentication` kullanımı **yok** (0 eşleşme), yani yalnız bir izin metni.
Gerekirse yapılandırmadan çıkarılabilir; **şimdi değiştirilmedi** (App Store incelemesi sorabilir).

**Görseller (şablon, onaylı DEĞİL).** `icon.png` (1024×1024, alfa yok) Expo'nun **varsayılan şablon ikonudur**
(mavi "A" şekli), `splash-icon.png` şablon açılış ızgarasıdır; `react-logo*`, `partial-react-logo` ve
Android ikonları şablondan kalmadır (kullanılmıyor), `login/hercules-bronze.jpg`'in **kaynağı/lisansı
doğrulanmadı** (kodda yalnız bir testte geçiyor). Marka görseli **uydurulmadı**; Aures ikonu, açılış ekranı ve
mağaza görselleri sahibin işidir. Şablon ikon TestFlight'ta görünür; mağaza incelemesine gitmeden değişmelidir.

**Kontroller (yalnız yapılandırma/kaynak; native derleme değil):** `tsc --noEmit` 0 hata, `npm run lint` 0 uyarı,
`node --test tests/*.test.cjs` **712/712 geçti**, `expo config` (public + introspect) beklenen kimliği verdi,
`expo-doctor` **20/21** geçti. Başarısız tek kontrol: SDK 57 paketlerinde **yama sürümü kayması** (örn. `expo`
57.0.20, beklenen 57.0.31; 15 paket). Simülatörde doğrulanan kilit dosyasını değiştirmemek için **yükseltilmedi**;
mağaza yapısı öncesi ayrı bir iş olarak (`npx expo install --check`) ele alınmalı. Plan: ücretsiz Expo planı;
ücretli yükseltme gerekmedi. `eas-cli` 27.4.1 `npx` ile (kalıcı kurulum yok).

**Mağaza/gizlilik için YAPILMAYANLAR:** gizlilik politikası ve destek URL'si; App Privacy ("nutrition label")
beyanı (e-posta, kullanıcı kimliği, kilo/antrenman/sağlık-fitness verisi toplanıyor); **ihracat uyumluluğu**
(`ITSAppUsesNonExemptEncryption` ayarlanmadı: bu sahibin hukuki beyanıdır, App Store Connect her yapıda soracaktır);
yaş derecelendirmesi; mağaza adı/marka taraması; gerçek ikon ve görseller. Uygulama içi **hesap silme** vardır
(Apple şartı) ve simülatörde doğrulandı.

**Hâlâ açık yayın engelleri (bu yapı bunları KAPATMAZ):** Render güvenilir istemci IP'si/proxy doğrulaması;
doğrulanmış gönderen alan adı ve gerçek kurtarma e-postası teslimi (`onboarding@resend.dev` yalnız Resend hesap
sahibine gönderir); ücretsiz katmanda soğuk başlangıç (≈ 1 dk + Neon uyanması; mobil bunu ağ zaman aşımı gibi
görebilir); fiziksel cihaz testi (Keychain, VoiceOver, Dynamic Type, hücresel ağ); mağaza/gizlilik gereksinimleri.

### Dağıtım sonrası doğrulanacaklar (sırayla; 1. ve 2. madde Neon/Upstash için 5 Kasım 2026'da yapıldı)

1. ~~`python -m app.preflight` gerçek Neon + Upstash'e karşı~~ — **yapıldı** (yukarıdaki tablo). Render'ın ağından
   tekrar edilmeli (özellikle Redis süresi).
2. ~~Staging'e `alembic upgrade head` → `alembic check`~~ — **yapıldı** (head `d3f8a6b1c294`, sıfır fark, tekrar = no-op).
3. Render'da servisi oluştur, ilk dağıtımın günlüğünde `start: migrations are at head` ve uvicorn satırını gör;
   Render'ın `PORT`'unu ve **imajın son aşamasını** (production) kullandığını doğrula.
4. ~~`GET /health`, `GET /health/ready`; `/docs` 404~~ — dışarıdan **yapıldı** (5 Kasım 2026, uyanık serviste).
   Kayıt/giriş/yenileme ve çekirdek antrenman yolculuğu simülatörde geçti ("Mobil istemci ↔ staging"); **soğuk
   başlangıç, Render istemci adresi, ücretsiz CPU'da bcrypt ve Resend açık**.
5. Kayıt + giriş + yenileme (telefonun staging adresine bakacak bir `EXPO_PUBLIC_API_URL` build'i **bu işin
   kapsamı dışı**; önce `curl` ile).
6. Resend: alan adı doğrulandıktan sonra bir kurtarma kodu iste → e-posta gelsin, sıfırla; ardından
   (kontrollü) sağlayıcı reddi/kota durumunda uygulamanın genel yanıt verdiğini gözle.
7. Soğuk başlangıç: 15 dk bekle, ilk isteğin süresini ve (Neon askıdaysa) bağlantı gecikmesini ölç; ilk
   Redis isteğinde 0,5 sn zaman aşımı 503 üretiyor mu?
8. Proxy/istemci adresi (yukarıdaki üç adım); birleşik kovanın kullanılabilirliğini gör.
9. bcrypt gecikmesi (tek giriş süresi) ve 503 (meşgul) eşiği.
10. Başarısız migration'da önceki sürümün hizmette kaldığını, bir deneme dağıtımıyla (zararsız bir
    hatalı migration ile **staging'de**) doğrula.

### Sahip için pano kurulum listesi (sırayla)

1. **Neon:** hesap → proje (bölge: AWS Frankfurt, eu-central-1; Postgres 16) → veritabanı + rol.
   Bağlantı dizesinde **doğrudan host'u** seç: host adında `-pooler` geçmemeli (pooler kapalı olmalı). Bağlantı dizesini al; `postgresql://`
   → `postgresql+asyncpg://` yap, `?sslmode=…&channel_binding=…` kısmını sil, yerine `?ssl=verify-full`
   yaz. Bunu yalnız bir parola yöneticisine/Render ortamına koy.
2. **Upstash:** hesap → Redis veritabanı (**aynı bölge**, eu-central-1, ücretsiz plan, TLS) → *Connect*
   → TCP: `rediss://default:TOKEN@HOST:PORT` biçimini oluştur.
3. **Resend:** hesap → *Domains* → sahibi olduğun alan adını ekle ve DNS kayıtlarını (SPF/DKIM) gir →
   doğrulanana kadar bekle → *API Keys* → anahtar oluştur (seçenek varsa yalnız gönderim yetkisiyle). (Alan adı yoksa: bu adım atlanır,
   kurtarma e-postası yalnız kendi adresine gider.)
4. **Bilgisayardan:** yukarıdaki `preflight` ve `alembic upgrade head` (Migration prosedürü, 1. adım).
5. **Render:** *New → Web Service* (veya Blueprint) → bu GitHub deposu, dal: staging için seçtiğin dal →
   *Runtime: Docker*, *Dockerfile path* `./backend/Dockerfile`, *Docker context* `./backend`, bölge
   **Frankfurt**, plan **Free**, *Health check path* `/health`, *Auto-deploy* kapalı → *Environment*
   bölümüne yukarıdaki tablodaki değişkenleri gir (`PORT` ve `FORWARDED_ALLOW_IPS` hariç) → *Create*.
6. İlk dağıtım günlüğünü izle; "Dağıtım sonrası doğrulanacaklar" listesini sırayla yürüt.
7. Bitince: kullanılmayan servisi askıya al. Anahtarları **körlemesine hepsini döndürme**; bir sır
   günlükte, ekran görüntüsünde, sohbette ya da Git'te göründüyse, bir makine/hesap ele geçirildiyse,
   birine paylaşıldıysa veya bir ekip üyesi ayrıldıysa döndür (Neon rol parolası, Upstash parolası,
   Resend anahtarı, `JWT_SECRET_KEY` — sonuncusu tüm oturumları ve bekleyen kurtarma kodlarını
   geçersiz kılar). Yalnız kurulum yapıldı diye döndürmek gereksiz kesinti üretir ve yeni sırların
   da güvenli saklanması gerekir.

### Çözülmemiş / dürüstçe açık olanlar

- **Neon collation:** ~~doğrulanamadı~~ → bu `body-track` projesinde `C.UTF-8 / C.UTF-8` olarak ölçüldü
  ve `GÖĞÜS` testi geçti (5 Kasım 2026). Başka bir Neon projesi/veritabanı için aynı preflight yeniden koşulmalı;
  başarısızsa şema orada güvenle kurulamaz.
- **İstemci adresi:** Render'ın başlık sözleşmesi resmî olarak bulunamadı; varsayılan "herkes tek kova".
- **Resend alan adı** sahipliği gerekir; yoksa gerçek kullanıcılara e-posta yok.
- **Upstash'te Lua:** betikler gerçek serviste çalıştı (aşım reddi, TTL, iade; ilk `admit` ≈ 0,06 sn).
  Hâlâ bilinmeyen: `EVAL` başına kaç komut sayıldığı (500 000/ay kotası) — Upstash panelindeki kullanım
  sayacı birkaç gerçek istekten sonra karşılaştırılmalı — ve Render'dan gecikme.
- **Render'ın son aşamayı kurduğu** ve `render.yaml` anahtarları Render'a karşı denenmedi.
- Gönderim **dayanıklı değil** (outbox yok): süreç yanıttan hemen sonra uyursa/yeniden başlarsa e-posta
  gitmez; Render ücretsiz örneği her an yeniden başlatılabilir. Kullanıcı yeni kod ister.

## Faz planı (özet)

1. **Faz 1 (Ay 1-3, MVP):** manuel loglama + kas grubu hacim analizi
2. **Faz 2 (Ay 4-6):** sosyal feed, mezocycle, vücut ölçüleri
3. **Faz 3 (Ay 7-8):** akıllı program önerisi + opsiyonel video form check — bitirme teslimi
4. **Faz 4+ :** RL program önerisi, HAR otomatik loglama
