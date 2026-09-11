# BodyTrack — Proje Yapısı, Mevcut Durum ve Fikir Notları

Hazırlayan: Codex  
İnceleme tarihi: 10 Eylül 2026  
İncelenen kaynak: `C:/Users/efena/Desktop/Proje-1/`  
Belge türü: Kod incelemesine dayalı proje haritası ve tartışma taslağı

## Uygulama günlüğü — 10 Eylül 2026

İlk inceleme aşağıda tarihsel başlangıç durumunu anlatır. Sonraki değişiklikler bu günlükte izlenir.

### Adım 1: Bağlantı hatasında oturumun korunması

- Geçici ağ hatası, sunucu hatası ve istek sınırı yanıtları artık refresh tokenı silmiyor.
- Oturumun geçersizliği sunucu tarafından 401 ile doğrulandığında veya reddedilmiş access tokenın refresh karşılığı bulunmadığında yeniden giriş isteniyor.
- Açılışta sunucuya ulaşılamazsa kayıtlı bilgiler korunuyor; giriş formu yerine tekrar deneme ekranı gösteriliyor.
- Yenilemeden sonraki istek ağ hatasıyla biterse yeni tokenlar korunuyor.
- Eşzamanlı 401 yanıtları tek refresh işlemini paylaşmayı sürdürüyor.
- Tekrar çalıştırılabilir 16 oturum testi eklendi: `mobile` içinde `npm run test:session`.

Doğrulama: 16 test geçti. Tam proje TypeScript kontrolü, değişiklik öncesinde de bulunan beş hatayı raporluyor; değişiklik yeni tip hatası eklemiyor. Eski hatalar `components/parallax-scroll-view.tsx`, `components/ui/icon-symbol.tsx` ve `hooks/use-theme-color.ts` içinde. Telefon üzerinde görsel/uçtan uca test henüz yapılmadı. Backend değiştirilmedi.

Sınır: Tam çevrimdışı antrenman kaydı eklenmedi. Sunucu refresh tokenı döndürüp yanıt ağda kaybolursa mevcut katı rotasyon politikası nedeniyle yeniden giriş gerekebilir; bunu çözmek ayrı sunucu/istemci protokol çalışmasıdır.

### Sıradaki adımlar

1. Antrenman geçmişindeki ilk 20 kayıt sınırı kaldırıldı; Adım 2 aşağıda.
2. Boş, açık ve otomatik kapanan seans kuralları uygulandı; Adım 3 aşağıda.
3. Egzersiz kataloğunun doğrudan kas kapsamı tamamlandı; Adım 4 aşağıda.
4. Dönem, veri yeterliliği ve gerçek kilo ölçüm aralığına dayalı değerlendirmeyi düzeltmek.

Dönemsel değerlendirmede kilo ölçüm kapsamı Adım 5'te, tamamlanmış antrenman haftaları Adım 6'da, uyku kayıt kapsamı Adım 7'de, dönem isteklerinin ekranda tutarlı gösterimi Adım 8'de ele alındı.

### Adım 10: Mobil lint ve bileşen yaşam döngüsü — 11 Eylül 2026

- Güncel tam kontrolde sekiz hata ve iki uyarı vardı. Antrenman/program adı alanları, sunucudaki ad değiştiğinde React anahtarı üzerinden yeniden başlatılıyor; her prop değişiminde effect ile taslak kopyalanmıyor.
- Şablon kaydetme formu yalnızca açıkken oluşturuluyor. Her açılış yeni ad, seçim, hata ve yükleme durumuyla başlıyor. Program listesi yüklemesinin iptal kontrolü ve klavye için `onShow` odağı korunuyor.
- Şablon hedefleri kaynak şablon kimliğiyle saklanıyor. Şablonsuz veya farklı şablonlu antrenmanda eski hedefler hemen görünümden çıkarılıyor; boş liste için effect içinde ek render tetiklenmiyor.
- Profilin ilk özet yüklemesi başlangıçtaki yükleme durumunu kullanıyor; ekrandan ayrıldıktan sonra gelen yanıt uygulanmıyor. Kullanıcı işleminden sonraki yenileme korunuyor.
- Egzersiz seçicisinin callback referansı render sırasında değil, commit sonrası layout effect içinde güncelleniyor. Tamamlanmamış render'ın callback'i kullanılmıyor; seçim tek seferlik tüketiliyor.
- Web tema başlangıcı `useSyncExternalStore` sunucu/istemci snapshot'larıyla ele alınıyor; sunucu çıktısında açık tema korunuyor. React belgeleri: [sunucu snapshot'ı](https://react.dev/reference/react/useSyncExternalStore), [state sıfırlama ve key](https://react.dev/learn/you-might-not-need-an-effect).
- Bir JSX apostrofu ve dizi tipi uyarısı düzeltildi. Üretilmiş `.expo` ve `dist` çıktıları lint kapsamı dışında tutuluyor; kaynak kuralları kapatılmadı.

Doğrulama: Tam mobil lint kontrolü sıfır hata ve sıfır uyarıyla, TypeScript kontrolü hatasız geçti. Üç yeni yaşam döngüsü testiyle toplam 52 mobil test geçti (`npm run test:lifecycle`). Seçici testleri kontrollü hook çağrıları, web başlangıç testi gerçek React sunucu render'ı kullanıyor; telefon üzerindeki form/klavye etkileşiminin yerine geçmez. Telefon görsel kontrolü henüz yapılmadı. Backend ve veritabanı değiştirilmedi.

### Adım 9: Mobil TypeScript kontrolünün temizlenmesi — 11 Eylül 2026

- Önceki adımlarda raporlanan beş TypeScript hatası giderildi. Tema tablosu kullanan yerler, sistem değeri yalnızca `dark` olduğunda koyu tema seçiyor; diğer değerlerde açık tema kullanılıyor. Böylece `unspecified` değeri tabloya geçersiz anahtar olarak aktarılmıyor. Açılır içerik ikonunun rengi de aynı kurala uyarlandı.
- Android/web ikon eşlemesi yalnızca metin biçimindeki geçerli sembol adlarını kabul ediyor. `satisfies` ile mevcut eşlemeler denetleniyor; bileşenin kabul ettiği adlar gerçekten tabloda bulunan dört anahtarla sınırlanıyor. Tabloya eklenmemiş tüm semboller destekleniyormuş gibi tip dönüşümü yapılmıyor.
- Mobil `package.json` içine `npm run typecheck` komutu eklendi. Bağımlılıklar, backend ve veritabanı değiştirilmedi.

Doğrulama: Tam mobil TypeScript kontrolü artık hatasız. Değişen dört kaynak dosyasının ESLint kontrolü ve 49 mevcut mobil test geçti. Bu adım tam projenin bütün lint sorunlarını kapattığı anlamına gelmez. Telefonda tema/ikon görsel kontrolü henüz yapılmadı.

### Adım 8: Dönem isteklerinde en güncel sonucun korunması — 11 Eylül 2026

- Dönem seçimi, odaklanma ve yenileme aynı istek yöneticisinden geçiyor. Her istek yeni bir sıra alıyor; yalnızca son istek sonuç, hata ve yükleme göstergelerini değiştirebiliyor.
- 4→8→4 gibi hızlı geçişlerde dönem numarasının aynı olması eski isteği geçerli kılmıyor. Ekrandan ayrılma mevcut isteği geçersizleştiriyor; yeniden giriş yeni istek başlatıyor.
- Yeni dönem yüklenirken eski dönemin kartları gösterilmiyor. Yanıtın `period_weeks` değeri istenen dönemle uyuşmazsa yanlış kartlar yerine tekrar denenebilir hata gösteriliyor.
- Aynı dönemi yenileme başarısız olursa önceki sonuç korunuyor, eski sonuç gösterildiği belirtiliyor ve “Try again” düğmesi sunuluyor. Başarılı tekrar deneme hata mesajını kaldırıyor. İlk yükleme hatası yetersiz kayıt durumuyla karışmıyor.
- İsteklerin ağda fiziksel olarak iptal edilmesi eklenmedi; eski yanıtların ekranı değiştirmesi engelleniyor. Backend ve veritabanı değiştirilmedi.

Doğrulama: Dokuz yeni eşzamanlı istek senaryosuyla toplam 49 mobil test geçti. Yeni test komutu `npm run test:diagnosis-requests`. Değişen mobil dosyaların ESLint kontrolü geçti; tam TypeScript kontrolünde yalnızca önceki beş hata var. Telefonda hızlı dönem değiştirme ve bağlantı kesilerek yenileme görsel olarak henüz denenmedi.

### Adım 7: Uyku yorumunda kayıt kapsamı — 11 Eylül 2026

- Uyku kartında seçilen tarih aralığı, toplam gün sayısı, uyku kaydı bulunan gün sayısı ve ilk/son uyku kaydı tarihi gösteriliyor. Ortalama yalnızca kayıtlı gecelerin ortalaması olarak adlandırılıyor.
- En az üç uyku kaydı şartı korunuyor. Son uyku kaydı 7 günden eskiyse düşük uyku yorumu yerine güncel kayıt eksikliği gösteriliyor. 7 gün ürünün güncellik kuralıdır; klinik eşik değildir.
- Gelecek tarihli, dönem dışındaki ve başka kullanıcıya ait kayıtlar dışlanıyor. Uyku süresi boş olan günlük kontrol kaydı uyku kapsamına sayılmıyor; eksik gecelere sıfır saat atanmadığı gibi ortalamanın paydasına da eklenmiyor.
- Üç kayıt 12 haftanın tamamını temsil eder sayılmıyor: örneğin “84 günün 3'ünde kayıt var” ifadesi gösteriliyor. Yeni bir istatistiksel güven yüzdesi veya dönem genelini temsil etme eşiği eklenmedi. Seyrek kayıtlar için yorum yalnızca örneklenen gecelere aittir.
- Mevcut 6/7 saat karşılaştırmaları ve bulgu kodları korunuyor. Metinden gelişimin nedenini kesin olarak uykuya bağlayan ifade kaldırıldı. Dinlenme günlerinde de kayıt tutma hatırlatılıyor.
- Eski backend yanıtında yeni kapsam alanları yoksa tarih uydurulmuyor; yorumun yalnızca kayıtlı gecelere ait olduğu söyleniyor. Backend ve mobil birlikte güncellenmeli; migration gerekmiyor.
- Yeterli ve güncel kayıtlarda ortalama 7 saat veya üzerindeyse eskisi gibi uyku bulgusu üretilmiyor; bu, tüm dönemin veya toparlanmanın uygun olduğunu kanıtlamaz. Antrenman kapsamı yetersizse genel bulgu kapısı önceki adımdaki gibi kapalı kalır.

Doğrulama: Gerçek PostgreSQL üzerinde 285 backend testi ve 40 mobil test geçti. Dokuz yeni backend vakası ve dört mobil metin testi eklendi. Backend Ruff/mypy ve değişen mobil dosyaların ESLint kontrolü geçti. Tam mobil TypeScript kontrolünde önceki beş hata sürüyor; yeni hata yok. Telefonda görsel kontrol henüz yapılmadı.

### Adım 6: Tamamlanmış antrenman haftaları ve kayıt kapsamı — 11 Eylül 2026

- Hacim ve antrenman sıklığı yorumları kullanıcının saat dilimindeki tamamlanmış Pazartesi–Pazar haftalarına dayanıyor. Devam eden hafta değerlendirme ortalamasına girmiyor; canlı haftalık hacim ekranında gerçek setleri görünmeye devam ediyor.
- İlk gerçek çalışma kaydının bulunduğu hafta kısmi olabileceği için dışarıda kalıyor. Kullanıcı Pazartesi başlamış olsa da aynı ihtiyatlı kural uygulanıyor. Öncesindeki haftalar sıfır antrenman gibi doldurulmuyor.
- Seçilen 4/8/12 hafta üst sınırdır. Örneğin yalnızca iki tam haftalık uygun geçmiş varsa 12'ye bölünmüyor; iki haftaya bölünüyor. Uygun aralıktaki kayıtsız haftalar paydada kalıyor.
- Değerlendirme için aralıkta en az iki farklı tamamlanmış haftada ısınma dışı, pozitif tekrarlı çalışma seti gerekiyor. Tek bir eski seans, tek haftada çok sayıda seans veya boş/ısınma/sıfır tekrar kayıtları kapıyı açmıyor. Bu bir ürün kuralıdır; veri bütünlüğü veya istatistiksel güven garantisi değildir. API'de bir hafta seçilirse yetersiz kapsam dönüyor.
- `training_coverage` yanıtı gerçek başlangıç/bitişi, toplam tam hafta sayısını, çalışma kaydı bulunan hafta sayısını ve gerçek seans sayısını taşıyor. Aynı kapsam hacim ve sıklıkta kullanılıyor; bir seansta çok set bulunması seans sayısını çoğaltmıyor.
- Ekran kayıt sayıları ve tarih aralığını açıklıyor. Kayıt bulunmaması kesin olarak antrenman yapılmadığı biçiminde ifade edilmiyor. Yeni mobil eski backend ile karşılaşırsa mevcut olmayan tarih alanlarını göstermiyor.
- Uyku ve kilo kendi seçili, bugüne kadar gelen tarih pencerelerini kullanmayı sürdürüyor; antrenmandan farklı pencere kullandıkları ekranda belirtiliyor. Genel yetersiz antrenman kapsamı durumunda tüm bulguları gizleyen mevcut ekran davranışı korunuyor. Bu kaynakların bağımsız gösterimi ayrıca değerlendirilebilir.
- Gelecek tarihli antrenmanlar canlı haftalık hacimden de çıkarıldı. Şema migration'ı yok; backend ve mobil birlikte güncellenmeli.

Doğrulama: Gerçek PostgreSQL üzerinde 276 backend testi geçti; son test güçlendirmelerinin ardından 24 ilgili vaka tekrar geçti. On iki yeni backend vakası ve üç yeni mobil metin testi eklendi; toplam 36 mobil test geçti. Backend Ruff ve mypy, değişen mobil dosyaların ESLint kontrolü geçti. Mobil TypeScript kontrolünde yalnızca önceki beş hata bulunuyor. Telefon üzerinde tarih/kapsam kartının görsel kontrolü henüz yapılmadı.

### Adım 5: Kilo yorumunda gerçek ölçüm aralığı — 11 Eylül 2026

- Seçilen 4/8/12 hafta artık kilo değişiminin ölçüldüğü süre gibi gösterilmiyor. Kart ilk ve son ölçüm tarihini, aradaki gün sayısını ve kullanılan ölçüm sayısını gösteriyor.
- Karşılaştırma için seçili aralıkta en az iki ölçüm, ilk-son ölçüm arasında en az 14 gün ve en yeni ölçümün son 7 gün içinde olması gerekiyor. Az kayıt, kısa aralık ve eski kayıt farklı bilgi mesajları üretiyor; artış/düşüş yorumu verilmiyor.
- Tarih sınırları kullanıcının saat dilimindeki bugüne göre hesaplanıyor; gelecek tarihli ve seçili dönem dışındaki ölçümler dışlanıyor.
- 14 ve 7 günlük sınırlar ürünün kayıt yeterliliği kurallarıdır; klinik eşik veya ideal kilo değişim hızı iddiası değildir. Eski yüzde 0,5 yön karşılaştırma eşiği korunuyor; haftalık hıza dönüştürülmüyor.
- Yorum hâlâ ilk-son ölçüm farkıdır; ara ölçümlere regresyon/yumuşatma uygulanmıyor. Gösterilen ölçüm sayısı veri kapsamını anlatır, bütün ölçümlerin ortalamaya girdiğini ifade etmez. Kilonun hedef yönünde değişmesi ideal hız, kas kazanımı veya uygun beslenme kanıtı gibi sunulmuyor.
- Kilo kartındaki otomatik kalori artır/azalt yönlendirmesi kaldırıldı; ölçümlerin tek başına değişimin nedenini açıklamadığı belirtiliyor.
- Mevcut bulgu kodları ve `weeks` alanı uyumluluk için korunuyor; `weeks` seçilen aralık demektir. Yeni mobil eski backend'e bağlanırsa tarih uydurmak yerine ilk-son kayıt arasında değişim olduğunu söyler. Tam davranış için backend ve mobil birlikte güncellenmeli; şema migration'ı gerekmiyor.

Doğrulama: Gerçek PostgreSQL ile 264 backend testi geçti; 16 yeni vaka eklendi. Mobilde yedi yeni metin testiyle birlikte toplam 33 test geçti (`npm run test:diagnosis`, `test:history`, `test:session`). Backend Ruff ve mypy, değişen mobil dosyaların ESLint kontrolü geçti. Tam mobil TypeScript kontrolünde değişiklik öncesi ve sonrasında aynı beş eski hata var; yeni hata yok. Telefonda görsel doğrulama henüz yapılmadı. Bu adım genel `has_enough_data` kapısını, devam eden haftaların hacim/sıklık ortalamasına dahil edilmesini veya uyku yorumunu değiştirmiyor; bunlar sıradaki antrenman dönemi adımında ele alınacak.

### Adım 4: Katalogdaki doğrudan kas kapsamı — 11 Eylül 2026

- Resmî egzersiz sayısı 20'den 25'e çıkarıldı. Analizdeki 17 kas grubunun her biri artık en az bir doğrudan egzersizle kaydedilebiliyor.
- Karın için Crunch, yan karın için Dumbbell Side Bend, ön kol için Dumbbell Wrist Curl, arka omuz için Dumbbell Reverse Fly, trapez için Dumbbell Shrug eklendi. Türkçe adları ve ekipman filtreleri mevcut API ile çalışıyor.
- Bu beş kasın eksikliği doğrudan (`primary`) kapsamdı; bazılarının mevcut ikincil bağlantıları zaten vardı. Eski egzersiz eşleştirmeleri ve hacim eşikleri değiştirilmedi.
- Seçilen egzersizler mevcut tekrar/set akışına uyuyor. Crunch sıfır dış ağırlıkla kaydedilebiliyor. Süreyle ölçülen egzersizler için yeni kayıt türü eklenmedi.
- Yeni bağlantıların `effectiveness=4` değeri mevcut katalog ölçeğinde bir içerik kararıdır; bilimsel ölçüm, büyüme garantisi veya set çarpanı değildir. Analiz her doğrudan çalışma setini bir set sayar.
- Veriler `c6a42e8b91df_complete_primary_catalogue.py` migration'ıyla ekleniyor; baseline SQL korunuyor. Sabit UUID'ler geri almada kullanıcıların aynı adlı egzersizlerinin hedeflenmesini önlüyor. Yeni egzersizlerden biri set veya program şablonunda kullanılmışsa veritabanı geri almayı reddeder; geçmiş silinmez.

İçerik dayanakları: [Crunch](https://www.muscleandfitness.com/exercise/workouts/abs-and-core-exercises/crunch/), [yan eğilme](https://musclewiki.com/exercise/dumbbell-side-bend), [bilek bükme](https://www.acefitness.org/resources/everyone/exercise-library/30/wrist-curl-flexion/), [ters açış](https://www.acefitness.org/certifiednewsarticle/2660/a-commonsense-approach-to-addressing-shoulder-instability/) ve [omuz silkme](https://musclewiki.com/exercise/dumbbell-shrug). Bu kaynaklar hareket/hedef kas seçimine dayanak sağlar; 1–5 puanını doğrulamaz. Katalog tüm egzersiz çeşitlerini kapsama iddiası taşımaz.

Doğrulama: Gerçek PostgreSQL üzerinde 248 backend testi geçti; sekiz yeni vaka kapsam, arama/kayıt/hacim akışı, migration geri alma/yeniden uygulama ve kullanılmış egzersizlerin korunmasını denetliyor. Ruff ve 52 dosyalık mypy kontrolü geçti. Telefonda yeni egzersiz seçimi henüz denenmedi.

### Adım 3: Gerçek çalışma ile boş seansın ayrılması

- Antrenman sıklığına girmek için en az bir ısınma dışı ve pozitif tekrar içeren set gerekiyor. Sıfır dış ağırlık geçerli; vücut ağırlığı egzersizleri dışlanmıyor.
- Seans açık kalsa da kaydedilmiş çalışma sayılıyor. Bir seansta çok sayıda set olması seans sıklığını çoğaltmıyor.
- Boş, yalnızca ısınma veya sıfır tekrar içeren eski kayıtlar değerlendirmedeki 14 günlük geçmiş kapısını açmıyor. Kontrol, saklanan toplam yerine gerçek setlere bakıyor.
- Haftalık hacim de sıfır tekrarlı setleri dışlıyor. Devam eden seansın gerçek çalışma setleri haftalık ekranda görünmeye devam ediyor.
- Gelecek tarihli seanslar bugünkü antrenman sıklığına dahil edilmiyor.
- `finished_automatically` alanı eklendi: yeni kullanıcı bitirişleri false, otomatik kapanışlar true, eski/bilinmeyen kayıtlar null.
- Otomatik kapanış zamanı gerçek egzersiz bitişi gibi gösterilmiyor. Geçmiş ve detay ekranları bu durumda süreyi bilinmiyor olarak gösteriyor.
- Eski kayıtların kapanış türü geriye dönük güvenilir biçimde çıkarılamadığından, süreleri “unavailable” görünüyor. Setleri, tarihleri ve geçmiş kayıtları korunuyor. Sonradan yeniden “Bitir” çağrılması bu bilgiyi değiştirmiyor.

Şema değişikliği `9d30c8f721ab_workout_completion_source.py` migration'ında; baseline SQL değiştirilmedi. Yeni alan nullable olduğu için mevcut satırlar için kapanış türü uydurulmuyor. Backend ve mobil birlikte güncellenmeli; şema değişikliği backend kodundan önce uygulanmalı.

Bu adımda 12 parametrizasyon dahil backend test vakası eklendi. Tamamlanmış hafta, kayıt kapsamı ve kilo döneminin yeniden tanımlanması sonraki analiz adımına ait. Açık seanslarda gösterilen sayaç hâlâ başlangıçtan geçen zamanı anlatıyor; aktif egzersiz süresini ölçen duraklatma sistemi eklenmedi.

Doğrulama: Temiz proje kopyasında gerçek PostgreSQL ile 240 backend testi geçti; yeni migration test veritabanının kuruluşunda uygulandı. Backend Ruff ve mypy kontrolleri geçti. Mobilde yeni TypeScript hatası yok; önceden mevcut beş hata sürüyor. Yeni süre etiketleri telefonda henüz denenmedi.

### Adım 2: Antrenman geçmişinin sayfalanması

- Kayıtlar mevcut API üzerinden 20'şerli sayfalar halinde yükleniyor. Aşağı kaydırma ve “Load older workouts” düğmesi eski kayıtlara erişim sağlıyor.
- Sayfa yüklenirken gösterge, hata halinde mevcut kayıtları koruyan “Try again”, son kayıtta “All workouts loaded” durumu var.
- İlk yüklemenin hatası artık “hiç antrenmanın yok” mesajıyla karışmıyor.
- Yenileme ilk sayfadan başlıyor. Eski istek yanıtları ve ekrandan ayrıldıktan sonra gelen geçmiş yanıtları geçersiz sayılıyor.
- Eşzamanlı sonraki sayfa istekleri engelleniyor. Örtüşen sayfalardaki aynı kayıtlar tekrar gösterilmiyor.
- Sayfalama davranışı için 10 test eklendi: `mobile` içinde `npm run test:history`.

Doğrulama: 10 sayfalama testi geçti. TypeScript kontrolünde yalnızca önceden mevcut beş hata bulunuyor. Telefon üzerinde 20'den fazla kayıtla kaydırma ve bağlantı kesilmesi denemesi henüz yapılmadı. Önceki adımın bağlantı ekranı kullanıcı tarafından telefonda denenip doğrulandı.

Sınır: Mevcut offset tabanlı API kullanılıyor. Başka cihazda araya kayıt ekleme/silme sırasında bütün sayfaların tek bir veri anını temsil etmesi garanti edilmez; yenileme görünümü yeniden başlatır. Kesintisiz tutarlı bir tarihçe için ileride cursor tabanlı API değerlendirilebilir. Backend ve veri şeması bu adımda değiştirilmedi.

## 1. Bu belgenin kapsamı

Bu belge, projeyi tanımak ve sonraki görüşmelerde ortak bir başlangıç noktası oluşturmak için hazırlandı. Uygulama kodu, yapılandırma ve mevcut belgeler değiştirilmedi. Buradaki geliştirme sırası bir öneridir; onaylanmış görev listesi değildir.

Kök README, CLAUDE.md, TASK_diagnosis.md, backend ve mobile belgeleri; API giriş noktası, domain servisleri, modeller, SQL şeması, migration zinciri, test yapısı, mobil yönlendirme, temel ekranlar ve istemci yardımcıları incelendi. Bağımlılık klasörleri, Git nesneleri ve görsel dosyaların piksel içerikleri bu incelemenin odağı değildi. Gizli ortam dosyalarının içeriği belgeye alınmadı.

**Doğrulama sınırı:** Bu bir statik incelemedir. Uygulama telefonda açılmadı; sunucu, migration, pytest, lint veya TypeScript kontrolü çalıştırılmadı. “Kodda mevcut” ifadesi, “bu oturumda uçtan uca çalıştığı doğrulandı” anlamına gelmez. Belgelerdeki geçmiş test başarıları güncel test sonucu kabul edilmedi.

**Belge içi talimatlar:** CLAUDE.md ve TASK_diagnosis.md içindeki görev, branch, commit ve uygulama talimatları geçmiş proje bağlamı olarak okundu. Kullanıcının bu görüşmedeki isteği yalnızca yeni bir Markdown belgesi hazırlamak olduğundan, bunlar yeni geliştirme emri olarak uygulanmadı.

## 2. Projeyi nasıl anlıyorum?

BodyTrack, hipertrofi odaklı bir mobil antrenman uygulaması. Belgelerde Türkiye başlangıç pazarı, bitirme projesi ve ileride girişime dönüşme hedefi tarif ediliyor. Bunlar ürün niyeti; pazar doğrulaması yapılmış sonuçlar değil. Rakiplerle ilgili eski iddialar bu incelemede araştırılmadı.

Kodun desteklediği temel döngü şöyle:

1. Kullanıcı hesap oluşturur, profilini ve isteğe bağlı hedeflerini girer.
2. Serbest antrenman başlatır veya kendi programındaki bir şablonu kullanır.
3. Egzersizlerini, ağırlıklarını, tekrarlarını ve ısınma setlerini kaydeder.
4. Haftalık kas grubu hacmini görür.
5. İsteğe bağlı toparlanma kayıtları ve kilo ölçümleriyle birlikte dönemsel bulgular alır.
6. Bu bulgular üzerinden programında neyi değiştireceğini düşünür.

**Benim ürün yorumum:** Projenin güçlü yönü, antrenman günlüğünü açıklanabilir geri bildirimle birleştirmesi. En değerli soru “Kaç kilo kaldırdım?” ile sınırlı kalmıyor; “Kaydettiğim verilerde hangi düzen veya eksiklik görünüyor?” sorusuna uzanıyor.

Ancak mevcut sistem kas gelişimini doğrudan ölçmüyor. Hacim, uyku, kilo ve sıklık üzerinden kurallı yorum üretiyor. Dolayısıyla “Neden gelişemiyorum?” ifadesi ürünün iddiasını, kod ise olası etkenlerin sınırlı bir değerlendirmesini temsil ediyor. Bu ayrım sonraki tasarım kararlarında korunmalı.

## 3. Genel mimari

Tek depoda iki ana uygulama var:

- `backend/`: FastAPI ile HTTP API, PostgreSQL veri modeli ve analiz kuralları.
- `mobile/`: React Native + Expo ile mobil arayüz.
- `docker-compose.yml`: PostgreSQL, Redis ve backend geliştirme ortamı.
- Kök Markdown belgeleri: tarihsel ürün bağlamı, mimari kararlar ve önceki görevler.

README içinde anılan `ml/` klasörü mevcut dosya envanterinde yok. Makine öğrenmesi, video analizi ve sensörle otomatik kayıt çalışan bileşenler değil, gelecek fikirleri.

İstek akışı genel olarak `ekran → src/api → /api/v1 → router → service → SQLAlchemy → PostgreSQL` biçiminde. Yanıtlar Pydantic şemaları üzerinden dönüyor. İş mantığının önemli kısmı servislerde; router dosyaları kimlik doğrulama, girdi ve yanıt bağlantısını kuruyor.

### Backend teknolojileri

- Python 3.12 tabanlı Docker imajı.
- FastAPI, Uvicorn, Pydantic v2.
- SQLAlchemy 2 async ve asyncpg.
- PostgreSQL 16.
- Alembic migration yönetimi.
- JWT, bcrypt ve hash'lenmiş refresh token kayıtları.
- pytest, Ruff ve strict mypy yapılandırmaları.

Redis Compose içinde mevcut, bağımlılığı ve URL ayarı tanımlı. İncelenen uygulama kodunda aktif cache/kuyruk kullanımına rastlanmadı. Dolayısıyla şu an gerçek iş akışının bir parçası olarak sunulmamalı.

### Mobil teknolojileri

`mobile/package.json` içinde Expo `~57.0.20`, React `19.2.3`, React Native `0.86.3`, TypeScript `~6.0.3` tanımlı. Bunlar projenin bağımlılık bildirimleri; kurulu çalışma ortamı ayrıca doğrulanmadı.

- Expo Router ile dosya tabanlı ekranlar.
- AuthContext ile oturum ve kullanıcı bilgisi.
- `src/api/` altında merkezi HTTP istemcisi ve domain bazlı API yardımcıları.
- SecureStore ile token, aktif antrenman işaretçisi ve bazı cihaz tercihleri.
- `src/theme.ts` ile uygulama renkleri ve ortak tasarım değerleri.
- Ekranların önemli bölümünde yerel React state, effect ve focus yenilemeleri.

## 4. Veri modeli

Mevcut model ve migration yapısı 12 uygulama tablosunu temsil ediyor; Alembic sürüm tablosu bu sayıya dahil değil.

### Hesap

- `users`: hesap, profil, saat dilimi, gizlilik, birim tercihi, kişisel bilgiler ve beslenme hedefleri.
- `refresh_tokens`: kullanıcıya bağlı token hash'i, bitiş ve iptal zamanı.

### Egzersiz kataloğu

- `muscle_groups`: kas grubu, Türkçe adı, bölgesi ve MEV/MAV/MRV değerleri.
- `exercises`: egzersiz, ekipman ve açıklama/görsel için ayrılmış alanlar.
- `exercise_muscle_groups`: egzersiz–kas ilişkisi; `primary/secondary` rolü ve 1–5 effectiveness değerlendirmesi.

Başlangıç SQL verisinde **17 kas grubu ve 20 egzersiz** var. Bu sayılar çalışan veritabanının değil, depodaki başlangıç verisinin sayılarıdır.

### Gerçekleşen antrenman

- `workouts`: kullanıcı, başlık, tarih, bitiş zamanı, isteğe bağlı şablon bağlantısı, toplam set ve tonaj.
- `sets`: egzersiz, sıra, kg, tekrar, isteğe bağlı RIR/RPE ve ısınma işareti.

Toplamlar set değişikliklerinden sonra yeniden hesaplanıyor. Isınma setleri çalışma seti ve tonaj toplamına dahil edilmiyor. Sayısal ağırlıklar veritabanında kg cinsinde tutuluyor.

### Plan

- `programs`: kullanıcının programları; kullanıcı başına en fazla bir aktif programı koruyan kısmi benzersiz indeks.
- `workout_templates`: programın günleri/seans şablonları.
- `template_exercises`: şablondaki egzersiz sırası, hedef set, tekrar aralığı ve isteğe bağlı efor hedefleri.

Program birden fazla şablon, şablon birden fazla hedef egzersiz içeriyor. Şablondan başlatılan antrenmana otomatik gerçekleşmiş set eklenmiyor; kullanıcı yaptığı setleri ayrı kaydediyor. Bu, plan ile gerçekleşeni ayıran yerinde bir karar.

Şablon silindiğinde geçmiş antrenman silinmiyor; `template_id` boşaltılıyor. Buna karşılık geçmiş seansın orijinal hedefleri ayrı bir kopya olarak saklanmıyor: mobil ekran hedefleri güncel şablondan alıyor. İleride plan–gerçekleşen karşılaştırması yapılacaksa bu sınır önem kazanacak.

### Toparlanma ve vücut verisi

- `readiness_logs`: kullanıcı başına günde tek kayıt; uyku süresi/kalitesi, enerji, ruh hali, kas hassasiyeti ve notlar.
- `body_measurements`: kullanıcı başına günde tek kilo ölçümü; ayrıca isteğe bağlı yağ oranı ve not alanı.

Güncel kilo ayrı bir profil sütunundan değil, son ölçümden geliyor. Beslenme hedefleri `users` üzerinde saklanıyor; ayrı yemek/günlük tüketim tablosu yok. Bel, kol, göğüs çevresi gibi ölçüler mevcut modelde yok.

## 5. Özelliklerin mevcut durumu

### 5.1 Hesap ve oturum

Kayıt, giriş, token yenileme, profili okuma/güncelleme mevcut. Mobil açılışta oturumu geri yükleme ve korumalı ekranlara yönlendirme bulunuyor.

Refresh token kullanıldığında eskisi iptal ediliyor. İptal edilmiş token tekrar gelirse kullanıcının refresh oturumları iptal ediliyor. Mobil istemci eşzamanlı yenilemeleri tek işlemde topluyor. Bu iki davranış birbirine bağlı; sonraki değişikliklerde birlikte düşünülmeli.

Mevcut çıkış mobilde tokenları temizliyor. Auth router içinde sunucu taraflı logout, şifre sıfırlama ve e-posta doğrulama akışları bulunmuyor. Refresh iptali ile daha önce üretilmiş access tokenların anında geçersizleşmesi aynı şey değil.

### 5.2 Antrenman kaydı

Serbest seans, egzersiz seçimi, set ekleme/düzeltme/silme, başlık düzenleme, dinlenme sayacı, geçmiş seansı açma ve bitirme mevcut. Bitmiş seans mobilde önce salt okunur açılıyor; kullanıcı düzenlemeye geçebiliyor.

Aktif antrenman cihazda bir ID ile tutuluyor, sunucudaki `/workouts/active` akışı yedek kaynak sağlıyor. Bu yerel işaretçi, çevrimdışı set kayıt sistemi anlamına gelmiyor.

Yeni seans başlatıldığında açık kalmış eski seanslar sunucuda otomatik kapatılıyor. Bitirme işlemi tekrar çağrıldığında ilk bitiş zamanını değiştirmiyor.

Backend RIR/RPE alanlarını destekliyor. İncelenen canlı set giriş akışı ağırlık, tekrar ve ısınma bilgisini gönderiyor; gerçekleşen set için RIR/RPE giriş deneyimi tamamlanmış görünmüyor. Şablonda RIR hedefinin gösterilmesi, gerçekleşen eforun kaydedildiği anlamına gelmiyor.

### 5.3 Programlar ve şablonlar

Program oluşturma, listeleme, düzenleme, aktifleştirme ve silme; şablon oluşturma/düzenleme/silme; şablon egzersiz listesini kaydetme ve şablondan seans başlatma mevcut. Mobilde biten antrenmanı şablon olarak kaydetme akışı da bulunuyor.

Bu bölüm gelecekte başlanacak boş bir modül değil. Ancak otomatik program üretimi, mezodöngü yönetimi, deload planlama veya kişisel ilerlemeye göre program değiştirme motoru da değil.

### 5.4 Haftalık hacim

`GET /api/v1/analytics/weekly-volume` kullanıcı saat dilimine göre haftaları hesaplıyor. Sadece ısınma dışı doğrudan setler eşiklerle karşılaştırılıyor. Dolaylı katılım ayrı bilgi olarak tutuluyor.

Her kas için doğrudan set, dahil olunan set, ortalama effectiveness, tonaj, eşikler ve durum dönüyor. Veri olmayan haftalar da listede yer alıyor. Durumlar `untrained`, `below_mev`, `optimal`, `high`, `above_mrv`.

MEV/MAV/MRV ve effectiveness burada kodun kullandığı model varsayımlarıdır. Bu belge bunların bilimsel doğruluğunu veya kullanıcıya uygunluğunu doğrulamıyor. Effectiveness sensör ölçümü değil, katalog değerlendirmesi.

### 5.5 Dönemsel değerlendirme / “Neden gelişemiyorum?”

Bu özellik **zaten uygulanmış**:

- Backend: `backend/app/domains/analytics/service.py`, `diagnosis()`.
- API: `GET /api/v1/analytics/diagnosis`.
- Mobil: `mobile/app/(app)/diagnosis.tsx`.
- Metinler: `mobile/src/diagnosis/messages.ts`.
- Testler: `backend/tests/test_diagnosis.py`.

Hacim sekmesinden ayrı ekrana gidiliyor; 4/8/12 haftalık dönem seçiliyor. Sunucu `code + severity + data` döndürüyor; başlık, açıklama ve eylem metinleri mobilde oluşuyor.

Hacim ve çalışılmamış bölge bulguları ortak üç bulguluk bütçeyi paylaşıyor. Uyku, kilo ve tutarlılıktan en fazla birer bulgu eklenerek toplam en fazla altı oluyor. Hacim adayları sapma skoruna göre sıralanıyor; bütün kategoriler arasında tek bir önem sıralaması yapılmıyor.

Yeterli veri kontrolü, ilk antrenmanın en az 14 gün önce olmasına dayanıyor. Uyku değerlendirmesi için en az üç uyku kaydı, kilo için en az iki ölçüm gerekiyor. Hedef yoksa veya `maintain` ise kilo yönü değerlendirmesi üretilmiyor.

Toparlanma modelinde enerji, ruh hali ve hassasiyet saklansa da mevcut değerlendirme esas olarak uyku süresini yorumluyor. Kuvvet trendi ve gerçek kas gelişimi ölçümü yok.

### 5.6 Profil, kilo ve beslenme hedefleri

Profil düzenleme, kişisel bilgiler, kilo geçmişi, tercihler ve beslenme hedef ekranları mevcut. Günlük kilo girişi aynı günün kaydını güncelliyor; geçmiş ölçüm silinebiliyor. API keyfi geçmiş tarihe kilo ekleme akışı sunmuyor.

Beslenme hedef servisi profil ve son kilo üzerinden formülle öneri üretip kaydediyor. Kullanıcı hedefleri elle değiştirebiliyor. Bu değerler her okumada yeniden hesaplanmıyor; tekrar üretme ayrı işlem.

Mobilde “auto adjust” tercihi var; makrolar ile kalori hedefi arasındaki aritmetik ilişkiyi düzenliyor. Bu, tüketilen yemeklere veya kilo trendine göre çalışan otomatik beslenme koçu değil.

Yemek kaydı, barkod, tüketim veritabanı ve günlük yenilen kalori takibi yok. Eski belgelerde bu kapsamın bilerek ertelendiği belirtiliyor; sırf yok diye tamamlanacak eksik sayılmamalı.

## 6. Mobil ekran haritası

- `(auth)/login`, `(auth)/register`: hesap erişimi.
- `(app)/(tabs)/index`: antrenman başlangıcı, aktif seans ve geçmiş.
- `(app)/(tabs)/programs`: program listesi.
- `(app)/(tabs)/volume`: haftalık hacim ve değerlendirme ekranına giriş.
- `(app)/(tabs)/profile`: profil menüsü.
- `(app)/workout/checkin`: isteğe bağlı antrenman öncesi günlük kontrol.
- `(app)/workout/exercise-picker`: egzersiz arama/seçme.
- `(app)/workout/[id]`: seans kaydı, geçmiş düzenleme, şablona kaydetme.
- `(app)/program/[id]`: program ayrıntısı ve şablonları.
- `(app)/program/template/[id]`: şablon egzersizleri ve hedefleri.
- `(app)/diagnosis`: dönemsel bulgular.
- `(app)/profile/*`: profil bilgileri, kişisel detaylar, tercihler, kilo geçmişi ve beslenme hedefleri.

Ana seans ekranı yaklaşık 1.269 satır. Beslenme hedefleri ve kişisel bilgiler ekranları da 500 satır civarında. Bu tek başına hata değil; yeni davranışlar eklerken ekranları küçük bileşenlere ve akış yardımcılarına ayırmak bakımı kolaylaştırabilir. Büyük bir yeniden yazım gerektiği sonucu çıkarılmamalı.

## 7. Mevcut belgeler nerede güncelliğini kaybetmiş?

1. **Kök README:** mobilin boş ve backend kodunun henüz yazılmamış olduğu bilgisi artık yanlış. `ml/` klasörü de fiilen yok.
2. **Backend README:** “planlanan yapı, henüz yazılmadı” bölümü eski. Dokuz domain bağlanmış durumda.
3. **Mobil README:** büyük ölçüde Expo başlangıç metni; gerçek ürün akışlarını anlatmıyor.
4. **CLAUDE.md durum özeti:** yedi tablo ve ilk domain listesini anlatıyor; mevcut 12 tabloyu ve program/toparlanma/vücut/beslenme/değerlendirme genişlemesini tam yansıtmıyor.
5. **CLAUDE.md test sayısı:** 125 testi geçen güncel sonuç olarak aktarmak doğru değil. Kaynakta 12 test dosyası içinde 224 `test_...` fonksiyon/metot tanımı sayıldı. Parametrizasyon nedeniyle çalıştırılan vaka sayısı farklı olabilir; geçme sonucu ölçülmedi.
6. **TASK_diagnosis.md:** henüz yapılacak görev biçiminde yazılmış ama uygulaması mevcut. Ayrıca örnek senaryoda 5,5 saat uyku için `sleep_low` denirken eşik tarifinde ve kodda `<6` için `sleep_very_low` var.
7. **mobile/AGENTS.md:** Expo 54 dokümanını işaret ediyor; paket bildirimi Expo 57. İleride kod yazmadan önce bu sürüm çelişkisi giderilmeli.
8. **Test açıklaması da yanılabiliyor:** diagnosis testinin giriş yorumunda bazı kasların secondary bağlantısının dahi olmadığı yazıyor. SQL'de karın, arka omuz, trapez ve ön kol için secondary ilişkiler mevcut. Doğru sorun bu kasların primary kapsamının eksik olması.
9. **Beslenme notları:** eski “kalori sistemi / auto adjust yok” ifadeleri, güncel hedef hesaplama ekranını artık tam anlatmıyor. Hedef hesaplama var, tüketim takibi yok.

Bu nedenle belgeyi, kodu okumaya yardımcı bir harita olarak kullanmak gerekir; herhangi bir belgeyi tartışmasız mevcut durum kabul etmek hataya açık.

## 8. Önce ele alınmasını önerdiğim somut noktalar

### A. Egzersiz kataloğu ile değerlendirme arasındaki kapsam uyumsuzluğu

**Kodda görülen:** Başlangıç kataloğunda `abs`, `obliques`, `traps`, `forearms`, `rear_delts` için primary bağlantı yok. Bazılarının secondary bağlantıları var. Analiz ise bütün kasları doğrudan set sayısına göre değerlendiriyor.

**Etkisi:** Kullanıcı mevcut katalogla bu kaslara doğrudan set kaydedemeyebilir; sistem yine de “hiç çalışılmamış” bulgusu üretir. Bu bulgular sınırlı üç hacim kartında başka sorunların önüne geçebilir.

**Fikir:** Kataloğun primary kapsamını tamamlamak ve her analiz edilen kasın kaydedilebilir karşılığını denetlemek. Katalog kapsamı yetersizliği ile kullanıcının egzersizi yapmaması ayrılmalı. Yeni seed verileri donmuş baseline SQL'i değiştirerek değil, sonraki migration ile yönetilmeli.

### B. Değerlendirmede veri yeterliliği ve dönem tanımı

**Kodda görülen:** İlk kayıt 14 günlükse yeterli veri kabul ediliyor. Hacim ortalaması seçilen hafta sayısına bölünüyor; devam eden hafta ve kullanıcının kayıt öncesi haftaları için özel ayrım yok. Uyku/kilo geriye dönük gün aralığı, hacim/sıklık takvim haftaları kullanıyor.

**Etkisi:** İki haftadır kullanan biri 12 haftayı seçtiğinde kayıt öncesi haftalar sıfır gibi ortalamaya girebilir. Haftanın başında devam eden hafta düşük görünebilir. “4 hafta” ifadesi farklı sinyallerde birebir aynı tarih aralığını anlatmayabilir.

**Fikir:** Tamamlanmış hafta, kayıt kapsamı ve gerçek değerlendirme aralığını açıkça tanımlamak. Veri yokluğu ile gerçekten antrenman yapılmamasını ayırmak. Her kategori için kaç gün/hafta gözlem bulunduğunu göstermek.

### C. Kilo yorumunun ölçümler arasındaki gerçek süreyi kullanmaması

**Kodda görülen:** İlk ve son ölçüm karşılaştırılıyor; tüm dönem seçeneklerinde sabit %0,5 değişim eşiği var. İki ölçüm arasındaki asgari süre denetlenmiyor; yanıta seçilen dönem yazılıyor. Yön doğruysa değişim hızına üst sınır koymadan `weight_on_track` üretilebiliyor.

**Etkisi:** 12 haftalık görünümde yalnızca son iki güne ait ölçüm olsa bile metin 12 haftalık değişim izlenimi verebilir. Bu bir ölçüm kapsamı problemidir.

**Fikir:** Gerçek ölçüm başlangıç/bitiş tarihlerini göstermek, ölçüm sıklığı ve süre koşulu tanımlamak, yeterli veri varsa daha dengeli bir trend hesabı kullanmak. Hız ve eşiklerin nasıl seçileceği ayrı ürün/bilimsel doğrulama konusu olarak ele alınmalı.

### D. İnternet kesintisinin oturumu silebilmesi

**Kodda görülen:** `src/api/client.ts` içinde refresh ağ hatasında false dönüyor; üst çağıran false durumunda tokenları temizliyor. `AuthContext.tsx` açılıştaki profil isteğinin bütün hatalarında da tokenları temizliyor.

**Etkisi:** Geçici bağlantı sorunu kullanıcıyı yeniden giriş yapmak zorunda bırakabilir. İç yorumda tokenların korunacağı yazılması, dış çağıranın davranışını değiştirmiyor.

**Fikir:** Geçersiz oturum ile erişilemeyen sunucuyu ayırmak. Başlangıçta tam çevrimdışı sistemi kurmadan da bağlantı hatasında mevcut oturumu korumak mümkün.

### E. Antrenman geçmişi ilk sayfada kalıyor

**Kodda görülen:** API `limit/offset` destekliyor. Mobil `listWorkouts()` varsayılan 20 kayıtla çağrılıyor; ana ekran devam sayfasını yüklemiyor.

**Etkisi:** Daha eski antrenmanlar bu listeden erişilemez hale geliyor; bu veritabanından silindikleri anlamına gelmiyor.

**Fikir:** Sonraki sayfa yükleme ve anlaşılır yükleniyor/hata durumu eklemek. Backend'deki mevcut kapasiteyi kullanan sınırlı bir iş.

### F. Boş ve açık seansların analitik anlamı

**Kodda görülen:** Tutarlılık hesabı workout satırlarını sayıyor; bitmiş olma veya çalışma seti içerme koşulu yok. Hacim de açık seansın mevcut setlerini sayabiliyor. Yeni seans eski açık seansı o anın tarihiyle kapatıyor.

**Etkisi:** Boş deneme seansları antrenman sıklığını yükseltebilir. Günler sonra otomatik kapatılan seansın gösterilen süresi gerçek egzersiz süresi olmayabilir.

**Fikir:** “Geçerli antrenman”, “devam eden seans”, “terk edilmiş seans” ve gerçek süre kurallarını netleştirmek. Açık seansın hacimde canlı görünmesi bilinçli tercih olabilir; davranış açıkça tanımlanmalı.

### G. Kullanıcıya gösterilen anlamın tutarlılığı

- `kg/lb` tercihi kaydediliyor fakat gerçek dönüşüm yok; tercih ekranı bunu açıkça söylüyor. İşlevsel birim desteği ayrı iş.
- İngilizce bulgu metinlerine Türkçe kas adları ekleniyor. Türkiye hedefi ile dil deneyimi henüz örtüşmüyor.
- Eşik bilinmediğinde `_classify()` `optimal` döndürüyor. Mevcut seed eşik içeriyor; ileride eşiksiz kas eklendiğinde “bilinmiyor” durumunun “optimal” ile karışmaması gerekir.
- Değerlendirme ekranında dönem isteklerinin yanıtı `load()` içinde doğrudan state'e yazılıyor. Hızlı dönem değişiminde eski yanıtın yeni seçimi ezmesi olasılığı çalışma zamanı testiyle incelenmeli.

### H. İleride doğrulanması gereken teknik sınırlar

Bunlar bu incelemede üretilmiş hatalar değil, kod akışından görülen denetim adaylarıdır:

- Eşzamanlı set ekleme/değiştirmede sıra ve denormalize toplam tutarlılığı. Yeniden hesaplamak tek başına bütün eşzamanlılık sorunlarını çözmez.
- Birden fazla istemciden refresh çağrısında sunucu tarafı atomiklik. Mobil single-flight yalnızca o istemcideki çağrıları koordine eder.
- Aktif seans işaretçisi ve tercihlerin kullanıcı hesabı yerine cihaz anahtarlarında tutulması; hesap değişiminde beklenen davranış.
- Güncel şablon hedeflerinin geçmiş seansla birlikte gösterilmesi; hedef tarihçesi gereksinimi.
- Cihazın saat dilimiyle gruplanan mobil geçmiş ile kullanıcı profilinin saat dilimini kullanan backend analizinin seyahat sırasında ayrışması.

## 9. Henüz bulunmayan ama otomatik olarak eksik sayılmaması gerekenler

- Sosyal feed, takip, beğeni ve sıralama.
- Kişisel rekor/e1RM trendi ve ilerleme analizi.
- Otomatik program önerisi, mezodöngü ve deload yönetimi.
- Video form değerlendirmesi, RL, HAR ve sensör entegrasyonu.
- Fotoğraf yükleme/depolama, abonelik ve ödeme altyapısı.
- Aydınlık tema ve tam çok dilli arayüz.
- Yemek tüketim takibi.

Bu maddelerin her biri başka bir ürün ihtiyacına cevap verir. Aynı anda açılmaları mevcut ürünün güvenilirliğini artırmak yerine kapsamı büyütebilir. Özellikle yemek takibinin yokluğu geçmiş belgelerde açık kapsam kararı olarak belirtilmiş.

## 10. Test ve çalıştırma yapısı

Backend testleri auth, users, exercises, workouts, programs, readiness, body, nutrition, analytics, weekly-volume, diagnosis ve migrations alanlarına yayılmış durumda. Statik sayımda 224 test tanımı bulundu; testlerin varlığı ve başarı durumu ayrı bilgiler.

Test altyapısı gerçek PostgreSQL kullanıyor. `conftest.py` test oturumu başlangıcında `bodytrack_test` veritabanını yeniden oluşturup Alembic zincirini uyguluyor. Dolayısıyla pytest salt okunur inceleme işlemi değildir; bu görüşmede çalıştırılmadı.

Mobil envanterinde uygulamaya ait test/spec dosyası bulunmadı. TypeScript denetimi tanımlanmış geliştirme yaklaşımının parçası; bağlantı kesintisi, hızlı ekran değişimi ve seans devam ettirme gibi davranışları tek başına kanıtlamaz.

Migration sırası:

1. `e272543ef2bb`: başlangıç şeması ve seed; `db/schema_v1.sql` dosyasını okur.
2. `6ad6922ce3aa`: ad/soyad değişikliği.
3. `4ffcb5a98d66`: vücut ölçümleri ve kişisel bilgiler.
4. `82c7336cad06`: beslenme hedef alanları.

Alembic değişikliklerin giriş noktasıdır; baseline'ın SQL dosyasına fiziksel bağımlılığı devam ediyor. “SQL artık hiç kullanılmıyor” demek yanlış olur.

Docker başlangıcında migration ardından Uvicorn çalışıyor. Compose geliştirme hedefini seçiyor, kodu bağlıyor ve mevcut Docker CMD `--reload` içeriyor. “Base imaj var” ile “üretim dağıtımı tamam” aynı şey değil. `/health` mevcut haliyle basit canlılık yanıtı; veritabanı/Redis erişimini sınamıyor. Depoda CI iş akışı görülmedi.

## 11. Fikirleri hangi sırayla konuşabiliriz?

### Adım 1 — Güvenilir kayıt ve erişim

İnternet hatasında oturumun korunması, eski antrenmanlara erişim, boş/açık seans davranışı ve kullanıcıya görünür hata durumları. Kullanıcı önce kaydına ve geçmişine güvenebilmeli.

### Adım 2 — Güvenilir değerlendirme

Egzersiz kataloğunun primary kapsamı, veri yeterliliği, dönem sınırları ve kilo ölçüm aralığı. Bu adım ürünün ana vaadini doğrudan güçlendirir.

### Adım 3 — Anlaşılır geri bildirim

Tutarlı dil, gözlem kapsamının görünmesi ve bulgudan ilgili ekrana geçiş. Örneğin veri azsa ölçüm/kontrol ekranına, hacim bulgusunda ilgili kasın ayrıntısına yönlendirme. Bulguyu açıklamak ile otomatik program değiştirmek ayrı tutulabilir.

### Adım 4 — Plan ile gerçekleşenin karşılaştırılması

Şablon hedeflerinin tarihsel korunması, planlanan ve yapılan setlerin karşılaştırılması, isteğe bağlı gerçek RIR girişi. Mevcut program modülünün doğal devamı.

### Adım 5 — İlerleme sinyalleri

Egzersiz bazlı ağırlık/tekrar değişimi, kişisel rekor ve gerekirse tahmini kuvvet trendleri. Aynı hareket, tekrar aralığı ve efor koşulları arasında karşılaştırmanın nasıl yapılacağı önceden tanımlanmalı.

### Adım 6 — Kişiselleştirme ve genişleme

Yeterli kaliteli veri ve açık kurallar oluşunca program önerisi. Sosyal ve sensör özellikleri ancak ayrı bir kullanıcı ihtiyacı veya akademik hedefle gerekçelendirilirse öne alınmalı.

Bu sıra süre tahmini veya geliştirme taahhüdü değil. Bitirme projesinin değerlendirme ölçütleri ve kullanıcının yaşadığı gerçek sorunlar sırayı değiştirebilir.

## 12. Tartışmaya değer ürün fikirleri

**“Bu sonuca nasıl ulaştık?” açıklaması:** Her bulguda tarih aralığı, kaç kayıt kullanıldığı ve hangi gözlemin tetiklediği görülebilir. Kod+veri yanıt yapısı buna uygun bir başlangıç.

**Kayıt kapsamı göstergesi:** “Bu dönemde 3 uyku ve 2 tartı kaydı var” gibi somut bilgi. Hesaplanmamış bir güven yüzdesi üretmekten kaçınılmalı.

**Dinlenme gününde kısa kontrol:** Readiness modeli gün bazlı; kullanıcı antrenman başlatmadan da günlük kayda ulaşabilirse veri yalnızca spor günleriyle sınırlı kalmaz.

**Antrenman sonrası küçük özet:** O seanstaki çalışma setleri ve haftalık hacme katkısı. Mevcut verilerle sınırlı kalır; yeni bir sosyal sistem gerektirmez.

**Kullanıcının kendi deneyi:** Kullanıcı bir değişiklik not eder, birkaç hafta sonra aynı göstergeleri karşılaştırır. Uygulama neden-sonuç kanıtladığını iddia etmeden gözlemi düzenler.

**Katalog kapsamı denetimi:** Analize giren her kasın kaydedilebilir doğrudan egzersiz karşılığı bulunup bulunmadığı içerik bakımının ölçütü olabilir.

## 13. Sonraki konuşmalar için karar başlıkları

1. İlk kullanıcı için en önemli iş hızlı kayıt mı, program takibi mi, dönemsel değerlendirme mi?
2. “Teşhis” adını mı koruyacağız, yoksa kapsamı daha açık anlatan bir ürün dili mi kullanacağız?
3. İlk sürümde Türkçe deneyim ne ölçüde tamamlanmalı?
4. Egzersiz kataloğunu kim ve hangi tutarlı ölçütle yönetecek?
5. Bir haftanın ve bir antrenmanın analizde geçerli sayılma kuralı ne olacak?
6. Yeni kullanıcıda eksik kayıt ile yapılmamış antrenmanı nasıl ayıracağız?
7. Bitirme projesinin beklenen akademik katkısı hangi parçaya dayanacak?

## 14. Benim mevcut kanaatim

Proje boş bir iskelet değil; antrenman kaydı, programlar ve birkaç veri kaynağını birleştiren değerlendirme katmanıyla genişlemiş bir MVP. Genel mimari yeni özellik eklemeye elverişli; özellikle servis ayrımı, kullanıcı sahipliği kontrolleri, migration yaklaşımı ve plan/gerçekleşen ayrımı korunmaya değer.

İlk odak önerim daha fazla modül açmak değil, mevcut kullanıcı döngüsündeki somut boşlukları kapatmak: kayıt güvenilirliği, katalog kapsamı ve dönemsel yorumların doğru anlam taşıması. Bunlar güçlendiğinde program karşılaştırması ve ilerleme analizi daha sağlam bir zemine oturur.

Bu belge proje değiştikçe güncellenmeli. Her yeni maddede “kodda mevcut”, “testle doğrulandı”, “öneri” ve “kapsam dışı” ayrımı korunmalı.
