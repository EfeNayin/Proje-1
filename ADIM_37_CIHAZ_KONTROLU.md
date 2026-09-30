# Adım 37 — Egzersiz geçmişi telefon kontrolü

Durum: **Yeni görünüm için telefon kontrolü bekliyor.** Adım 34'ün kullanıcı kabulü bu listeyi doğrulamaz.

Backend ve Expo uygulamasını son kaynakla çalıştır. Var olan antrenmanları silmeden, aynı egzersizin geçmiş çalışma setleri bulunan bir antrenmanı aç.

- [ ] `Previous session` açılınca mevcut önceki seans ve ağırlık karşılaştırması çalışıyor. `All earlier sessions` ile geçmiş açılıyor; `Hide exercise history` ile kapanıyor.
- [ ] Seanslar en yeni tarihten eskiye sıralanıyor. Her seansta tarih/saat, ad ve ilgili egzersizin ağırlık/tekrar/RIR değerleri okunuyor; uzun isimler kesilmiyor.
- [ ] kg/lb tercihi gösterime yansıyor. Boş RIR `RIR not recorded`, sıfır RIR `RIR 0` olarak ayrılıyor; sıfır ağırlıklı çalışma setleri görünüyor. Isınma ve sıfır tekrarlı setler listelenmiyor.
- [ ] 10'dan fazla uygun eski seans varsa `Load older sessions` önceki kayıtları koruyarak devamını getiriyor; art arda dokunmak kopya seans oluşturmuyor. Sonunda `All earlier sessions loaded.` görünüyor. Yeterli geçmiş yoksa bu maddeyi denenmedi olarak belirt.
- [ ] Geçmiş açıkken sunucu erişimini kesip sonraki sayfayı yüklemeyi dene: mevcut seanslar kalıyor ve hata/`Retry history` görünüyor. Bağlantı geri geldiğinde tekrar denenebiliyor.
- [ ] Geçmişi veya ana `Previous session` bölümünü kapatıp açınca liste baştan yenileniyor. Başka egzersize/antrenmana geçince önceki hareketin kayıtları görünmüyor.
- [ ] Eski bir antrenmanda yalnızca onun başlangıcından önceki kapanmış seanslar geliyor. Uygun geçmiş olmayan egzersizde hata yerine kayıt bulunmadığı açıklanıyor.
- [ ] Geçmiş açıkken ekran kaydırılabiliyor; mevcut set ekleme/düzenleme ve klavye kullanımı çalışıyor.

## Sonuç

- Cihaz / işletim sistemi:
- Expo Go sürümü:
- Deneme tarihi:
- Geçen veya denenemeyen maddeler:
- Sorun varsa işlem ve görülen sonuç:

Otomatik doğrulama: 386 backend ve 156 mobil test geçti; TypeScript, ESLint, Ruff ve mypy temiz. Bu sonuçlar fiziksel telefon yerleşim/dokunma kontrolünün yerine geçmez.
