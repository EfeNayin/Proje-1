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

Dönemsel değerlendirmede kilo ölçüm kapsamı Adım 5'te, tamamlanmış antrenman haftaları Adım 6'da, uyku kayıt kapsamı Adım 7'de, dönem isteklerinin ekranda tutarlı gösterimi Adım 8'de ele alındı. Bölüm 7'de listelenen güncelliğini yitirmiş belgeler Adım 14'te düzeltildi. Bölüm 8 madde G1'deki (kg/lb dönüşümü eksik) sorun Adım 15'te, madde G2'deki (teşhis metninde dil karışıklığı) sorun Adım 16'da, madde G3'teki (referans aralığı olmayan kasın yanlışlıkla "optimal" sayılması) sorun Adım 17'de giderildi. Bölüm 8 madde H'nin ilk maddesindeki (eşzamanlı set ekleme/değiştirmede denormalize toplam tutarlılığı) sorun Adım 18'de, ikinci maddesindeki (çoklu istemciden refresh çağrısında sunucu tarafı atomiklik) sorun Adım 19'da, üçüncü maddesindeki (aktif seans işaretçisinin hesap yerine cihaza bağlı olması) sorun Adım 20'de, dördüncü ve son maddesindeki (saat dilimi ayrışması, seyahat sırasında) sorun Adım 21'de giderildi — Bölüm 8 madde H'nin tamamı bu adımla kapandı. Bölüm 8'in A-H maddelerinin tamamı kapandıktan sonra kullanıcının kendisinden gelen yeni taleplerle devam edildi: egzersiz kataloğunun çok az olması Adım 22'de, haftalık hacim ekranındaki kas adlarının Türkçe/İngilizce tutarsızlığı (Adım 16'nın "Sınır" notunda ve Bölüm 8 madde G'de açık bırakılmıştı) Adım 23'te, egzersiz seçicideki son Türkçe isim kalıntısı Adım 24'te giderildi, kataloğa dış bir kaynaktan derlenen 50 egzersiz daha Adım 25'te eklendi, egzersiz seçicisinin tek düz liste olması yüzünden egzersiz bulmanın zorlaşması Adım 26'da yedi kaba kategoriye (göğüs/sırt/biceps/triceps/bacak/karın/omuz, İngilizce) ayrılarak giderildi (aynı adımın görsel çip kesilmesi hatası da aynı gün içinde düzeltildi), ve haftalık hacim ekranındaki kas adlarının ham kod olarak (`front_delts`, `biceps`) gösterilmesi Adım 27'de "Front Delts", "Biceps" biçiminde başlık harfli gösterime çevrilerek giderildi.

### Adım 29: Gerçekleşen sete isteğe bağlı RIR kaydetme — 24 Eylül 2026

- Antrenman ekranındaki yeni set formuna ve set düzenleyicisine `RIR (optional)` alanı eklendi. Set sonunda yapılabilecek yaklaşık ek tekrar sayısı olarak açıklanıyor; 0–10 arası tam sayı kabul ediliyor. Boş alan `null`, bilinçli girilen `0` ise gerçek sıfır olarak gönderiliyor. Geçersiz, negatif, ondalıklı veya 10'dan büyük girişlerde istek gönderilmeden alanın yanında hata gösteriliyor.
- Başlangıç planının hedef RIR değeri veya önceki setin RIR'ı yeni sete otomatik kopyalanmıyor. Her setin eforu kullanıcı girişiyle belirleniyor. Kaydedilen RIR, canlı ve bitmiş seansların set satırında gösteriliyor; set düzenleyicisinden değiştirilebiliyor veya alan temizlenerek kaldırılabiliyor. Hedef satırları başlangıç planını göstermeye devam ediyor.
- Mevcut `NewSet`/`updateSet` sözleşmesi ve backend'in nullable `rir` alanı kullanıldı; şema veya migration değişikliği gerekmedi. RPE alanına ve mevcut RPE verilerine dokunulmuyor. Plan–kayıt karşılaştırması set sayısına dayanmaya devam ediyor; RIR'dan başarı puanı veya öneri çıkarılmıyor.
- İlgili kayıt güvenilirliği boşluğu da kapatıldı: yeni set formu sunucu yanıtı gelmeden taslağı temizlemiyor. Kayıt hatasında ağırlık, tekrar ve RIR girişleri korunuyor; düzeltme hatasında düzenleyici açık kalıyor. Gönderim sırasında aynı formun çift gönderimi ve alan değişiklikleri engelleniyor. Bu koruma yalnızca ekran belleğindeki taslak için; tam çevrimdışı kayıt veya set oluşturma idempotency'si değildir.

Doğrulama: 8 yeni test dahil 97 mobil testi geçti. Yeni testler gerçek ekran bileşenlerinin olay/state akışlarını basit React/native adaptörleriyle çalıştırarak boş/sıfır ayrımı, önceki RIR'ın kopyalanmaması, başarılı kayıt sonrası temizleme, ağ hatasında taslak koruma, çift gönderim engeli, geçersiz giriş, RIR silme, düzenleme hatası ve geçmiş satırı gösterimini doğruluyor. API yardımcılarının create/update gövdelerinde `0`/`null` taşıması da test edildi. Tam TypeScript ve sıfır uyarıyla tam ESLint temiz. Backend kodu değişmediği için backend testleri tekrar çalıştırılmadı. Fiziksel cihaz klavye ve yerleşim kontrolü henüz yapılmadı.

Sınır: RIR öz bildirime dayanır; uygulama değeri hesaplamaz veya doğruluğunu ölçmez. RPE girişi, efor karşılaştırması ve ilerleme analizi bu adımın kapsamı dışında.

### Adım 28: Başlangıç planı ile kaydedilen çalışma setlerini karşılaştırma — 24 Eylül 2026

- Adım 13'te saklanan `template_snapshot`, artık antrenman ekranında egzersiz başına hedef ve kaydedilen çalışma setlerinin karşılaştırılmasında kullanılıyor. “Plan and log” özeti canlı seanslarda ve geçmiş seanslarda gösteriliyor; veri yalnızca antrenmanın kendi başlangıç planından geliyor.
- Egzersiz başına pozitif tekrarlı, ısınma olmayan setler sayılıyor. Ağırlığı sıfır olan vücut ağırlığı setleri dahil. Toplamda her egzersiz için hedef ile kayıt sayısının küçüğü toplanıyor; bir hareketteki fazladan set başka hareketin kaydedilmemiş hedefini kapatmıyor. Kaydedilmemiş hedef setleri ve fazla setler ayrı gösteriliyor. Plan dışındaki hareketler ayrıca belirtiliyor.
- Şablonda aynı hareket birden fazla blokta bulunabiliyor. Hedef setler hareket kimliğine göre toplanıyor ve her gerçek set bir kez sayılıyor. Ekran da artık yalnızca ilk hedef bloğunu seçmek yerine o harekete ait bütün hedef bloklarını gösteriyor.
- Set ekleme, düzenleme, silme veya ısınma işaretini değiştirme sonrasında karşılaştırma güncel antrenman yanıtından yeniden hesaplanıyor. Planı olmayan serbest/eski seanslar için karşılaştırma uydurulmuyor; saklanmış ama boş hedefli plan ayrı ele alınıyor. Şablonun canlı bağlantısı silinse de saklanan planla hesaplama sürüyor.

Doğrulama: 8 yeni karşılaştırma testi dahil 89 mobil testi geçti. Tam TypeScript ve sıfır uyarı ile tam ESLint kontrolü temiz. Testler kayıtsız hedefler, fazla setlerin başka eksikleri kapatmaması, ısınma/sıfır tekrar ayrımı, vücut ağırlığı setleri, yinelenen hedefler, eski/boş planlar, silinmiş şablon ve set düzeltme/silme durumlarını kapsıyor. Backend ve veritabanı şeması değişmedi; backend testleri yeniden çalıştırılmadı. Telefon üzerinde görsel kontrol henüz yapılmadı.

Sınır: Bu karşılaştırma yalnızca kayıtlı set sayısını anlatır; tekrar aralığı, ağırlık, RIR/RPE veya antrenman kalitesi puanlanmaz. “Not recorded” ifadesi yapılmadığını kanıtlamaz; açık seanslarda kalan kayıtları da kapsar. Otomatik program değiştirme ve ilerleme analizi eklenmedi.

### Adım 27: Haftalık hacim ekranındaki kas adlarının ham kod yerine okunaklı başlık olarak gösterilmesi — 14 Eylül 2026

- Talep: Kullanıcı, hacim ekranındaki kas satırı başlıklarının `front_delts`, `biceps` gibi ham (alt çizgili, küçük harfli) kod olarak yazıldığını belirtti. İstenen biçim: her kelimenin baş harfi büyük, birden fazla kelimeyse aralarında boşluk — "Biceps", "Front Delts" gibi.
- Durum tespiti: Adım 23, `muscle.name_tr` (Türkçe) yerine `muscle.name`'i göstermeye geçmişti — ama `muscle.name` backend'in `muscle_groups.name` sütunundaki ham makine kodu (`chest`, `upper_back`, `front_delts`, ...), bir görüntüleme metni değil. Adım 23'te bu satırın Türkçe'den İngilizce'ye geçtiği doğrulanmıştı ama kodun kendisinin insan-okunur biçime çevrilmesi gerektiği o adımda fark edilmemişti — bu, o hatanın bir devamı/ek düzeltmesi.
- Düzeltme: `mobile/app/(app)/(tabs)/volume.tsx`'e küçük bir `formatMuscleName()` yardımcı fonksiyonu eklendi — `_` karakterinde ikiye bölüp her kelimenin baş harfini büyütüyor, boşlukla birleştiriyor (bir eşleme tablosu değil, bu yüzden kataloğa yeni bir kas eklenirse bu listenin güncellenmesi gerekmiyor). `MuscleRow`'daki tek satır (`{muscle.name}` → `{formatMuscleName(muscle.name)}`) değiştirildi. Backend'e veya `muscle.name`/`muscle.name_tr` verisinin kendisine dokunulmadı — yalnızca görüntüleme katmanı, Adım 23/24 ile aynı desen.
- 17 kas kodunun tamamı (`chest`, `upper_back`, `lats`, `lower_back`, `front_delts`, `side_delts`, `rear_delts`, `biceps`, `triceps`, `forearms`, `traps`, `quads`, `hamstrings`, `glutes`, `calves`, `abs`, `obliques`) elle Node ile çalıştırılarak beklenen çıktıyla (`front_delts` → `Front Delts`, `upper_back` → `Upper Back`, tek kelimeli olanlar değişmeden büyük baş harfle, örn. `biceps` → `Biceps`) birebir eşleştiği doğrulandı.

Doğrulama: `npx tsc --noEmit` (proje genelinde) ve `npx eslint "app/(app)/(tabs)/volume.tsx"` — temiz. `node --test tests/lifecycle.test.cjs` — 3/3 geçti. Fonksiyonun kendisi 17 kas kodunun tamamı üzerinde `node -e` ile elle çalıştırılıp beklenen 17 çıktıyla karşılaştırıldı (yukarıda). Bu ekranın kendi `.test.cjs` dosyası yok (Adım 23'te de aynı durum), gerçek tsc/eslint + elle doğrulama ile teyit edildi. Backend değişmediği için backend testleri yeniden çalıştırılmadı.

Sınır: Yalnızca haftalık hacim ekranı değişti. `mobile/src/diagnosis/messages.ts` içindeki bazı teşhis bulgu başlıkları da aynı ham kas kodunu doğrudan metne gömüyor (örn. `` `${muscle}: low recorded volume` `` → "front_delts: low recorded volume") — kullanıcı özellikle "Volume kısmında" dediği için bu adımın kapsamı dışında bırakıldı, isterse ayrı bir talep olarak ele alınabilir. `checkin.tsx`'teki kas ağrısı seçici zaten `name_tr` (Türkçe) kullanıyor, bu adımdan etkilenmedi.

### Adım 26: Egzersiz seçicisine kategori filtresi eklendi — 14 Eylül 2026

- Talep: Kullanıcı, kullanıcının programı başlatıp egzersiz eklemek istediğinde her şeyin tek bir listede olması yüzünden aradığını bulamadığını belirtti. 17 kaslık detaylı taksonomiye değil, daha kaba bir kategoriye ayrılmasını istedi: göğüs, sırt, biceps, triceps, bacak, karın, omuz — ve bunların İngilizce gösterilmesini istedi.
- Durum tespiti: Backend zaten `muscle` filtresiyle 17 kaslık taksonomiye göre filtreleme yapabiliyordu (`/exercises?muscle=...`, Adım 4/22/25'in test dosyalarında kullanılıyor), ama bu hem bir seçici ekranında sunulamayacak kadar detaylı (17 seçenek) hem de `exercise-picker.tsx` bu parametreyi hiç kullanmıyordu — yalnızca serbest metin araması vardı.
- Düzeltme: Backend'e `muscle`'dan ayrı, ona ek yeni bir `category` filtresi eklendi (`schemas.py`: `Category` literal tipi + `ExerciseQuery.category`; `service.py`: `CATEGORY_MUSCLES` eşlemesi + `_apply_filters`'a `muscle` filtresiyle aynı EXISTS deseninde bir blok). 17 kas, 7 kategoriye şöyle dağıtıldı: chest→chest; back→upper_back+lats+lower_back+traps; biceps→biceps+forearms; triceps→triceps; legs→quads+hamstrings+glutes+calves; abs→abs+obliques; shoulders→front_delts+side_delts+rear_delts. İki yerleştirme doğrudan kullanıcının yedi kategorisinden çıkmıyor, editoryal bir karar: forearms için ayrı bir "kol/forearm" kategorisi istenmediğinden biceps'e, traps ise omuz değil sırt gününe ait kabul edilerek back'e eklendi — bu iki karar test dosyasında ayrıca (her iki yönden de) doğrulanıyor.
- Mobil tarafta `exercise-picker.tsx`'te arama kutusunun altına yatay kaydırılan yedi çip eklendi: Chest / Back / Biceps / Triceps / Legs / Abs / Shoulders (İngilizce, kullanıcının talebi). Bir çipe basmak o kategoriye göre filtreliyor; tekrar basmak temizliyor — `checkin.tsx`'teki rating-dot ile aynı "seçili değeri tekrar tıklayınca temizlenir" deseni. `src/api/exercises.ts`'teki `searchExercises`'a opsiyonel bir `category` parametresi eklendi; tek çağıran yer (`exercise-picker.tsx`) parametreyi pozisyonel geçtiği için imza değişikliği geriye dönük kırıcı olmadı.
- `backend/tests/test_exercise_categories.py` (yeni dosya, 18 test): her kategorinin sonuç döndürdüğü, bilinmeyen kategori değerinin (`?category=arms`) 422 verdiği, yedi örnek egzersizin doğru kategoride bulunduğu (forearms→biceps ve traps→back yerleştirmeleri dahil), alakasız kategoriye sızmadığı (bir göğüs egzersizi `legs`'te çıkmıyor, forearms egzersizi `shoulders`'ta çıkmıyor), ve `category`+`equipment` filtrelerinin birlikte çalıştığı doğrulandı.

Doğrulama:
1. Backend: **`pytest` — 352 test, tamamı geçti** (334 önceki + bu adımın 18 yeni testi). `ruff format --check` / `ruff check` / `mypy app` (52 dosya, strict) — değiştirilen/eklenen üç dosya (`schemas.py`, `service.py`, `test_exercise_categories.py`) temiz.
2. Yedi kategorinin her birinin gerçek veritabanında boş olmadığı doğrudan SQL ile de ayrıca teyit edildi (abs 12, back 29, biceps 24, chest 13, legs 27, shoulders 24, triceps 18 — hiçbiri varsayılan 50'lik sayfa limitini aşmıyor, bu yüzden ayrı bir sayfalama/limit değişikliği gerekmedi).
3. Mobil: `npx tsc --noEmit` (proje genelinde) — temiz. `npx eslint` (değiştirilen iki dosya) — temiz. Mevcut dokuz `.test.cjs` dosyasının tamamı (81 test) `node --test` ile çalıştırıldı — hepsi geçti; bu ekranın kendi `.test.cjs` dosyası yok (JSX döndüren bir ekran, Adım 20/21/23/24 ile aynı durum), gerçek tsc/eslint ve elle inceleme ile doğrulandı.

Sınır: Kategoriler yalnızca picker ekranına eklendi; egzersiz detay ekranı, hacim ekranı veya check-in ekranındaki mevcut 17-kas filtreleme/gösterim davranışına dokunulmadı — `muscle` sorgu parametresi hâlâ eskisi gibi çalışıyor, `category` ona ek, onu değiştirmeyen ayrı bir parametredir. forearms→biceps ve traps→back yerleştirmeleri kullanıcının mesajında açıkça belirtilmedi, editoryal bir karardır (yukarıda gerekçelendirildi); kullanıcı farklı bir gruplama isterse `service.py`'deki tek bir sözlük (`CATEGORY_MUSCLES`) değiştirilerek kolayca uyarlanabilir. Kategori başına egzersiz sayısı şu an rahatça varsayılan 50'lik sayfa limitinin altında (en fazla 29, "back"); katalog büyümeye devam ederse (bkz. Adım 25) bu sınır yeniden gözden geçirilmeli.

**Ek düzeltme (aynı gün): çip satırındaki görsel bozulma.** Kullanıcı telefonda bir ekran görüntüsü paylaştı — yedi kategori çipi kesilmiş/hayalet gibi görünüyordu (her etiketin yalnızca alt yarısı okunaklıydı, üstünde soluk bir "ikinci kopya" varmış gibi duruyordu), dokunma işlevi ise sorunsuzdu. Kök neden: yatay `ScrollView`'a (`styles.categories`) kendi yüksekliği için bir değer verilmemişti; bu durumda ScrollView'ın enine eksen (yükseklik) boyutu belirsiz kalıyor ve içindeki her `Pressable` çip, varsayılan `alignItems: "stretch"` davranışıyla bu belirsiz yüksekliğe göre geriliyordu — bu da yuvarlak çip arka planının metinden çok daha uzun/kesik render edilmesine yol açıyordu. Düzeltme: `categories` stiline sabit bir `height: 44` eklendi, `categoriesContent`'e `alignItems: "center"` eklendi (çipleri bu sabit yükseklik içinde ortalıyor, geriyor değil), ve `chip` stiline `alignSelf: "center"` eklendi. Yalnızca `mobile/app/(app)/workout/exercise-picker.tsx`'teki stil bloğu değişti; backend'e veya davranışa (hangi çipin hangi egzersizleri filtrelediğine) dokunulmadı.

Doğrulama: `npx tsc --noEmit` (proje genelinde) ve `npx eslint "app/(app)/workout/exercise-picker.tsx"` — temiz. `node --test tests/lifecycle.test.cjs` — 3/3 geçti. Bu saf bir stil düzeltmesi olduğu için backend testleri yeniden çalıştırılmadı (hiçbir backend dosyası değişmedi). Telefonda görsel olarak yeniden test edilmedi — kullanıcının ekran görüntüsüyle bildirdiği belirti ve kök neden analizi eşleşiyor, ama nihai teyit kullanıcıdan.

Sınır: Bu, kod okuyarak tespit edilen bir hipotezdir; ekran görüntüsü olmadan (RN'nin bu sınıf "belirsiz enine eksen" hatalarında tipik belirtisi budur) doğrulandı, ama gerçek cihazda "artık düzgün görünüyor mu" teyidi kullanıcıdan bekleniyor.

### Adım 25: Dış kaynaktan 50 egzersiz daha eklendi — 14 Eylül 2026

- Talep: Kullanıcı kataloğun büyümeye devam etmesini istedi ve `fitnessprogramer.com/exercises/` adresini isim/ekipman/kas bilgisi çekilebilecek bir kaynak olarak işaret etti; genel egzersiz isimleri ve sınıflandırmaları üzerinde telif hakkı sorunu olmadığını belirtti. "Şimdilik 50 tane al" dedi.
- Araştırma: Sitenin `/exercise-primary-muscle/<kas>/` sayfaları (chest, back, shoulders, biceps, triceps, forearm, abs, hip, calf, trapezius, erector-spinae, legs) doğrudan `WebFetch` ile çekildi — her sayfadan isim + ekipman + (varsa) ikincil kas bilgisi toplandı. Site 1500+ egzersiz içeriyor ve kendi 17 kaslık taksonomimizle birebir örtüşmüyor; bu yüzden toplanan gerçek isim/ekipman verisi, projenin kendi `muscle_groups` eşlemesine ve editoryal effectiveness (1-5) puanlamasına — Adım 4 ve Adım 22'de olduğu gibi — elle işlendi. Site effectiveness puanı yayınlamıyor, bu her zaman bu projenin kendi kararı.
- Düzeltme: Yeni bir Alembic migration'ı (`254456be6d79`), Adım 4 ve Adım 22'nin aynı kalıbını izleyerek 50 egzersiz daha ekliyor: sabit UUID'ler, her egzersiz için en az bir `primary` kas bağlantısı. Seçim özellikle hâlâ ince kalan kaslara (lower_back, rear_delts, traps — Adım 22 sonrası yalnızca 2 doğrudan seçenekleri vardı) ve eksik ekipman çeşitliliğine (machine, cable) öncelik verdi. Sonuç: **96 egzersiz**, 17 kasın hepsinde en az 4 doğrudan seçenek.
  - Eklenenler (kasa göre): chest +5 (Decline Barbell Bench Press, Incline Dumbbell Bench Press, Pec Deck Fly, Low Cable Crossover, Machine Chest Press), upper_back +4 (Chest-Supported Dumbbell Row, Machine Row, Pendlay Row, Inverted Row), lats +2 (Straight-Arm Pulldown, Close-Grip Lat Pulldown), lower_back +2 (Seated Good Morning, Superman), front_delts +3 (Seated Dumbbell Shoulder Press, Smith Machine Shoulder Press, Landmine Press), side_delts +3 (Machine Lateral Raise, Upright Row, Dumbbell Y-Raise), rear_delts +2 (Reverse Pec Deck Fly, Cable Reverse Fly), biceps +4 (Dumbbell Preacher Curl, Concentration Curl, Cable Curl, Incline Dumbbell Curl), triceps +2 (Barbell Skull Crusher, Cable Rope Overhead Triceps Extension), forearms +3 (Barbell Reverse Curl, Dumbbell Reverse Wrist Curl, Barbell Wrist Curl), traps +2 (Rack Pull, Snatch-Grip High Pull), quads +3 (Hack Squat, Goblet Squat, Smith Machine Squat), hamstrings +3 (Nordic Hamstring Curl, Single-Leg Romanian Deadlift, Good Morning), glutes +3 (Cable Pull-Through, Sumo Deadlift, Cable Kickback), calves +3 (Leg Press Calf Raise, Donkey Calf Raise, Single-Leg Calf Raise), abs +3 (Decline Sit-Up, Ab Wheel Rollout, Reverse Crunch), obliques +3 (Cable Woodchop, Hanging Oblique Raise, Landmine Rotation).
  - Kullanıcının aynı mesajdaki diğer isteği gereği ("haraketlerin hepsi ingilizce olacak" — bkz. Adım 24), bu 50 egzersizin `name_tr` alanı Türkçe çeviri değil, `name` ile birebir aynı İngilizce metin — Adım 4/22'nin aksine. Bu yalnızca görünüm kararı: `name_tr` hâlâ Türkçe aksansız aramanın (`idx_exercises_name_tr`) arkasında duruyor, sadece bu satırlarda "farklı" bir Türkçe metin değil.
- `backend/tests/test_catalogue_growth.py` (yeni dosya) Adım 4/22'nin aynı test kalıbını bu migration için tekrarlıyor: (1) her kasın artık en az 4 resmi doğrudan egzersizi olduğunu doğrulayan sorgu, (2) altı yeni egzersizden temsili bir örneklemin arama → kayıt → hacimde sayılma zincirini doğrulayan parametrize testler (ayrıca `name_tr == name` olduğunu da doğruluyor), (3) migration roundtrip testi, (4) FK koruması testi.
- `backend/tests/test_exercises.py`: sabit sayılar `46`→`96` güncellendi; `test_returns_the_seeded_catalogue` artık `?limit=100` kullanıyor çünkü katalog (96) varsayılan sayfa boyutunu (50) aştı; `test_matches_in_the_middle_of_a_name` (`q=deadlift`) artık `4` bekliyor (yeni "Single-Leg Romanian Deadlift" ve "Sumo Deadlift" de eşleşiyor) — geri kalan arama/filtre testleri elle tek tek kontrol edildi, katalog boyutundan bağımsız çalışıyorlar.
- `backend/tests/test_catalogue_coverage.py` ve `test_catalogue_expansion.py`'deki sabit sayılar da yeni toplama göre güncellendi (kendi migration'larının izole geri alma testleri artık `91` ve `75` bekliyor — her biri SADECE kendi migration'ının satırlarını çıkarıyor, üzerine binen sonraki migration'ların satırlarına dokunmuyor).

Doğrulama: Aynı gerçek PostgreSQL + Alembic zinciri kullanıldı.
1. `alembic upgrade head` — temiz; `alembic downgrade -1` + tekrar `upgrade head` ile geri/ileri alma elle doğrulandı (46↔96, veri kaybı yok).
2. **`pytest` — 334 test, tamamı geçti** (325 önceki + bu adımın 9 yeni testi).
3. `ruff check .` (backend'in tamamı) — temiz. `mypy app` (52 dosya, strict) ve değiştirilen/eklenen dört dosya — temiz.
4. Altı temsili yeni egzersizin arama+kas+ekipman filtresiyle tam olarak birebir eşleştiği doğrudan SQL ile ayrıca teyit edildi.

Sınır: Bu adım da yalnızca katalog verisini genişletti, şema veya servis koduna dokunmadı. Site 83 sayfa/1500+ egzersiz içeriyor; bu adım yalnızca ilk sayfaların (kas başına ~10 egzersiz) taranmasıyla sınırlı kaldı — daha fazla derinlik (örn. her kas için sitenin TÜM sayfaları) ayrı bir talep olmadan yapılmadı. Kullanıcının egzersiz seçmesi/loglaması dışında (yeni 50'nin arama+kayıt+hacim zinciri doğrulandı) telefonda görsel doğrulama yapılmadı.

### Adım 24: Egzersiz seçicideki son Türkçe isim kalıntısının İngilizceleştirilmesi — 14 Eylül 2026

- Talep: Kullanıcı "haraketlerin hepsi ingilizce olacak" dedi — Adım 23'ün kapsamını (sadece hacim ekranı) tüm uygulamaya genişleten bir talep.
- Durum tespiti: `mobile` genelinde `name_tr` kullanımı taranınca yalnızca İKİ yerin egzersiz/kas adı gösterirken hâlâ Türkçe kullandığı görüldü: `exercise-picker.tsx` (iki satır: seçilen egzersizin adı ve listedeki her satırın başlığı) ve `checkin.tsx` (readiness ekranındaki kas ağrısı seçici, ama bu `muscle_groups.name_tr` — "hareketler" değil "kaslar", kullanıcının kelimesi kapsamında değil, dokunulmadı). Ayrıca backend'in antrenman/program API'lerinin (`workouts/service.py`, `programs/service.py`) zaten yalnızca `exercise.name` (İngilizce) döndürdüğü doğrulandı — yani antrenman detayı, geçmiş ve şablon ekranları zaten hep İngilizce gösteriyordu; tek eksik yer egzersiz seçiciydi.
- Düzeltme: `exercise-picker.tsx`'te iki satır (`exercise.name_tr ?? exercise.name` → `exercise.name`, aynısı liste satırı başlığında) değiştirildi. Backend verisine veya `name_tr` alanının kendisine dokunulmadı — yalnızca görünüm katmanı, Adım 23'teki aynı desen.
- Bu, kullanıcının aynı mesajdaki ikinci isteğinin (dış kaynaktan 50 yeni egzersiz) uygulanma şeklini de belirledi: bkz. Adım 25.

Doğrulama: `npx tsc --noEmit` ve `npx eslint "app/(app)/workout/exercise-picker.tsx"` (proje genelinde) — temiz. `node --test tests/lifecycle.test.cjs` (bu ekranın `depositPickedExercise` çağrısını dolaylı test eden dosya) — 3/3 geçti. Bu ekranın kendi `.test.cjs` dosyası yok (JSX döndüren bir ekran — Adım 20/21/23 ile aynı durum), gerçek tsc/eslint ve elle inceleme ile doğrulandı.

Sınır: Yalnızca egzersiz seçici değişti. `checkin.tsx`'teki kas ağrısı seçici hâlâ Türkçe (`muscle_groups.name_tr`) — kullanıcı özellikle "hareketler" dediği için kapsam dışı bırakıldı, isterse ayrı bir talep olarak ele alınabilir. `exercises.name_tr` verisinin kendisi (Türkçe arama için) hiçbir yerde silinmedi veya değiştirilmedi.

### Adım 23: Haftalık hacim ekranındaki kas adlarının İngilizceleştirilmesi — 14 Eylül 2026

- Talep: Kullanıcı doğrudan "volume kısmında başlıklar Türkçe, onları İngilizce olacak" dedi.
- Durum tespiti: `mobile/app/(app)/(tabs)/volume.tsx` incelendiğinde ekrandaki BÜTÜN sabit metinlerin (hafta başlığı, "Upper body"/"Lower body"/"Core" bölge başlıkları, durum etiketleri — `Not trained`/`Below MEV`/`Optimal`/`High`/`Over MRV`, "Why am I not growing?" girişi, alt açıklama metni) zaten İngilizce olduğu görüldü. Ekrandaki TEK Türkçe öğe, her kas satırının başlığında gösterilen `muscle.name_tr` alanıydı (`MuscleWeeklyVolume` tipinde `name` (İngilizce) ve `name_tr` (Türkçe) olarak iki alan zaten mevcuttu — API zaten ikisini de gönderiyordu). Bu tam olarak Adım 16'nın "Sınır" notunda ve Bölüm 8 madde G'de kayıtlı bırakılan bilinen tutarsızlıktı: teşhis ekranı Adım 16'dan beri İngilizce kas adı kullanırken, hacim ekranı hâlâ Türkçe kullanıyordu.
- Düzeltme: `MuscleRow` bileşenindeki tek satır (`{muscle.name_tr}` → `{muscle.name}`) değiştirildi. Başka hiçbir dosyaya dokunulmadı — kullanıcı özellikle "volume kısmı" dedi, egzersiz seçici (`exercise-picker.tsx`) ve check-in ekranındaki (`checkin.tsx`) kas adları hâlâ Türkçe (`name_tr`) gösteriyor, kasıtlı olarak bu adımın kapsamı dışında bırakıldı.

Doğrulama: `npx tsc --noEmit` (proje genelinde) — temiz. `npx eslint "app/(app)/(tabs)/volume.tsx"` — temiz. Bu dosya için özel bir `.test.cjs` yok (JSX döndüren bir ekran bileşeni — Adım 20'deki `AuthContext.tsx` ve Adım 21'deki `preferences.tsx` ile aynı durum), bu yüzden gerçek tsc/eslint ve elle inceleme ile doğrulandı. Değişiklik tek satırlık, tipi zaten var olan bir alana (`muscle.name`) işaret ediyor, yeni bir API çağrısı veya tip değişikliği gerekmedi.

Sınır: Yalnızca haftalık hacim ekranındaki kas adları değişti. Egzersiz seçici ve check-in ekranındaki kas adları hâlâ Türkçe — bunlar ayrı bir talep olmadan değiştirilmedi. Uygulamanın geri kalanının (teşhis bulgu metinleri, diğer ekranlar) tam kapsamlı Türkçe/İngilizce tutarlılığı hâlâ Bölüm 13 madde 3'teki ayrı ürün kararına bağlı.

### Adım 22: Egzersiz kataloğunun genişletilmesi — 13 Eylül 2026

- Talep: Kullanıcı Bölüm 8'in tamamı kapandıktan sonra doğrudan "spor hareket/egzersizi çok az, fazlalaştıralım, yeni egzersizler ekle" dedi. Bu, önceki adımların aksine kod tabanında bulunan bir hata değil, doğrudan bir içerik/kapsam talebi.
- Durum tespiti: Katalog 25 egzersizden oluşuyordu (20 taban + Adım 4'te eklenen 5). 17 kas grubundan 11'i (abs, biceps, calves, forearms, front_delts, lower_back, obliques, rear_delts, side_delts, traps, triceps) yalnızca TEK bir doğrudan (primary) egzersize sahipti — o egzersizin gerektirdiği ekipmana erişimi olmayan veya çeşitlilik isteyen bir kullanıcının o kası doğrudan çalıştırıp haftalık hacme yansıtacak başka hiçbir yolu yoktu. Ayrıca gerçek antrenman programlarında yaygın olan birkaç temel hareket (Hip Thrust, Bulgarian Split Squat, Push-Up, Dip) katalogda hiç yoktu.
- Düzeltme: Yeni bir Alembic migration'ı (`946401aa1328`), dondurulmuş `schema_v1.sql`'e veya Adım 4'ün migration'ına dokunmadan, Adım 4'teki (`c6a42e8b91df`) aynı kalıbı izleyerek 21 yeni egzersiz ekliyor: sabit UUID'ler (geri alma bir kullanıcının kendi özel egzersiziyle asla çakışmasın diye), her egzersiz için en az bir `primary` kas bağlantısı, mevcut editoryal kural (effectiveness 1-5 arası bir yargı, ölçüm değil; `secondary` satırlar doğrudan set sayımına girmiyor). Yeni egzersizler öncelikle tek seçenekli 11 kası hedefledi (her biri şimdi en az 2 doğrudan seçeneğe sahip), artı eksik olan birkaç yaygın bileşik hareket. Sonuç: **46 egzersiz**, 17 kasın tamamında en az 2 doğrudan seçenek.
  - Eklenenler: Hip Thrust (glutes), Bulgarian Split Squat + Walking Lunge (quads), Seated Cable Row + T-Bar Row (upper_back/lats), Push-Up (chest), Dip + Close-Grip Bench Press + Overhead Tricep Extension (triceps), Barbell Curl + Hammer Curl (biceps), Farmer's Carry (forearms), Face Pull (rear_delts), Arnold Press (front_delts), Cable Lateral Raise (side_delts), Seated Calf Raise (calves), Hanging Leg Raise + Cable Crunch (abs), Russian Twist (obliques), Back Extension (lower_back), Barbell Shrug (traps).
- `backend/tests/test_catalogue_expansion.py` (yeni dosya) Adım 4'ün kendi test dosyasının (`test_catalogue_coverage.py`) aynı kalıbını bu migration için tekrarlıyor: (1) artık her kasın en az 2 resmi doğrudan egzersizi olduğunu doğrulayan bir sorgu, (2) altı yeni egzersizden temsili bir örneklemin arama → günlüğe kaydetme → haftalık hacimde sayılma zincirinin uçtan uca çalıştığını doğrulayan parametrize testler, (3) migration'ın geri/ileri alınabilirliğini ve orijinal satırların korunduğunu doğrulayan bir roundtrip testi, (4) bir egzersiz bir antrenmanda kullanılmışken migration'ın geri alınmaya çalışılmasının FK kısıtlamasıyla reddedildiğini doğrulayan bir test (Adım 4'teki `test_downgrade_refuses_to_remove_logged_exercises`'ın birebir aynısı, yeni bir egzersiz id'siyle).
- `backend/tests/test_exercises.py` ve `backend/tests/test_catalogue_coverage.py`'deki sabit `25`/`20` sayıları yeni toplamlara (`46`/`41`) güncellendi; bu testlerin geri kalanı (arama, filtre, sayfalama, detay) katalog boyutundan bağımsız çalıştığı için değişmedi — tek tek kontrol edildi.
- Mobil tarafta değişiklik gerekmedi: egzersiz seçici ve arama ekranları zaten `GET /exercises`'i jenerik şekilde okuyor, katalog boyutunu veya belirli bir egzersiz listesini hiçbir yerde sabit kodlamıyor (mobil kod ve testler bu adımda taranıp doğrulandı).

Doğrulama: Bu adımda Adım 18'den beri bu cloud sandbox'ta kurulu olan gerçek PostgreSQL + Alembic zinciri kullanıldı (servis yeniden başlatma sonrası durmuştu, yeniden başlatıldı).
1. `alembic upgrade head` — yeni migration temiz şekilde uygulandı; `alembic downgrade -1` ardından tekrar `upgrade head` ile geri/ileri alma elle doğrulandı (25↔46 katalog boyutu, veri kaybı yok).
2. **`cd backend && pytest` — 325 test, tamamı geçti** (önceki 316 + bu adımın 9 yeni testi).
3. `ruff check .` (backend'in tamamı) — temiz.
4. `mypy app` (52 dosya, strict) ve değiştirilen/eklenen dört dosya (`tests/test_exercises.py`, `tests/test_catalogue_coverage.py`, `tests/test_catalogue_expansion.py`, yeni migration) — temiz. (`tests/test_programs.py` ve `tests/test_template_save_requests.py`'deki mevcut, bu adımdan önce de var olan tip hataları bu adımın kapsamı dışında, dokunulmadı.)
5. Migration'ın SQL'i elle sorgulanarak da doğrulandı: 46 egzersizin her birinin en az bir `primary` kas bağlantısı olduğu, 17 kasın hepsinin artık ≥2 doğrudan seçeneğe sahip olduğu, ve altı temsili yeni egzersizin arama sorgusuyla (Türkçe aksansız dahil) tam olarak birebir eşleştiği doğrudan SQL ile teyit edildi.

Sınır: Bu adım yalnızca katalog verisini genişletti; `exercises`/`exercise_muscle_groups` şemasına veya arama/filtre servis koduna dokunmadı. Effectiveness puanları ve hangi ikincil kasların dahil edildiği editoryal birer karar — RP literatürüyle bire bir kalibre edilmiş değil, Adım 4'teki mevcut satırlarla aynı standartta. Telefonda görsel doğrulama (yeni egzersizlerin seçici ekranında göründüğü, aranabildiği) yapılmadı; gerçek cihazda "Preferences yerine egzersiz seçiciye gir, 'hip thrust' ara, sonucun göründüğünü doğrula" gibi bir kontrol öneriliyor. Kataloğun daha da genişletilmesi (örn. makine varyasyonları, tek taraflı hareketler) veya kullanıcıların kendi özel egzersizlerini eklemesi (şema zaten `created_by` ile buna hazır, `created_by` dolu satırlar için bir API henüz yok) bu adımın kapsamı dışında.

### Adım 21: Seyahat sırasında saat dilimi güncellemesi için arayüz eksikliği — 13 Eylül 2026

- Araştırma: Bölüm 8 madde H'nin son maddesindeki "saat dilimi ayrışması" bulgusu incelendiğinde ikiye ayrıldığı görüldü:
  1. **Somut ve belirsiz olmayan bir eksiklik:** `backend/app/domains/users/schemas.py`'deki `UserUpdate.timezone` alanı ve `PATCH /users/me` zaten `timezone` değişikliğini destekliyor — kodun kendi yorumu bile bunu açıkça söylüyor ("Users travel and relocate, so the timezone has to be changeable... changing it re-slices past workouts into weeks under the new zone, which is the intended behaviour"). Ama mobil tarafta kayıttan sonra bunu değiştirecek HİÇBİR arayüz yok: `mobile/app/(app)/profile/edit.tsx` kendi yorumunda bunu açıkça "later task"e bırakmış, `preferences.tsx` ve `personal-details.tsx` içinde de saat dilimi alanı bulunmadı.
  2. **Tasarım gereği olabilecek, ayrı bir gerilim:** `index.tsx`'teki geçmiş listesi günleri CİHAZIN o anki yerel saatine göre gruplarken (`isSameLocalDay`, `sectionTitleFor` — düz JS `Date` ile), backend'deki haftalık hacim analizleri kullanıcı profilindeki SABİT `timezone`'u kullanıyor (`AT TIME ZONE users.timezone`). Bu ikisi seyahat sırasında ayrışabilir, ama bu bir hata olmak zorunda değil — profil saat dilimi kasıtlı olarak "kullanıcının evi neresi" sorusuna, cihaz saat dilimi de "şu an nerede" sorusuna cevap veriyor olabilir.
  - Kullanıcıya bu ayrım `AskUserQuestion` ile soruldu; yalnızca (1)'i, yani eksik ayarı eklemek seçildi — (2) kasıtlı bir tasarım gerilimi olarak bırakıldı, otomatik uyuşmazlık tespiti/banner (ayrı bir seçenek olarak sunulmuştu) da bilinçli olarak reddedildi: kısa süreli seyahatteki bir kullanıcının haftalarının kendi ev saat dilimine göre sayılmaya devam etmesini istemesi de meşru bir tercih, uygulamanın bunu sormadan değiştirmemesi gerekiyor.
- Düzeltme: `mobile/app/(app)/profile/preferences.tsx`'e yeni bir "Timezone" bölümü eklendi. Kayıt ekranındaki (`(auth)/register.tsx`) aynı `Localization.getCalendars()[0]?.timeZone` deseni kullanılarak cihazın güncel saat dilimi okunuyor; profildeki değerden farklıysa "Use device timezone" düğmesi aktif, aynıysa "Up to date" yazıp devre dışı kalıyor (Weight unit bölümündeki chip'lerin aktif/pasif deseniyle birebir aynı). Basılınca `updateMe({ timezone })` ile `PATCH /users/me` çağrılıp `refreshProfile()` ile profil tazeleniyor; zaten var olan `UserProfile.timezone`/`UserUpdateInput` tipleri sayesinde yeni bir API yüzeyi gerekmedi. Hata durumunda satırın altında kısa bir metinle bildiriliyor (diğer chip'lerin aksine burada "önceki değerde kalma" görünür bir geri bildirim değil, bu yüzden hata sessizce yutulmadı).
- Kasıtlı olarak yapılmayanlar: Otomatik uyuşmazlık tespiti, banner veya bildirim yok — cihaz saat dilimi yalnızca "zaten güncel mi" durumunu göstermek için okunuyor, kullanıcıyı uyarmıyor veya tek başına hiçbir şeyi değiştirmiyor. Geçmiş listesinin cihaz yerel saatine göre gruplanması değiştirilmedi (yukarıdaki madde 2, tasarım kararı olarak bırakıldı).

Doğrulama: Bu değişiklik saf mantık içermiyor (bir string karşılaştırması ve mevcut bir API çağrısı), bu yüzden Adım 20'deki `AuthContext.tsx` değişikliğinde izlenen aynı emsal izlendi — yeni bir test dosyası eklenmedi, gerçek statik araçlara ve elle incelemeye dayanıldı:
1. `npx tsc --noEmit` (proje genelinde) — **temiz, sıfır hata**.
2. `npx eslint .` (proje genelinde, `expo lint` ile aynı yapılandırma) — **temiz**.
3. `node --test tests/*.cjs` (9 dosyanın tamamı, `resolve-active-workout.test.cjs` dahil) — **tamamı geçti**, bu adım mevcut hiçbir testi bozmadı.
4. Elle inceleme: `updateMe`/`refreshProfile` çağrı sırası ve `try/catch/finally` deseni `handleSelectUnit`'teki mevcut desenle birebir aynı tutuldu; `colors.danger` (mevcut tema rengi, yeni renk eklenmedi) hata metni için kullanıldı.

Sınır: Bu adım yalnızca profildeki saat dilimini güncelleyecek eksik arayüzü ekledi. Geçmiş listesinin cihaz-yerel gruplandırması ile backend'in profil-tabanlı hafta dilimlemesi arasındaki gerilim bilinçli olarak dokunulmadan bırakıldı — bu bir hata değil, hangi davranışın "doğru" olduğu ürün kararı gerektiriyor (Bölüm 13'teki karar başlıklarına eklenebilir). Otomatik tespit/banner kasıtlı olarak kapsam dışı bırakıldı. Gerçek cihazda "saat dilimini değiştir, Preferences ekranına gir, düğmenin göründüğünü ve basıldığında profildeki değerin güncellendiğini doğrula" senaryosunun elle test edilmesi öneriliyor. Bölüm 8 madde H'nin dört maddesinin tamamı (Adım 18-21) artık kapalı.

### Adım 20: Aktif seans işaretçisinin hesap değişiminde eski kullanıcıda kalması — 13 Eylül 2026

- Araştırma: Mobil tarafta `SecureStore`'a yazılan her şey tarandı (`src/workout/activeWorkout.ts`, `restPreference.ts`, `readinessPreference.ts`, `templateSaveRequest.ts`, `src/nutrition/macroAutoAdjustPreference.ts`, `src/api/tokens.ts`). Üç farklı kalıp bulundu:
  1. **Aktif antrenman işaretçisi** (`bodytrack.active_workout_id`, sabit anahtar): gerçek bir hata. `AuthContext.tsx`'teki `signOut()` yalnızca token'ları temizliyordu (`clearTokens()`), bu işaretçiye hiç dokunmuyordu. Kullanıcı A antrenmanı bitirmeden çıkış yapıp aynı cihazda Kullanıcı B girdiğinde, B'nin ana ekranı A'nın seans id'sini okumaya çalışıyordu.
  2. **Tercihler** (`rest_seconds`, `readiness_checkin_enabled`, `macro_auto_adjust_enabled`): incelendi, hata değil — kendi kod yorumları bunların kasıtlı olarak cihaz bazlı UI davranışları olduğunu, kullanıcı verisi olmadığını açıkça belirtiyor (örn. "Off is a per-device preference"). Bu adımın kapsamı dışında bırakıldı; hesap değişse de sıfırlanmaması tasarım gereği.
  3. **Bekleyen "şablon olarak kaydet" isteği** (`templateSaveRequest.ts`): `workoutId`'ye göre anahtarlanıyor (UUID). İncelendi, pratikte risksiz — farklı bir hesabın yeni bir antrenmanı aynı UUID'yi asla almayacağı için eski bir hesabın bekleyen isteği hiçbir zaman okunmuyor. Değişiklik gerekmedi.
- Asıl bulgu (1)'in kendisi de eksikti: `app/(app)/(tabs)/index.tsx`'teki `load()`, saklı işaretçi geçersiz çıktığında (silinmiş/bitmiş/başka hesaba ait — üçü de sunucu tarafında aynı şekilde, "workout not found" olarak görünüyor, çünkü sahiplik sunucuda zorunlu kılınıyor) yalnızca `null`'a düşüyordu; `GET /workouts/active` ile MEVCUT hesabın kendi gerçek aktif antrenmanını tekrar kontrol etmiyordu — oysa "saklı işaretçi yok" dalı bunu zaten yapıyordu.
- Düzeltme: `AuthContext.tsx`'teki `signOut()`'a `clearActiveWorkout()` eklendi; `client.ts`'deki zorunlu oturum sonlandırma da (`expireSession()` → `onSessionExpired` callback'i) aynı şekilde güncellendi — ama bu çağrı bilerek `client.ts`'e değil, `AuthContext.tsx`'teki `onSessionExpired` handler'ına eklendi (aşağıdaki "test harness'ı bozdu" notuna bakın). `index.tsx`'teki `load()`'daki reconciliation mantığı yeni bir saf modüle, `src/workout/resolveActiveWorkout.ts`'e çıkarıldı (aynı `restPreference.ts`/`templateSaveRequest.ts` gibi — ekrandan ayrı, test edilebilir); saklı işaretçi geçersiz çıktığında artık sunucudaki `getServerActiveWorkout()`'a da düşüyor, tıpkı "saklı işaretçi hiç yok" dalı gibi.
- Test harness notu: İlk denemede `clearActiveWorkout()`'u doğrudan `client.ts`'e eklemiştim (`expireSession()` içine). Bu, `tests/session.test.cjs`'in gerçek test harness'ını kırdı: harness `client.ts`'i `require` mock'uyla yükleyip yalnızca `src/api/tokens` ve `src/config`'i taklit ediyor; `activeWorkout.ts` transitive olarak `expo-secure-store` (bir npm paketi) import ettiği için harness "Unexpected import: expo-secure-store" hatasıyla **16/16 testi başarısız** yaptı. Bunun yerine temizleme mantığını `AuthContext.tsx`'e taşıdım — `client.ts` yalnızca token bilen saf bir HTTP katmanı olarak kaldı, `onSessionExpired` zaten tam bu amaçla var olan bir hook. Bu, hem katmanlamayı daha temiz tutuyor hem de mevcut testi bozmuyor.

Doğrulama: Bu adımda mobil tarafta bu oturumda ilk kez **gerçek `npm ci` + gerçek `tsc --noEmit` + gerçek `expo lint` (ESLint)** çalıştırıldı (önceki mobil adımlarda yalnızca `tsc --noResolve` gibi sözdizimi taramaları veya elle inceleme vardı). Sonuçlar:
1. `npx tsc --noEmit` — **temiz, sıfır hata** (proje genelinde; Adım 1'de bahsedilen 5 eski hata artık dosyalarda yok, muhtemelen aradaki adımlarda düzeltilmiş).
2. `npx eslint .` (`expo lint` ile aynı yapılandırma) — **temiz**.
3. `node --test tests/*.test.cjs` — **81/81 test geçti**, bunun 8'i bu adımda eklenen `tests/resolve-active-workout.test.cjs`. Yeni testler arasında asıl senaryoyu birebir simüle eden bir test var: "bob" hesabının bitirmediği bir antrenmanın id'si cihazda kalıyor, "alice" girdiğinde bu id temizleniyor VE alice'in kendi (başka bir cihazda başlattığı) aktif antrenmanı sunucudan doğru şekilde bulunup gösteriliyor — düzeltme öncesi kodda bu ikinci kısım (alice'in kendi antrenmanının bulunması) çalışmazdı.
4. `AuthContext.tsx`'teki `signOut`/`onSessionExpired` değişiklikleri için otomatik test yazılmadı: bu dosya bir React bileşeni/hook'u (JSX döndürüyor), ve bu projedeki mevcut `.test.cjs` harness'ları yalnızca JSX içermeyen saf `.ts` modülleri (transpile + vm.runInNewContext) yüklemek üzere tasarlanmış — bunun için yeni bir JSX-uyumlu test altyapısı kurmak, bu küçük ve düşük riskli değişiklik için orantısız olurdu. Bunun yerine gerçek `tsc`/`eslint` (her ikisi de temiz) ve elle dikkatli inceleme yapıldı.

Sınır: Bu adım yalnızca aktif antrenman işaretçisini kapsıyor. Tercihler (rest/readiness/macro-auto-adjust) kasıtlı olarak cihaz bazlı bırakıldı — yukarıya bakın. `templateSaveRequest.ts` incelendi, değişiklik gerekmedi. Bölüm 8 madde H'nin son maddesi (saat dilimi ayrışması, seyahat sırasında) hâlâ açık. Gerçek cihazda "A ile antrenman başlat, bitirmeden çıkış yap, B ile gir, ana ekranın A'nın antrenmanını göstermediğini doğrula" senaryosunun elle test edilmesi öneriliyor.

### Adım 19: Eşzamanlı refresh çağrılarında token rotasyonunun atomik olmaması — 13 Eylül 2026

- Sorun: `backend/app/domains/auth/service.py`'deki `refresh()`, aynı Adım 18'deki gibi kilitsiz bir "oku, kontrol et, yaz" akışı izliyordu: sunulan refresh token'ı `token_hash`'e göre okuyor, `revoked_at`'in `NULL` olduğunu doğruluyor, sonra `revoked_at`'i işaretleyip yeni bir çift üretip commit ediyordu. Bu akışın güvenlik amacı açık: rotasyondan sonra AYNI token tekrar sunulursa (`revoked_at` artık dolu), bu "çalınmış ve tekrar oynatılmış" sayılıp kullanıcının hesabındaki TÜM token'lar iptal ediliyor. Ama bu tespit, iki istek aynı hâlâ-geçerli token'ı gerçekten eşzamanlı sunduğunda çalışmıyordu: ikisi de `revoked_at`'i `NULL` olarak okuyor (henüz hiçbiri commit etmemişken), ikisi de başarıyla rotasyon yapıp kendi yeni çiftini üretiyor, ikisi de commit ediyordu — aynı girdiden iki canlı token çifti, ve "zaten kullanılmış" dalı hiçbirinde tetiklenmiyordu. Bu, mobil istemcinin kendi single-flight'ının (aynı istemcideki eşzamanlı refresh çağrılarını tek çağrıya indirger) koruyamayacağı tam olarak bu senaryo: ikinci bir cihaz, ya da ağ hatası sonrası düşen bir yanıtın istemci tarafından tekrar denenmesi.
- Düzeltme: Adım 18'deki mekanizmanın aynısı — `refresh()`'teki `SELECT`'e `.with_for_update()` eklendi. `token_hash` `unique` olduğu için bu kilit yalnızca sunulan o tek token satırını etkiliyor, başka hiçbir kullanıcının veya token'ın satırına dokunmuyor; birbirinden bağımsız refresh çağrıları tamamen paralel çalışmaya devam ediyor. Kilit, ikinci isteğin aynı token'ı okumasını birincinin **tüm** işlemi (revoke + yeni çift üretme + commit) bitene kadar bekletiyor; böylece ikinci isteğin okuması her zaman güncel `revoked_at`'i görüyor ve doğru şekilde "zaten kullanıldı" dalına düşüyor — bu da o kullanıcının o anda "kazanan" isteğin az önce aldığı yeni çift dahil TÜM token'larını iptal ediyor. Bu, standart OAuth2 refresh-rotation pratiğiyle (aynı token'ın iki kez sunulması güvenlik açısından çalınmadan ayırt edilemez) tutarlı, kasıtlı olarak agresif bir davranış; mobil istemcinin kendi single-flight'ı zaten aynı istemciden gelen kazara tekrarları önlüyor.
- `backend/tests/test_auth.py`'e `TestConcurrentRefresh` sınıfı eklendi. Adım 18'de öğrenilen dersle aynı: düz bir `asyncio.gather` testi elle denendi ve kilit olmadan da geçtiği görüldü (lokal veritabanı yeterince hızlı olduğu için event loop iki isteği gerçekten çakıştırmıyor) — bu yüzden `monkeypatch` ile `_issue_token_pair`'in içine gerçek bir `await asyncio.sleep(0.3)` enjekte edilip yarış penceresi zorlandı.

Doğrulama: Adım 18'de bu sandbox'a kurulan gerçek PostgreSQL + venv ortamı kullanıldı.
1. Yeni testi düzeltmeyle çalıştırdım: **geçti** — biri 200 (rotasyon), diğeri 401 (replay tespiti) dönüyor, ve rotasyondan sonra o kullanıcı için `revoked_at IS NULL` olan sıfır token kaldığı doğrulandı (kazananın yeni çifti dahil hepsi iptal edildi).
2. `.with_for_update()`'i geçici olarak kaldırıp aynı testi tekrar çalıştırdım: beklendiği gibi **başarısız oldu** — her iki istek de 200 döndü (`[200, 200] != [200, 401]`), yani replay tespiti tamamen atlatıldı. Bu, yarışın gerçekten var olduğunu ve testin onu gerçekten yakaladığını kanıtlıyor. Kilidi geri koydum.
3. **`pytest` — 316 test, tamamı geçti** (bu adımın yeni testi dahil, Adım 18'in 315'i üzerine).
4. `ruff check .` (backend'in tamamı) — temiz. `mypy` değişen iki dosyada (`app/domains/auth/service.py`, `tests/test_auth.py`) — temiz.

Sınır: Kilit yalnızca `refresh()`'i kapsıyor; `register`/`login` zaten her çağrıda yeni bir satır ekliyor, aralarında bir "oku sonra yaz" yarışı yok. Bölüm 8 madde H'nin geri kalanı (aktif seans işaretçisinin cihaz yerine hesap bazlı olması, saat dilimi ayrışması) hâlâ açık. Bu düzeltmenin kabul edilen davranışsal maliyeti: istemci tarafında deduplike edilmemiş, aynı token'ı iki kez gönderen kazara bir ağ-seviyesi tekrar artık "çalınmış token" olarak yorumlanıp kullanıcıyı tüm cihazlardan çıkışa zorlayabilir — bu, standart refresh-rotation pratiğinin kabul ettiği bir risk (mobil istemcinin single-flight'ı bunu zaten önlüyor), kilidin eklediği yeni bir davranış değil; kilit öncesinde bu senaryo yalnızca sessizce iki token çifti üretiyordu, hangisinin doğru olduğu belirsiz kalıyordu.

### Adım 18: Eşzamanlı set mutasyonlarında denormalize toplamların kaybolması — 13 Eylül 2026

- Sorun: `backend/app/domains/workouts/service.py`'deki `add_set`/`update_set`/`delete_set` her mutasyondan sonra `total_volume_kg`/`total_sets`'i sıfırdan yeniden hesaplıyor (`_recalculate_totals`) — ama bu hesaplama kilitsiz bir "oku, hesapla, yaz" işlemi. Aynı antrenmana iki eşzamanlı istek (iki cihaz, ağ hatası sonrası istemci tekrar denemesi, "set ekle" düğmesine art arda hızlı dokunma) geldiğinde: her iki istek de kendi setini ekleyip kendi anlık `SUM`'ını hesaplıyor, ikisi de commit ediyor — ama son commit önceki commit'i eziyor. Setlerin kendisi kaybolmuyor (ikisi de `sets` tablosunda duruyor), yalnızca `workouts.total_volume_kg`/`total_sets` sessizce ikinci isteğin katkısını kaybediyor; bir sonraki mutasyona kadar (o da sıfırdan yeniden hesapladığı için kendi kendini düzeltiyor) geçmiş ekranı yanlış hacim gösteriyor. Aynı şekilde `_next_set_number` de kilitsiz "oku, hesapla, yaz" biçiminde: iki eşzamanlı ekleme aynı egzersize aynı `set_number`'ı (örn. ikisi de 1) verebiliyordu.
- Düzeltme: `_load_owned_workout`'a `for_update: bool = False` parametresi eklendi; `True` olduğunda `SELECT ... FOR UPDATE` ile antrenman satırına satır kilidi alınıyor. `add_set`, `update_set`, `delete_set` artık bu kilidi kullanıyor. Kilit, ikinci isteğin antrenman satırını okumasını birinci isteğin **tüm** işlemi (ekleme + yeniden hesaplama + commit) bitene kadar bekletiyor; böylece ikinci isteğin kendi yeniden hesaplaması her zaman birinci isteğin setini de içeren güncel veriden başlıyor. Aynı mekanizma `_next_set_number` yarışını da kapatıyor, çünkü artık aynı antrenmana yazan iki istek asla aynı anda çalışmıyor. Kapsam bilinçli olarak dar tutuldu: yalnızca set mutasyonları kilitleniyor; `create_workout`/`close_dangling_workouts` (Bölüm 8 madde H'nin farklı bir maddesi — aktif seans işaretçisi) ve `update_workout`/`delete_workout` (toplamlara dokunmuyor) bu adımın kapsamı dışında bırakıldı.
- `backend/tests/test_workouts.py`'e `TestConcurrentSetMutations` sınıfı eklendi. İlk yazılan sürüm yalnızca `asyncio.gather` ile iki isteği aynı anda ateşliyordu — ama bu **yanıltıcı** çıktı: lokal, alt-milisaniyelik bir veritabanına karşı event loop, ikinci isteğin ilk `await`'ine hiç fırsat vermeden birinci isteğin tüm handler'ını bitirebiliyor, yani test kilit olmadan da geçiyordu (kilidi elle geri alıp doğruladım — aşağıdaki Doğrulama bölümüne bakın). Bunun yerine `monkeypatch` ile `_recalculate_totals`/`_next_set_number`'ın içine gerçek bir `await asyncio.sleep(0.3)` enjekte edilerek yarış penceresi zamanlayıcının kaçıramayacağı kadar genişletildi — bu iki test artık düzeltme olmadan **güvenilir biçimde başarısız**, düzeltmeyle **güvenilir biçimde başarılı** oluyor. Üçüncü, gecikmesiz bir `asyncio.gather` testi de temel bir uçtan uca kontrol olarak bırakıldı ama regresyon kanıtı olarak değil, sınıfın kendi docstring'inde bu açıkça belirtiliyor.

Doğrulama: Bu oturumda ilk kez **gerçek PostgreSQL 16 bu cloud sandbox'ın içine kuruldu** (`apt-get install postgresql`, bilgisayarınızdaki shell hâlâ devre dışı olduğu için) — bodytrack rolü/veritabanı oluşturuldu, backend'in tüm bağımlılıkları (`requirements-dev.txt`) bir Python 3.12 venv'e kuruldu, `alembic upgrade head` ile şema migrate edildi. Bunun üzerinden:
1. **`cd backend && pytest` — 315 test, tamamı gerçekten geçti** (bu adımın 3 yeni testi dahil).
2. Kilidi geçici olarak `for_update=False` yapıp yalnızca yeni 2 deterministik testi tekrar çalıştırdım: ikisi de beklendiği gibi **başarısız oldu** (`set_number` testi `[1, 1] != [1, 2]` ile patladı — yarışın gerçekten var olduğunu ve testin onu gerçekten yakaladığını kanıtlıyor). Kilidi geri koyup tam paketi tekrar çalıştırdım, 315/315 yine geçti.
3. `ruff check .` (backend'in tamamı) — temiz.
4. `mypy app` (52 dosya, strict mod) ve `mypy tests/test_workouts.py` — temiz.
Bu, bu oturumda projenin kendi standardını (gerçek pytest + Ruff + mypy strict) ilk kez tam karşılayan adım. Mobil tarafta değişiklik yok, bu adımın kapsamı yalnızca backend.

Sınır: Bu adım yalnızca aynı antrenmana yazan set mutasyonlarını kilitliyor. Bölüm 8 madde H'nin geri kalanı (çoklu cihazdan refresh çağrısında sunucu atomikliği, aktif seans işaretçisinin cihaz yerine hesap bazlı olması, saat dilimi ayrışması) hâlâ açık, ayrı adımlar gerektiriyor. Kilit, aynı antrenmana saniyede çok sayıda eşzamanlı yazma gelen bir senaryoda (gerçekçi değil — bu bir tek-kullanıcı antrenman kaydı akışı) istekleri sıraya sokar; bu, kabul edilebilir bir gecikme, veri kaybı değil.

### Adım 17: Referans aralığı olmayan kas için yanlış "optimal" durumu — 13 Eylül 2026

- Sorun: `backend/app/domains/analytics/service.py` içindeki `_classify()` fonksiyonu, bir kasın MEV/MAV/MRV (Renaissance Periodization referans değerleri) yayınlanmamışsa direkt set sayısını `"optimal"` olarak sınıflandırıyordu. Bu yanlış bir hüküm: "optimal" sayının gerçek bir aralığın içinde olduğunu iddia eder, oysa burada karşılaştırılacak bir aralık yok. Şu an tüm 17 tohum kas için üç değer de mevcut olduğundan hata hiçbir zaman gerçek veride tetiklenmiyordu — ama yeni bir kas üç değer olmadan eklenirse (örn. bilimsel literatürde henüz net MEV/MAV/MRV'si olmayan bir kas grubu) sessizce yanlış bir "iyi gidiyorsun" sinyali verirdi.
- Backend: `VolumeStatus` Literal'ine yeni bir üye eklendi: `"no_reference"`. `_classify()` artık `mev`/`mav`/`mrv`'den herhangi biri `None` ise (üçü de dolu olmalı, kısmi veri de yetersiz kabul ediliyor) `"no_reference"` döndürüyor; sıfır set durumu (`"untrained"`) bu kontrolden önce, değişmeden duruyor.
- Mobil: `mobile/src/api/analytics.ts`'teki `VolumeStatus` tipi backend ile eşleşecek şekilde güncellendi. `mobile/src/theme.ts`'e `statusColors.no_reference` (nötr gri, `textMuted` ile aynı ton — kasıtlı olarak "optimal" yeşili değil) ve `statusLabels.no_reference` ("No reference range") eklendi. `mobile/app/(app)/(tabs)/volume.tsx` incelendi: `MuscleRow` ve `LandmarkBar` bu haritaları zaten jenerik okuyor (`LandmarkBar` zaten `mev`/`mav`/`mrv` `null` ise `null` döndürüyordu), bu yüzden ekranda kod değişikliği gerekmedi — yeni durum otomatik olarak doğru renk/etiketle görünecek.
- `backend/tests/test_weekly_volume.py`'e `_classify`'ı doğrudan (veritabanı olmadan) test eden yeni bir `TestClassify` sınıfı eklendi: sıfır set → `"untrained"` (landmark'lardan bağımsız), üç landmark'tan herhangi biri eksikse → `"no_reference"` (kısmi veri dahil dört kombinasyon test edildi), landmark'lar tamken eski davranışın değişmediği (`below_mev`/`optimal`/`high`/`above_mrv`) doğrulandı.

Doğrulama: `_classify()` saf bir fonksiyon — veritabanı, SQLAlchemy modeli veya FastAPI bağımlılığı gerektirmiyor. Bu oturumun cloud sandbox'ında fonksiyonun gövdesi dosyadan birebir kopyalanıp bağımsız bir Python betiğinde gerçekten çalıştırıldı: `test_weekly_volume.py::TestClassify`'daki 10 assert artı sınır-değer (`direct_sets == mev`, `== mav`, `== mrv` ve bir fazlası) için 5 ek assert, toplam **14/14 assert gerçekten geçti**. `schemas.py`, `service.py` ve `test_weekly_volume.py` için ayrıca `py_compile` ile sözdizimi kontrolü yapıldı (temiz). Mobil taraftaki değişiklikler (`analytics.ts`, `theme.ts`) yalnızca bir tip birleşimine ve iki obje literaline yeni birer anahtar ekliyor; `volume.tsx`'in bu anahtarları jenerik okuduğu kod okunarak doğrulandı. **Gerçek `pytest` (PostgreSQL'e karşı), `tsc --noEmit`, ESLint bu oturumda çalıştırılamadı** — bilgisayarınızdaki shell hâlâ devre dışı. `cd backend && pytest` ve `cd mobile && npm run typecheck && npm run lint` komutlarının gerçek makinede çalıştırılıp sonucun paylaşılması gerekiyor.

Sınır: Bu adım yalnızca sınıflandırma mantığını ve buna bağlı tip/renk/etiket haritalarını değiştirdi. Şu anki tohum verisinde hiçbir kasın `mev`/`mav`/`mrv`'si eksik değil, yani `"no_reference"` durumu bugün API'den hiç dönmüyor — bu adım gelecekte eksik landmark'lı bir kas eklendiğinde doğru davranışı garanti altına alıyor. Migration gerekmedi (mevcut nullable sütunlar zaten kullanılıyor).

### Adım 16: Teşhis bulgularında dil tutarlılığı — 13 Eylül 2026

- Karar: kullanıcıya soruldu, teşhis ekranının tamamını Türkçeleştirmek yerine (kapsamı büyük ve ayrı bir ürün kararı — bkz. Bölüm 13 madde 3) sadece dil karışıklığı hatası düzeltildi. `messages.ts`'in kendi dosya yorumu zaten "tam çeviri ayrı bir uygulama, bu dosyayı bozmadan gelecek" diyordu; bu adım o plana uydu.
- Sorun: `volume_below_mev` ve `volume_above_mrv` bulgu başlıkları Türkçe kas adını (`muscle_tr`, örn. "Göğüs") İngilizce cümlenin içine sıkıştırıyordu ("Göğüs: low recorded volume"). Mobil tarafta artık İngilizce `data.muscle` alanı kullanılıyor; `muscle_tr` veride duruyor ama şu an render edilmiyor — ileride gelecek çeviri uygulaması için ayrılmış durumda (dosyanın kendi yorumu bunu zaten söylüyordu).
- `muscles_untrained` bulgusunda backend yalnızca Türkçe isim listesi (`muscles`) gönderiyordu. Backend artık `muscles` alanını İngilizce isimlerle (volume_below_mev/above_mrv'deki `muscle` alanıyla aynı kaynak: `group.name`), `muscles_tr` alanını da Türkçe isimlerle (`group.name_tr`) gönderiyor — mevcut muscle/muscle_tr kalıbıyla tutarlı. Mobil taraf zaten `data.muscles`'ı okuyordu, değişiklik gerekmedi.
- `mobile/app/(app)/(tabs)/volume.tsx` (haftalık hacim ekranı) kas adlarını hâlâ Türkçe (`name_tr`) gösteriyor — bu, uygulama genelinde kas adlarının nasıl gösterileceğine dair değişmedi, kasıtlı olarak dokunulmadı. Yani teşhis ekranı artık "chest" diyor, hacim ekranı hâlâ "Göğüs" diyor; bu ekranlar-arası tutarsızlık ayrı bir konuşma başlığı (Bölüm 13 madde 3'ün bir parçası) olarak kalıyor, bu adımın kapsamında değildi.
- Backend testleri güncellendi: `test_diagnosis.py`'de `muscles_untrained` bulgusuna dair üç assert artık `data["muscles"]`'ın İngilizce, `data["muscles_tr"]`'ın Türkçe olduğunu kontrol ediyor. Mobilde `diagnosis.test.cjs`'e iki yeni regresyon testi eklendi: `volume_below_mev`/`volume_above_mrv` başlık ve açıklamasının İngilizce kas adı kullandığını ve Türkçe adı hiç içermediğini doğruluyorlar; mevcut `muscles_untrained` testinin veri örneği de gerçek şekle (`muscles`/`muscles_tr` ikilisi) güncellendi.

Doğrulama: Mobil taraf — `mobile/tests/diagnosis.test.cjs` bu oturumun cloud sandbox'ında gerçek `node --test` ile çalıştırıldı: **16/16 test geçti** (14 mevcut + 2 yeni), önceki adımdan farklı olarak burada gerçek doğrulama var. Backend taraf — `service.py` ve `test_diagnosis.py` için `py_compile` ile sözdizimi kontrolü yapıldı (temiz), ama **gerçek `pytest` (PostgreSQL'e karşı) çalıştırılamadı** — bilgisayarınızdaki shell hâlâ devre dışı ve bu oturumun cloud sandbox'ında gerçek Postgres + Alembic zincirini kurmak bu adımın kapsamını aşardı. Değişiklik küçük ve düşük riskli: yalnızca bir dict'e zaten var olan bir kalıbı (`muscle`/`muscle_tr` ikilisi) tekrarlayan yeni bir anahtar ekliyor, mevcut hiçbir alanı kaldırmıyor. Yine de **`cd backend && pytest` komutunun gerçek makinede çalıştırılıp sonucun paylaşılması gerekiyor.**

Sınır: Bu adım yalnızca `volume_below_mev`, `volume_above_mrv` ve `muscles_untrained` bulgularını kapsıyor. Diğer bulgu kodlarında (uyku, kilo, tutarlılık) zaten Türkçe metin yoktu, dokunulmadı. Teşhis ekranının tamamının Türkçeleştirilmesi (G2'nin ikinci seçeneği) ve hacim ekranı ile teşhis ekranı arasındaki dil tutarsızlığı hâlâ açık, ayrı bir karar/adım gerektiriyor.

### Adım 15: kg/lb dönüşümünün işlevselleştirilmesi — 13 Eylül 2026

- Yeni paylaşılan modül `mobile/src/units/weight.ts`: kg<->lb dönüşümü, gösterim için yuvarlama (bir ondalık basamak) ve kullanıcı girdisini (virgül ondalık ayırıcı dahil) kg'a çeviren ayrıştırma. API ve veritabanı hâlâ yalnızca kg görüyor — bu kasıtlı mimari kararı (bkz. CLAUDE.md) değiştirmiyor, yalnızca gösterim/girdi katmanına bir dönüşüm ekliyor.
- Üç ekran `users.weight_unit` tercihine göre gerçekten dönüşüm yapıyor artık:
  - `workout/[id].tsx`: canlı set loglama ve düzenleme (SetForm/SetRow/ReadOnlySetRow) artık kullanıcının birimini gösteriyor ve kabul ediyor; sunucuya gönderilen `weight_kg` değeri değişmedi.
  - `profile/weight-history.tsx`: güncel kilo, trend metni ve geçmiş liste satırları seçili birimde gösteriliyor; yeni ölçüm girişi kg'a çevrilip kaydediliyor.
  - `profile/personal-details.tsx`: güncel kilo ve hedef kilo satırları aynı şekilde dönüştürülüyor; doğrulama sınırları (20-400 kg) her zaman kg'da kontrol ediliyor — girilen değer önce kg'a çevrilip öyle sınanıyor, böylece lb için ayrı bir sınır tanımlamaya gerek kalmadı.
  - `profile/preferences.tsx`: "Display only — existing values are not converted" ipucu metni artık yanlıştı, kaldırıldı; birim tercihinin artık gerçekten ne yaptığını anlatan bir cümleyle değiştirildi.
- `mobile/tests/weight-unit.test.cjs` eklendi (8 test): dönüşüm sabiti, yuvarlama/floating-point gürültüsü, ayrıştırma, kg sınırlarının lb girdisinde de doğru çalışması. `npm run test:weight-unit` ile veya `node --test tests/*.test.cjs` ile diğerleriyle birlikte çalışır. `package.json`'a script eklendi.
- `CLAUDE.md` SEED BACKLOG'daki "weight_unit SADECE bir gösterim etiketi... DÖNÜŞTÜRÜLMÜYOR" notu güncellendi.

Doğrulama: Bu adımda **gerçek proje bağımlılıkları üzerinden `npx tsc --noEmit` veya `npm run lint` çalıştırılamadı** — bilgisayarınızdaki shell (device_bash) hâlâ Windows güncellemesi kaynaklı virtiofs/Plan9 mount hatası nedeniyle devre dışı, dosyalara yalnızca staging üzerinden erişilebiliyor. Bunun yerine: (1) `mobile/src/units/weight.ts` bu oturumun kendi cloud sandbox'ında gerçek `node --test` ile çalıştırıldı, 8/8 test geçti; (2) değişen üç ekran dosyası elle, satır satır, tip imzaları ve prop akışı için gözden geçirildi; (3) `tsc --noResolve` ile bir sözdizimi taraması yapıldı (modül çözümlemesi olmadığı için anlamlı tip hatası ayrıştıramadı, yalnızca sözdizimi kontrolü sağladı). **Bu adımdan sonra `cd mobile && npm run typecheck && npm run lint && node --test tests/*.test.cjs` komutlarının gerçek makinede çalıştırılıp sonucun paylaşılması gerekiyor** — bu proje her adımda gerçek pytest/tsc/ESLint doğrulaması istiyor ve bu adım o standardı henüz karşılamıyor.

Sınır: Bu adım yalnızca mobil gösterim/girdi katmanını değiştirdi; backend'e dokunulmadı, migration gerekmedi. Haftalık hacim ekranındaki tonaj (`total_volume_kg`) ve antrenman özet ekranları taranıp kg/kütle gösteren başka bir yer bulunmadı (bkz. bu adımın araştırma notları) — yalnızca üç ekranda kg metni vardı. Telefonda görsel doğrulama yapılmadı.

### Adım 14: Güncelliğini yitirmiş belgelerin düzeltilmesi — 13 Eylül 2026

- Kök `README.md`: monorepo tablosu artık backend ve mobilin gerçek durumunu anlatıyor ("boş" değil); var olmayan `ml/` klasörü ayrı bir dipnota alındı. "app/ kodu henüz yazılmadı" uyarısı kaldırıldı, mobil hızlı başlangıç komutu eklendi.
- `backend/README.md`: "Planlanan yapı (henüz yazılmadı)" bölümü, `app/domains/` altındaki gerçek dokuz domain (auth, users, exercises, workouts, programs, readiness, body, nutrition, analytics) ile değiştirildi.
- `mobile/README.md`: saf Expo şablon metni yerine gerçek ürün bağlamına işaret eden, mevcut `npm run test:*`/`typecheck`/`lint` komutlarını listeleyen bir içerikle yeniden yazıldı.
- `mobile/AGENTS.md`: Expo 54 dokümanına işaret eden bağlantı Expo 57'ye güncellendi (`package.json` içindeki gerçek sürümle eşleşiyor); sürümün tekrar kaymasına karşı `package.json`'a bakma notu eklendi.
- `CLAUDE.md` DURUM bölümü: 7 tablo/beş domain'lik eski liste, gerçek 13 tablo ve dokuz domain ile değiştirildi; sabit "125 test" iddiası kaldırılıp yerine PROJE_1_CODEX_INCELEME.md'deki en güncel Adım girdisine (test sayısı için) işaret eden bir not kondu — sayı hızlı eskidiği için artık buraya sabit yazılmıyor. "Uçtan uca telefonda çalışıyor" ifadesi, hangi adımların gerçekten telefonda denendiğini netleştiren bir cümleyle değiştirildi.
- `CLAUDE.md` SEED BACKLOG: "Auto adjust macros: kalori sistemi yok" ifadesi yanlıştı — bu özellik zaten var (`profile/nutrition-goals.tsx`, yalnızca ekrandaki makro/kalori alanları arasında canlı aritmetik senkron, tüketim veya kilo trendine bağlı değil). Not, gerçekten eksik olan "Add burned calories" / "Rollover calories" maddelerinden ayrıldı.
- `TASK_diagnosis.md`: dosyanın başına, görevin artık uygulanmış olduğunu ve gerçek davranışın Adım 5-8 ile bu dosyada yazılandan ileri gittiğini belirten bir durum notu eklendi. Örnek çıktıdaki ve test listesindeki "5,5 saat uyku → `sleep_low`" çelişkisi düzeltildi: eşik tanımına göre (`<6` saat) doğru kod `sleep_very_low` (severity: critical).
- `backend/tests/test_diagnosis.py` giriş yorumu incelendi: Bölüm 7 madde 8'de belirtilen "bazı kasların secondary bağlantısı bile yok" iddiası dosyada artık bulunmuyor — muhtemelen Adım 4'teki katalog kapsamı çalışmasıyla birlikte zaten düzeltilmiş. Ayrı bir değişiklik gerekmedi.

Doğrulama: Bu adım yalnızca Markdown belgelerini değiştirdi; uygulama kodu, testler, migration'lar veya bağımlılıklar dokunulmadı. pytest/mypy/ruff/tsc/ESLint bu adımda çalıştırılmadı — gerek yoktu. Belgelerdeki tablo/domain sayıları `backend/app/models/` ve `backend/app/domains/` klasörleri elle sayılarak doğrulandı (13 `__tablename__`, 9 domain klasörü).

Sınır: Bu adım yalnızca Bölüm 7'deki dokuz maddeyi kapatıyor. Bölüm 8'deki G (kg/lb dönüşümü, dil tutarlılığı, bilinmeyen eşik davranışı) ve H (eşzamanlılık, çoklu cihaz atomikliği, cihaz/hesap bazlı aktif seans, saat dilimi ayrışması) maddeleri kod değişikliği gerektirdiği için ayrı adımlarda ele alınacak.

### Adım 13: Antrenmanın başlangıç hedeflerini koruma — 13 Eylül 2026

- Şablondan başlatılan yeni seanslarda şablonun kimliği, adı, gün sırası, notları ve sıralı egzersiz hedefleri `workouts.template_snapshot` alanında saklanıyor. Bu plan başlangıçta kopyalanıyor; gerçekleşmiş set oluşturulmuyor. Serbest antrenmanda alan `null` kalıyor.
- Başlatma ile hedef listesini değiştirme aynı şablon satırını kilitliyor. Böylece aynı anda gelen hedef düzenlemesi, seansın başlangıç planını kopyalama işleminin ortasına giremiyor. Şablon güncellemesi sonraki seanslara uygulanıyor.
- Antrenman ayrıntısı ve set/başlık/bitirme yanıtları saklanan planı içeriyor. Şablon veya program silinse ve canlı `template_id` bağlantısı boşalsa da başlangıç planı korunuyor. Geçmiş liste yanıtına büyük plan içeriği eklenmiyor.
- Mobil antrenman ekranı hedefleri yalnızca seansın saklanan planından okuyor; güncel şablonu ayrıca çekmiyor. “Starting plan” açıklaması planın kaynağını belirtiyor. Eski şablonlu kayıtta plan yoksa “Starting targets were not saved for this workout.” gösteriliyor. Boş hedefli plan ile hiç saklanmamış plan ayrılıyor.
- Eski kayıtlar bugünkü şablon hedefleriyle doldurulmuyor. `f21c7d905e38` migration'ı yalnızca nullable JSONB alanını ekliyor; geçmişin bilinmeyen hedeflerini tahmin etmiyor. API üzerinden seans düzenlerken başlangıç planı değiştirilemiyor.

Doğrulama: 309 backend ve 63 mobil testi geçti. Şablon düzenleme/silme, program silme, yeni seansın yeni planı alması, set ve seans düzenlemesinde koruma, boş/serbest/eski seans ayrımı, kullanıcı sahipliği ve eşzamanlı hedef değiştirme test edildi. Backend Ruff/mypy ve mobil TypeScript/tam ESLint temiz. Test veritabanında migration downgrade/upgrade döngüsü doğrulandı. Mevcut bağımlılık deprecation uyarıları sürüyor.

Sınır: Bu adım tarihsel planı korur; plan–gerçekleşen puanı, efor girişi veya ilerleme analizi eklemez. Migration öncesi planı saklanmamış ve şablonu zaten silinmiş seansın geçmişte şablon kullanıp kullanmadığı belirlenemez. Telefon üzerinde görsel/uçtan uca kontrol henüz yapılmadı.

### Adım 12: Şablon kaydını güvenle tekrar deneme — 13 Eylül 2026

- Antrenmandan şablon kaydı artık `PUT /programs/{program_id}/templates/requests/{request_id}` yolunu kullanıyor. Mobilde işlem kimliği antrenmanın UUID'si; kullanıcı başına bir antrenmandan tek şablon kaydetme denemesi temsil ediliyor. Eski atomik POST yolu diğer istemciler için korunuyor, ancak tekrar koruması yeni PUT yoluna ait. Güncel olmayan sunucuda sessiz geri dönüş yapılmıyor.
- Sunucuda kullanıcı ve işlem kimliği birlikte benzersiz. İşlem makbuzu, şablon ve egzersiz hedefleri aynı transaction içinde kaydediliyor. Aynı anda gelen tekrarlar veritabanı benzersizlik kuralında bekliyor; ilk kayıt tamamlanınca aynı şablon kimliği ve ilk yanıt dönüyor. İlk işlem geri alınırsa tekrar başarılı biçimde kaydedebiliyor.
- İlk isteğin programı ve normalleştirilmiş içeriği özetlenerek saklanıyor. Aynı kimliğin farklı program, ad veya hedeflerle kullanımı 409; başka kullanıcıya ait program 404. Şablon sonradan düzenlenmişse tekrar ilk yanıtı döndürüyor ve düzenlemeyi değiştirmiyor. Silinmiş şablon tekrar isteğiyle yeniden oluşturulmuyor. Makbuzlar kullanıcı silinince temizleniyor.
- Telefon, gönderimden önce program ve tam istek içeriğini SecureStore'a yazıyor. Ağ hatası, pencereyi kapatma veya uygulamayı yeniden başlatma sonrasında aynı içerik geri yükleniyor. Hedef programdaki şablon sayısının değişmesi bile tekrarın gün sırasını değiştirmiyor. Önceki deneme varken ad/program kilitleniyor ve “Continue save” ile devam ediliyor. Yerel depolama hatasında sunucuya yazma isteği gönderilmiyor.
- Sunucunun 422 doğrulama reddinde yerel deneme kaldırılarak form düzeltmeye açılıyor. Sonucu belirsiz hatalarda deneme korunuyor. Şablon başarıyla kaydedildikten sonra da antrenmanı bitirme başarısız olabileceği için yerel kayıt tutuluyor; antrenmanın bittiği sunucudan doğrulanınca temizleniyor. Aynı ekranda çift dokunma ve kayıt sürerken pencereyi kapatma engelleniyor.

Doğrulama: 301 backend testi ve 59 mobil testi geçti. Backend Ruff ve mypy (52 kaynak dosyası), mobil TypeScript ve tam ESLint temiz. Yeni testler kayıp yanıt sonrası tekrar, beş eşzamanlı istek, değiştirilmiş içerik, kullanıcı ayrımı, silinmiş şablon, transaction geri alma, geçersiz egzersiz sonrası yeniden deneme, uygulama yeniden açılışı ve cihaz depolama hatasını kapsıyor. Mevcut bağımlılık deprecation uyarıları sürüyor.

Migration: `d87b19c4a620`, yalnızca `template_save_requests` tablosunu ekler; mevcut şablon ve antrenmanları değiştirmez. Test veritabanında downgrade/upgrade döngüsü doğrulandı. Backend başlatılmadan önce `alembic upgrade head` gerekir. Telefon üzerinde uçtan uca görsel/ağ testi henüz yapılmadı.

Sınır: Şablon kaydı ile antrenmanı bitirme hâlâ iki ayrı işlem. Bu adım genel bir çevrimdışı kuyruk oluşturmaz; kayıt için sunucu bağlantısı gerekir. Önceki denemenin hedefi sonradan silinirse kullanıcı hata alır ve şablon tekrar oluşturulmaz. Başka cihazda aynı antrenman için farklı içerikle kayıt denemesi 409 döner; ilk kayıt üzerine sessiz yazılmaz.

### Adım 11: Antrenmandan şablon kaydının bütünlüğü — 11 Eylül 2026

- “Antrenmanı şablon olarak kaydet” işlemi artık şablon adı ve tüm egzersiz hedeflerini tek istekte gönderiyor: `POST /programs/{program_id}/templates/with-exercises`.
- Program sahipliği ve egzersiz kimlikleri yazmadan önce doğrulanıyor. Şablon ve hedefleri aynı veritabanı işleminde oluşturuluyor; yanıt verisi de commit öncesinde hazırlanıyor. Ara aşamadaki hata, boş veya yarım şablon bırakmıyor.
- Ayrı endpoint, eski sunucunun yeni egzersiz alanını sessizce yok saymasını önlüyor. Mobil taraf eski iki istekli yönteme geri dönmüyor; bu akış için güncel backend gerekiyor. Program ekranından boş şablon oluşturma ve mevcut şablon hedeflerini düzenleme korunuyor.
- Hedefler yalnızca pozitif tekrarlı, ısınma olmayan setlerden üretiliyor. Set sayısı, tekrar aralığı ve ilk çalışma setine göre egzersiz sırası korunuyor; efor hedefi çıkarılmıyor. Çalışma seti bulunmayan antrenmanda mevcut boş şablon davranışı korunuyor.

Doğrulama: Sunucuda başarılı sıralı kayıt, geçersiz hedefler, zorunlu egzersiz listesi, başka kullanıcıya ait program ve veritabanına satırlar yazıldıktan sonra hata ile geri alma senaryoları eklendi. Mobilde tek istek, hata yayılımı ve çalışma setlerinden hedef üretimi testleri eklendi. 292 backend testi ve 55 mobil testi geçti. Backend Ruff ve mypy (52 kaynak dosyası), mobil TypeScript ve tam ESLint kontrolleri temiz. Backend testlerinde mevcut bağımlılık deprecation uyarıları sürüyor. Mobil testler `node --test tests/*.test.cjs` ile çalıştırılabilir.

Sınır: Bu değişiklik idempotency sağlamaz; commit sonrası yanıt kaybolur ve kullanıcı tekrar denerse kopya şablon oluşabilir. Şablon kaydı ile antrenmanı bitirme hâlâ ayrı işlemlerdir. Telefon üzerinde uçtan uca görsel kontrol yapılmadı. Veritabanı migration gerekmiyor.

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
