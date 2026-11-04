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
`e2e/flows/program-revisions.yaml`'ı çalıştırır: koç kendi programından sporcuya özel taslak
hazırlar, taslağın düzenleyicide alıcı bandıyla açıldığını ve etkinleştirilemediğini görür,
sunucunun önizlemesini okuyup 1. sürümü açıkça yayımlar; sporcu programı alır, kabulün etkisini
okur ve ekler (kopya pasif, mevcut aktif programı değişmez). Hesaplar ve bağlantı API ile
kurulur (fixture); hazırlama, yayımlama ve kabul ekranda yapılır. 2. sürüm, etkin kopyanın
devralınması ve çalışan antrenmanın değişmemesi native'de **değil**, canlı API ile ve backend
testleriyle doğrulanır.

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
onu kapatamaz; kod girildikten sonra ekran başlığına dokunmak klavyeyi kapatır. Klavye alttaki
alanları örter: tekrar alanına dokunmak yerine yeni parola alanındaki **Next** tuşu kullanılır.
Betik her koşuda yeni hesaplar üretir; yığını kapatmadan art arda çalıştırılabilir (koşu 9 ve 10
ayrı ayrı geçti).

Native'de **denenmeyenler:** ağ kopması/zaman aşımı, 429/503 yanıtlarının ekranda görünümü, yeniden
gönderim bekleme sayacının native davranışı ve sıfırlama sürerken hesap değişimi. Bunlar
`tests/password-recovery.test.cjs` (gerçek kurtarma deposu ve oturum dönemi korumaları, sahte ağ) ve
backend testleriyle kapsanır. **Gerçek bir e-posta sağlayıcısıyla teslimat hiçbir yerde doğrulanmadı.**

## Daha fazla bilgi

- [Expo documentation](https://docs.expo.dev/)
- [Expo Router](https://docs.expo.dev/router/introduction)
