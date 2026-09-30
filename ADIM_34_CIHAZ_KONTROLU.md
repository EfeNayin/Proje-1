# Adım 34 — Telefon kontrolü

Durum: **Telefon kontrolü kullanıcı bildirimiyle tamamlandı — 30 Eylül 2026.** Kullanıcı, “tamamdır telefonda test edildi sıradaki adıma geçelin” diyerek sonraki adıma geçilmesini istedi. Bu, kullanıcı kabul kaydıdır; Codex tarafından cihaz üzerinde yapılmış bir doğrulama değildir. Madde bazında sonuç paylaşılmadığından aşağıdaki kutular tek tek işaretlenmedi.

24 Eylül 2026'da bilgisayarda 375 backend testi ve 145 mobil test geçti; TypeScript ve ESLint temiz. iOS/Android paketleme sonuçları proje inceleme günlüğünde tutulur. Bu kontroller gerçek telefondaki klavye, dokunma, yerleşim ve Expo Go çalışma davranışının yerine geçmez.

Uygulamayı son değişikliklerle yeniden yükle. Denemeler için ayrı bir test antrenmanı kullan. Var olan gerçek antrenmanlarını silmen gerekmez.

## 1. Libreyle düzenleme

- [ ] Tercihlerde ağırlık birimini lb yap. Bir egzersize **45 lb × 8, RIR 2** kaydet.
- [ ] Seti açıp yalnızca RIR'ı **0** yap ve kaydet. Hata çıkmamalı; gösterilen ağırlık değişmemeli.
- [ ] Ağırlığı **50 lb** yapıp kaydet. Kayıt başarılı olmalı. Daha sonra kg tercihine geçildiğinde karşılığı yaklaşık **22,7 kg** görünmeli.

## 2. Boş RIR ile sıfırın ayrılması

- [ ] İki set ekle: ilkinde RIR boş, ikincisinde **0** olsun. İlk kayıt sıfırmış gibi gösterilmemeli.
- [ ] `Previous session` içinde önceki kaydın boş RIR değeri `not recorded`, sıfır değeri `RIR 0` olarak gösterilmeli. Kart başlığının altında hedef karşılaştırma metni beklenmez; Adım 35'te kaldırıldı.

## 3. Önceki seans ve ağırlık farkı

- [ ] kg tercihinde aynı egzersizi önce bir test antrenmanında **20 kg × 8, RIR 2** ile kaydet ve antrenmanı bitir.
- [ ] Yeni bir antrenmanda aynı egzersize **22,5 kg × 8, RIR 2** kaydet. `Previous session` bölümünü aç: önceki antrenmanın tarihi ve bu ortak grupta **+2,5 kg** görünmeli.
- [ ] Yeni setin RIR'ını temizle: ortak grup başka setten oluşmuyorsa ağırlık farkı kaldırılmalı, eşleşme olmadığı açıklanmalı.

## 4. Bağlantı kesilmesi ve yeniden deneme

- [ ] Antrenman ekranı yüklüyken telefonun yerel sunucuya erişimini kes; örneğin Wi-Fi'yi kapat. Tek bir yeni set gönder.
- [ ] `Set awaiting confirmation` kartı ve gönderdiğin değerler görünmeli. Yeni set ekleme ve bitirme, bekleyen kayıt çözülene kadar engellenmeli.
- [ ] Bağlantıyı geri aç ve `Retry pending set` düğmesine bas. Set bir kez görünmeli; bekleyen kart kalkmalı.
- [ ] Aynı değerlerde bilinçli olarak bir set daha ekle: bu ayrı set olmalı. Aynı içerik, yeni set eklemeyi engellememeli.

Bu deneme istek gönderilmeden önceki bağlantı kesintisini kapsar. Sunucunun kaydı tamamladığı ama yanıtın kaybolduğu özel durum ayrıca otomatik testlerle sınandı; yalnızca Wi-Fi'yi kapatıp açmak o durumu kanıtlamaz.

## 5. Bekleyen kayıtla uygulamayı yeniden açma

- [ ] Bağlantı kapalıyken bir set daha göndermeyi dene ve bekleyen kartı gör. Uygulamayı kapat; bağlantıyı geri açtıktan sonra yeniden açıp aynı antrenmana gir.
- [ ] Bekleyen egzersiz ve özgün ağırlık/tekrar/RIR bilgileri geri gelmeli. `Retry pending set` ile devam edildiğinde ikinci kopya oluşmamalı.

Expo Go geliştirme sunucusuna erişemediğinde uygulamanın JavaScript paketini yükleyemeyebilir. Bu nedenle yeniden açma kısmında önce bağlantıyı geri getir; paket yükleme sorunu ile set kaydı sorununu ayır.

## 6. Bitirme ve yerleşim

- [ ] Bekleyen set yokken antrenmanı bitir. Ana ekrana dönmeli; geçmişte kapalı seans olarak görünmeli ve aktif antrenman gibi yeniden açılmamalı.
- [ ] Bağlantısız bitirme denemesi hata göstermeli. Bağlantı geri geldikten sonra tekrar bitirmek mümkün olmalı.
- [ ] Klavye açıkken ağırlık, tekrar ve RIR alanlarına ulaşılmalı; kayıt ve yeniden deneme düğmeleri kullanılabilmeli. Önceki seans ve karşılaştırma yazıları kesilmemeli.

## Sonuç kaydı

### Ek kontrol — Adım 35 ve 36

- [ ] Tüm egzersiz kartlarında hareket adı ile `Previous session` arasında hedef, kayıt sayısı veya tekrar/RIR açıklamaları olmamalı. Önceki seans bölümü ve set girişleri kullanılabilmeli.
- [ ] kg tercihinde **20,04 kg × 8** kaydet. Ağırlık alanını boş bırakarak bir set daha ekle. lb tercihine geçip aynı antrenmanı aç: iki setin ağırlığı da aynı görünmeli (yaklaşık **44,2 lb**).
- [ ] Kaydedilmiş seti düzenle, ağırlığı tamamen sil ve kaydetmeyi dene. Ağırlık hatası görünmeli, editör açık kalmalı ve kayıt sıfıra dönüşmemeli. Bilinçli **0** yazıp kaydetmek mümkün olmalı.
- [ ] Yeni set formunda ve düzenlemede tekrar alanına **0** gir: açıklama görünmeli ve kayıt gönderilmemeli. **8** olarak düzeltince kaydetmek mümkün olmalı.

Adım 36 için Mac üzerinde 149/149 mobil test yeniden geçti; TypeScript ve sıfır uyarıyla ESLint temiz. Telefon için genel kullanıcı kabulü yukarıda kaydedildi; ayrı madde sonuçları paylaşılmadı.

### Telefon sonuçları

- Cihaz / işletim sistemi: Paylaşılmadı.
- Expo Go sürümü: Paylaşılmadı.
- Deneme tarihi: Paylaşılmadı; kullanıcı bildirimi 30 Eylül 2026 tarihinde alındı.
- Sonuç: Kullanıcı telefon testinin tamamlandığını bildirdi ve sonraki adıma geçilmesini istedi.
- Geçen maddeler: Tek tek raporlanmadı.
- Başarısız madde, yapılan işlem ve görülen sonuç: Sorun bildirilmedi.

Adım 34 kullanıcı kabulüyle kapatıldı. Bu kayıt, her senaryo için ayrı ölçüm veya iki platformda doğrulama yapıldığı iddiası taşımaz.
