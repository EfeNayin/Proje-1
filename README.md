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
değiştirmez.

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

**E-posta teslimatı (yapılandırma):** tek küçük bağdaştırıcı, standart kütüphane `smtplib` (yeni
bağımlılık yok). Sağlayıcı **seçilmedi**; `backend/.env.example` yalnızca yer tutucu içerir.
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

## Faz planı (özet)

1. **Faz 1 (Ay 1-3, MVP):** manuel loglama + kas grubu hacim analizi
2. **Faz 2 (Ay 4-6):** sosyal feed, mezocycle, vücut ölçüleri
3. **Faz 3 (Ay 7-8):** akıllı program önerisi + opsiyonel video form check — bitirme teslimi
4. **Faz 4+ :** RL program önerisi, HAR otomatik loglama
