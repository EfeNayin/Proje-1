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
- Yazılım klavyesi açıkken "Log set" klavyenin arkasında kalır ve sayı
  tuş takımının "Done" tuşu da seti kaydeder (Reps alanının
  `onSubmitEditing` davranışı); akış tek set oluştuğunu `1 working sets` ile
  doğrular.
- `CI=1` ile Metro dosya izlemez: uygulama kaynağını değiştirirseniz
  `e2e/scripts/metro-restart.sh` çalıştırın.
- Metro, `NODE_OPTIONS=--dns-result-order=ipv4first` ile başlatılır; aksi
  halde yalnızca `::1`'e bağlanıp bildirimdeki 127.0.0.1 ile uyuşmaz.

## Daha fazla bilgi

- [Expo documentation](https://docs.expo.dev/)
- [Expo Router](https://docs.expo.dev/router/introduction)
