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

## Daha fazla bilgi

- [Expo documentation](https://docs.expo.dev/)
- [Expo Router](https://docs.expo.dev/router/introduction)
