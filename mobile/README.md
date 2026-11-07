# BodyTrack — Mobil

React Native + Expo (Expo Router, TypeScript strict) ile yazılmış BodyTrack
istemcisi. Ürün bağlamı ve mimari kararlar için kök dizindeki `CLAUDE.md`'ye
bakın; bu dosya yalnızca mobil klasörün kendi kurulum/komut referansıdır.

## Kurulum

```bash
npm install
cp .env.example .env    # backend URL'ini düzenleyin
npx expo start
```

Çıktıda uygulamayı açmak için seçenekler görürsünüz:

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go)

Ekranlar `app/` altında dosya tabanlı yönlendirme (Expo Router) ile
tanımlanır; ekran haritası için `PROJE_1_CODEX_INCELEME.md` bölüm 6'ya bakın.

## Geliştirme komutları

```bash
npm run typecheck              # tsc --noEmit, sıfır hata olmalı
npm run lint                   # expo lint

npm run test:session           # oturum/refresh davranışı
node --test tests/session-concurrency.test.cjs # çıkış/yenileme/hesap değiştirme sıralaması (gecikmeli Keychain + ağ)
npm run test:history           # antrenman geçmişi sayfalama
npm run test:research-feed      # araştırma ekranı sayfalama / geç yanıt / PubMed bağlantısı
npm run test:research-navigation # Research geri davranışı (push + anchor + native ok)
npm run test:diagnosis         # teşhis ekranı metinleri
npm run test:diagnosis-requests # dönem isteklerinde son-yanıt tutarlılığı
npm run test:lifecycle         # bileşen yaşam döngüsü
npm run test:weight-unit       # kg/lb dönüşüm katmanı

node --test tests/*.test.cjs   # tüm mobil testler (bazı dosyaların ayrı npm script'i yok)
```

Testler `node --test` ile çalışan `.cjs` dosyalarıdır; `tests/` klasöründe
yer alır ve gerçek React render/hook davranışını test eder — telefon
üzerindeki form/klavye etkileşiminin yerini tutmaz.

## Tarayıcı önizlemesi (yalnızca geliştirme)

UI geliştirirken telefon yerine masaüstü tarayıcıda açmak için (iPhone klavye/dokunma
doğrulamasının yerini **tutmaz**):

1. `backend/.env` içine `CORS_ALLOWED_ORIGINS=http://localhost:8081` ekle ve backend'i
   yeniden oluştur (`env_file` yalnızca oluşturulurken okunur):
   `docker compose up -d --no-deps backend`. Yalnızca `http://localhost[:port]` /
   `http://127.0.0.1[:port]` kabul edilir; `*`, başka adresler ve staging/production'da
   dolu değer backend'i başlatmaz.
2. `EXPO_PUBLIC_API_URL=http://localhost:8000 npx expo start --web --port 8081`
   (başka bir Metro zaten 8081'deyse başka port seç ve onu da `CORS_ALLOWED_ORIGINS`'e yaz).
3. Tarayıcıda `http://localhost:8081`.

Oturum belirteçleri **yalnızca bellekte** tutulur (`src/dev/webSecureStore.ts`;
`metro.config.js` bunu yalnızca web platformunda `expo-secure-store` yerine koyar).
localStorage/cookie kullanılmaz, bu yüzden sayfayı yenilemek oturumu kapatır — beklenen
davranış. iOS/Android paketleri gerçek SecureStore'u kullanmaya devam eder; üretim
(`__DEV__` kapalı) web çıktısında gölge depo çalışmayı reddeder.

Bu proje `Expo ~57` üzerine kuruludur (bkz. `package.json`); versiyona özgü
API farklılıkları için `AGENTS.md` dosyasındaki notu izleyin.

## Yerel iOS UI smoke testi (Maestro)

`e2e/` altında, **simülatörde gerçek native UI** ile çalışan tek bir atlet
yolculuğu vardır: giriş → Training → antrenman başlat → "Barbell Bench Press"
seç → ağırlık + tekrar gir (RIR boş) → set kaydet → antrenmanı bitir →
geçmişten aç → set hâlâ orada. Bu bir **smoke testidir**; koç akışlarını,
VoiceOver'ı, Dynamic Type'ı veya fiziksel cihazı kapsamaz. Expo Go (SDK 57)
üzerinde çalışır, dev client değildir.

Ön koşullar (hepsi kullanıcı düzeyinde, `sudo` gerekmez):

- Xcode + bir iOS simülatör runtime'ı (denenen: Xcode 27.0, iOS 27.0)
- Docker Desktop (izole backend + Postgres + Redis için)
- Java 17+ (`brew install openjdk@21`; PATH'e eklemek gerekmez, betikler bulur)
- Maestro CLI (denenen: 2.11.0). Kurulum betiği shell profilini değiştirdiği
  için resmi `maestro.zip` arşivini `~/.maestro` altına elle açmak yeterlidir
  (bkz. https://docs.maestro.dev/getting-started/installing-maestro)

```bash
cd mobile
e2e/scripts/up.sh      # izole stack + özel simülatör + Metro (bir kez)
e2e/scripts/run.sh     # akışı çalıştırır; her koşuda yeni geçici hesap
e2e/scripts/down.sh    # yalnızca bu testin kayıtlarını/servislerini siler
```

`down.sh --simulator` özel simülatörü de siler. İsteğe bağlı değişkenler:
`E2E_HOME` (durum/kanıt klasörü, varsayılan `~/.cache/bodytrack-e2e`),
`E2E_API_PORT` (8100), `E2E_METRO_PORT` (8091), `E2E_DEVICE_TYPE`.

Güvenlik modeli:

- Kendi compose projesi (`bodytrack-e2e`), kendi veritabanı (`bodytrack_e2e`);
  geliştirme veritabanına veya `bodytrack_test`'e hiç dokunmaz. Çalışan
  servislerinizi (8000, 8081) durdurmaz/yapılandırmaz; boş portlar kullanır.
- `down.sh`, silmeden önce kimliği doğrular: çalıştırma klasöründeki run id,
  her konteynerin etiketi ve veritabanı yorumu (`bodytrack-e2e-run:<id>`)
  aynı olmalı; değilse **reddeder**.
- API adresi yalnızca Metro sürecinin ortam değişkenidir
  (`EXPO_PUBLIC_API_URL`); `.env` dosyalarına yazılmaz. Parolalar koşu başına
  rastgele üretilir, depoda değil `E2E_HOME` altında (0600) durur ve loglarda
  maskelenir.
- Yalnızca `BodyTrack-E2E` adlı özel simülatör sıfırlanır (Expo Go yeniden
  kurulur, keychain boşaltılır); mevcut simülatörlerinize/cihazlarınıza dokunulmaz.
- Ekran görüntüleri ve loglar `E2E_HOME/current/artifacts/` altındadır;
  depoya girmez.

Bilinen sınırlar ve ilk-çalıştırma tuzakları (akış bunları ele alır):

- Expo Go ilk açılışta geliştirici menüsü tanıtımı gösterir ve yüzen "Tools
  button" dişlisi "Finish workout" düğmesinin üstüne biner; akış menüden
  düğmeyi kapatır.
- iOS'un "Save Password?" sayfası Maestro'ya görünmez ve uygulamayı kapatır;
  `sim.sh` özel simülatörde parola otomatik doldurmayı kapatır.
- Akış **yazılım klavyesini** gerektirir (simülatörün donanım klavyesi bağlı
  değilken varsayılanı): klavyenin "Done" tuşunun set kaydetmediğini ve
  "Log set"/"Save"in klavye açıkken erişilebilir olduğunu doğrular. Donanım
  klavyesi bağlıysa akış `Dictate` tuşunu bulamayıp açık bir hatayla düşer.
  Ondalık tuş takımında (ağırlık) iOS "Done" göstermez; sayı tuş takımlarında
  (Reps, RIR) gösterir. Klavye animasyonu sürerken form kaydırıldığı için
  akış, ilgili dokunuşlardan önce `waitForAnimationToEnd` kullanır.
- `CI=1` ile Metro dosya izlemez: uygulama kaynağını değiştirirseniz
  `e2e/scripts/metro-restart.sh` çalıştırın.
- Metro, `NODE_OPTIONS=--dns-result-order=ipv4first` ile başlatılır; aksi
  halde yalnızca `::1`'e bağlanıp bildirimdeki 127.0.0.1 ile uyuşmaz.

### Hesap değiştirme akışı (native)

`e2e/scripts/session.sh` (önce `up.sh`) aynı izole yığında iki geçici hesapla
`e2e/flows/session-switch.yaml`'ı çalıştırır: A girer (bitmiş + açık bir antrenmanı var),
çıkar, uygulama **depolama/Keychain temizlenmeden** kapatılıp yeniden açılır ve çıkış yapılmış
kaldığı doğrulanır, sonra B girer ve A'nın verisinin görünmediği doğrulanır. Gecikmeli
yanıt/depolama yarışları native'de denenmez (üretim koduna test kancası eklenmez); onlar
`tests/session-concurrency.test.cjs`'tedir.

### Sporcuya özel program akışı (native)

`e2e/scripts/revisions.sh` (önce `up.sh`) aynı izole yığında bağlı bir koç ve sporcu için
`e2e/flows/program-revisions.yaml`'ı çalıştırır. Hesaplar, bağlantı, koçun programı ve sporcunun
kendi aktif programı ("Athlete Own") API ile kurulur (fixture); aşağıdakilerin hepsi ekranda
gerçek dokunuşlarla yapılır, tek simülatörde hesaplar sırayla (eşzamanlı iki cihaz **değil**):

1. Koç kendi programından sporcuya özel taslak hazırlar (düzenleyicide alıcı bandı, etkinleştirme
   yok), sunucunun önizlemesini okur, **1. sürümü** açıkça yayımlar.
2. Sporcu programı alır, kabulün etkisini okur ve ekler: kopya pasiftir, **farklı bir aktif programı
   ("Athlete Own") varken** o aktif kalır.
3. Sporcu 1. sürümün kopyasını aktif yapar ve ondan **bir antrenman başlatır** ("Starting plan: Push
   Day"); antrenman açık kalır.
4. Koç taslakta bir reçeteyi değiştirir (Max reps 8 → 12), önizler ve **2. sürümü** yayımlar
   (1. sürüm "Accepted", 2. sürüm "Waiting for answer").
5. Sporcu 2. sürümü okur ("kopyan aktif; bunu eklersen yenisi aktif olur, eskisi kapatılır, silinmez"
   açıklaması ve yeni 6–12 tekrar reçetesi görünür), ekler ("Added, and it is now your active
   program…"); Programs sekmesinde iki "Coach Base" kopyası ve "Athlete Own" listelenir, yalnız yenisi
   aktif.
6. Sporcu açık kalan antrenmanı sürdürür, 3 set girer ve bitirir; sonra **aktif (2. sürüm) kopyadan**
   ikinci bir antrenman başlatıp bitirir.

Akıştan sonra script **bağımsız, salt okunur veritabanı kanıtı** toplar (native UI kanıtı **değildir**;
uygulama reçetenin içeriğini antrenman ekranında göstermediği için burada gerekir): ilk antrenmanın
saklı başlangıç planı hâlâ 8 max tekrar, ikincisininki 12; yayımlanmış sürümler değişmemiş (1: 8,
2: 12, ikisi de kabul edilmiş, yalnız 2. sürüm aktif bir kopyanın yerini almış); iki ayrı kopya var;
sporcunun programları: kendi programı (pasif), 1. sürüm kopyası (pasif, hâlâ 8), 2. sürüm kopyası
(tek aktif, 12).

Native'de **denenmeyenler:** reddetme, "superseded" (yerine yenisi gelmiş) sürümü açıp yanıtlamaya
çalışma, eski önizlemeyle gönderme, sürüm çakışması ve **2. sürüm gelirken sporcunun başka bir
programının aktif olması** (1. sürümdeki "başka program aktif" durumu native'dir). Bunlar backend
testleriyle ve mobil store testleriyle kapsanır. Her iki kopya da "Coach Base" adını taşır; ayırt
eden tek şey "Active program" etiketidir (ürün gözlemi, değiştirilmedi).

### "Neden gelişemiyorum?" ve günlük check-in akışı (native)

`e2e/scripts/diagnosis.sh` (önce `up.sh`) aynı izole yığında üç geçici hesapla
`e2e/flows/diagnosis-checkin.yaml`'ı çalıştırır: **EMPTY** (hiç kayıt yok) değerlendirmeyi görür,
bağımsız günlük check-in'i açıp uyku/enerji kaydeder ve yenilenen değerlendirmeye döner;
**HISTORY** (dört tamamlanmış hafta antrenman, beş gece uyku, 19 güne yayılan dört tartı, bulk
hedefi) dönemi 4 → 8 → 12 haftaya çevirir ve bir eylemle mevcut bir ekrana gider;
**FRESH** mevcut antrenman öncesi check-in'in antrenmanı hâlâ başlattığını gösterir. Script ayrıca
akıştan sonra API ile EMPTY hesabında **sıfır antrenman** olduğunu, kaydedilen uyku/enerjinin
yerinde durduğunu ve FRESH hesabında tam bir antrenman başladığını doğrular. Geçmiş kayıtlar
gerçek hafta beklenmeden kurulur: hesaplar, hedef ve geçmiş antrenmanlar API ile; geçmiş tarihli
uyku/tartı satırları (API yalnız bugünü yazar) kimliği doğrulanmış E2E veritabanına SQL ile
eklenir. Elle kontrol gerektiren, native'de denenmeyen durumlar (gün değişimi, gecikmeli
yanıtlar, hesap değişimi) `tests/daily-checkin.test.cjs` ve backend testlerindedir.

### Hesap silme (native)

`e2e/scripts/deletion.sh` (önce `up.sh`) aynı izole yığında üç geçici hesap kurar: silinecek **COACH**
(bağlı sporcusu, sporcunun kabul ettiği programı ve kendi antrenmanıyla), **ATHLETE** ve ilgisiz bir
**BYSTANDER**. `e2e/flows/account-deletion.yaml` gerçek dokunuşlarla şunları yapar: Profile > Delete
account > **Cancel** (hiçbir şey olmaz) > boş parola (cihazda reddedilir) > **yanlış parola** (sunucu
reddeder, oturum ve ekran kalır) > doğru parola ile **"Keep my account"** (silmeden çıkar) > doğru
parola + son onay > giriş ekranında "Your account has been deleted." > uygulamayı kapatıp yeniden
açma: **oturum kapalı kalır**. Akıştan sonra script API ve veritabanıyla bağımsız kanıt toplar:
eski kimlik bilgileri ve eski access token reddedilir; silinen hesabı adlandıran **hiçbir satır**
hiçbir tabloda kalmaz; sporcunun kabul ettiği kopya (ve içeriği), antrenmanı ve oturumu yerinde durur;
koçla bağlantısı kalmaz; ilgisiz hesap etkilenmez; egzersiz kataloğunun satır sayıları değişmez.
Hesap silme **geri alınamaz**; test yalnızca bu koşu için üretilmiş hesapları siler.

Native'de **denenmeyenler:** ağ kopması/zaman aşımı, hız sınırı (429) ve sunucu hatası yanıtları,
silme sürerken hesap değişimi ve gecikmiş yanıtlar. Bunlar `tests/account-deletion.test.cjs`
(gerçek token deposu, API istemcisi ve oturum denetleyicisi; yalnız Keychain ve ağ sahte) ve backend
testleriyle kapsanır.

### Koç–sporcu izin ve geri bildirim akışı (native)

`e2e/scripts/coaching.sh` (önce `up.sh`) yeni bir koç ("Colt") ve sporcu ("Avery") kurar; sporcunun
bilinen değerli **bitmiş** bir antrenmanı ("Avery Push Fixture": ısınma 40×10, 80×8 RIR 2, 82,5×6
RIR 1) ve **bitmemiş** bir antrenmanı ("Avery Open Session") vardır. Bağlantının kendisi dahil her
şey `e2e/flows/coaching-permissions.yaml` ile ekranda yapılır; davet kodu Maestro içinde kopyala/
yapıştır ile koçun ekranından sporcunun alanına gider, script onu dosyaya yazmaz ve artifact'lar
sonradan temizlenir (sonda "kod/parola kalan metin dosyası: 0" yazar). Tek simülatör, hesaplar
sırayla: **eşzamanlı iki cihaz testi değildir** ve aynı anda iptal edilen oturumlar bu akışla
doğrulanmaz.

Akış: koç davet üretir → sporcu önizler (kimden geldiği görünür) ve açıkça kabul eder → paylaşım
**kapalı** başlar; koç "unavailable" görür, bitmiş ve bitmemiş antrenman adı, sayı, "Latest" gibi
hiçbir özel bilgi görünmez → sporcu paylaşımı (onay isteyen) açar → koç doğru bitmiş antrenmanı salt
okunur setleriyle görür, bitmemiş antrenman listede yoktur, düzenleme/silme/"Log set" kontrolü yoktur
→ koç **geri bildirim yazar** (kaydetmeden önce onay) → sporcu kendi antrenmanında "Coach feedback"
kartında okur (yazar adı/kullanıcı adı, "Written …"; antrenman kaydından ayrı) → koç **düzenler**
(metnin sonuna ek cümle) → sporcu yeniler ve düzenlemeyi ("Edited …") görür → sporcu paylaşımı kapatır
→ koç normal gezinmeyle yeniden girince erişim ve özetler yoktur, **sporcu aldığı geri bildirimi
korur** → koç bağlantıyı onayla bitirir → sporcu tarafında koç yok, geri bildirim yine duruyor.

Akıştan sonra script **bağımsız kanıt** toplar (native UI kanıtı değildir): veritabanında tek bağlantı ve
bitmiş; paylaşım kapalı; tek geri bildirim satırı, sürüm 2, saklanan metin yazılanla **birebir**; bitmemiş
antrenman hâlâ bitmemiş ve geri bildirimsiz; API'de sporcu geri bildirimi bağlantı bittikten sonra da okur
ve yazar yalnız ad/kullanıcı adıyla görünür (e-posta, parola, hash yok); koç listede sporcuyu görmez,
antrenman listesi/detayı/geri bildirimi için `404` alır, geri bildirimi düzenleyemez/silemez/yenisini
ekleyemez (`404`); sporcu koç uçlarını kullanamaz; bu çağrıların hiçbiri geri bildirimi değiştirmemiştir.

Bu akışla bulunup **düzeltilen gerçek hatalar** (ekran görüntüsü incelemesiyle; erişilebilirlik
ağacında "görünür" olmak engelsiz olmak demek değildir): (1) davet önizlemesinde klavye "Connect"
kararını örtüyordu → önizleme gelince klavye kapanır; (2) geri bildirim yazarken Save/Cancel/karakter
sayacı klavyenin altında kalıyordu → klavye açılınca ve içerik büyüyünce form sona kaydırılır;
(3) Training ekranındaki **"Start from a template" sayfasında** üst `Pressable` erişilebilir öğe
olduğundan tüm sayfa tek öğe ("Start from a template, Program, Şablon") oluyor, şablonlar tek tek
seçilemiyordu (VoiceOver ve Maestro) → iki kapsayıcı `accessible={false}`, her şablon satırı kendi
`accessibilityLabel`'ına sahip. Aynı kalıp `workout/[id].tsx` içindeki "Save as template" sayfasında da
var; orada **yeniden üretilmedi, dokunulmadı** (açık iş).

Native'de **denenmeyenler:** sürüm çakışması (409) ve "Keep my text and review" / "Use the latest"
akışı (yalnız backend ve mobil store testleri), sınır uzunluğunda (2000) metin, silme, ağ kopması,
yazarlar arası izolasyonun ekranda gösterimi (yalnız bağımsız API/DB kontrolü ve backend testleri),
fiziksel cihaz, VoiceOver, Dynamic Type.

### Parola kurtarma (native)

`e2e/scripts/recovery.sh` (önce `up.sh`; yığın artık yerel bir **test SMTP kutusu** da içerir:
`127.0.0.1:8125` HTTP, backend ona `SMTP_SECURITY=none` ile bağlanır, dışarıya hiçbir şey
gitmez) iki geçici hesap kurar: parolasını "unutan" **FORGETFUL** (iki cihazda oturum açmış) ve
ilgisiz bir **BYSTANDER**. `e2e/flows/password-recovery.yaml` gerçek dokunuşlarla şunları yapar:
Forgot password? > boş adres (cihazda reddedilir) > adres > "If an account exists..." (hesabın
varlığı hakkında bir şey söylemez) > eşleşmeyen tekrar uyarısı > **yanlış kod** (reddedilir, form
korunur) > kutudan okunan **gerçek kod** (`flows/helpers/read-recovery-code.js`, kutunun HTTP
API'si; üretim koduna test kancası yok) > yeni parola > "Password updated" > giriş ekranında
"Your password was changed" bildirimi > **eski parola reddedilir** > yeni parola ile giriş.
Akıştan sonra script API, veritabanı ve kutuyla bağımsız kanıt toplar: kod e-postası ve **tek**
"parola değişti" bildirimi gelmiştir; bildirim parolayı/kodu içermez; başkasına e-posta gitmemiştir;
iki cihazın eski access ve refresh token'ları reddedilir; kullanılmış kod tekrar denenince reddedilir
ve hiçbir şeyi değiştirmez; hesabı olmayan adres, hesabı olan (henüz istek almamış) bir adresle
**aynı durum ve gövdeyi** alır (taze istekte `202`, bekleme süresi içinde `429`) ve ona e-posta
gitmez; ilgisiz hesap hâlâ kendi parolasıyla girer, token'ı geçerlidir ve `credential_version`'ı
değişmemiştir.

Klavye notları (akış bunlara göre yazıldı): sayı tuş takımında dönüş tuşu yoktur ve `hideKeyboard`
onu kapatamaz; kod girildikten sonra ekran başlığına dokunmak klavyeyi kapatır. **Tekrar alanı**
(Confirm new password) klavye yeni parola alanındayken klavyenin altında kalır (iOS'ta olağan
davranış); akış iki yolu da dener: (a) formu elle **sürükleme** (`keyboardDismissMode="on-drag"`:
klavye kapanır, alan tamamen görünür olur, doğrudan dokunulup yazılır; yazılanın o alana girdiği
"eşleşmiyor" satırından kanıtlanır) ve (b) yeni parola alanındaki **Next** tuşu. Bu bir hata değil,
davranış olarak belgelendi; düzeltme gerekmedi. Not: iOS güvenli alanı yeniden odaklanınca ilk tuşta
içeriği siler, bu yüzden akış tekrar alanına yazdıktan sonra parolayı baştan yazar. Betik her koşuda
yeni hesaplar üretir; yığını kapatmadan art arda çalıştırılabilir.

Native'de **denenmeyenler:** ağ kopması/zaman aşımı, 429/503 yanıtlarının ekranda görünümü, yeniden
gönderim bekleme sayacının native davranışı ve sıfırlama sürerken hesap değişimi. Bunlar
`tests/password-recovery.test.cjs` (gerçek kurtarma deposu ve oturum dönemi korumaları, sahte ağ) ve
backend testleriyle kapsanır. **Gerçek bir e-posta sağlayıcısıyla teslimat hiçbir yerde doğrulanmadı.**

## Daha fazla bilgi

- [Expo documentation](https://docs.expo.dev/)
- [Expo Router](https://docs.expo.dev/router/introduction)
