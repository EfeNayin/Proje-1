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

### Güncel adım sayısı ve bu geliştirme turunun sınırı — 30 Eylül 2026

İlk 33 uygulama adımı tamamlandı. Adım 34, 30 Eylül 2026 tarihli kullanıcı telefon testi bildirimiyle kapatıldı; kullanıcının ekran görüntüsüyle istediği kart sadeleştirmesi Adım 35'te, set girişindeki hassasiyet ve doğrulama düzeltmeleri Adım 36'da uygulandı. Bölüm 11'deki 6 başlık ana gelişim aşamalarıdır; toplam 6 uygulama işi veya belirlenmiş bir proje bitiş sayısı değildir. Adım sayısı düzeltmeler ve kullanıcı talepleriyle büyüdü. Projenin tamamı için kesin toplam henüz kararlaştırılmadı.

Bu turun tamamlanan kontrol noktaları:

1. **Adım 33 tamamlandı — Set oluşturmayı güvenli yeniden denemek:** Sunucu seti kaydettiği halde yanıt kaybolduğunda aynı işlem kimliğiyle yeniden deneme ikinci set oluşturmuyor. Kapsam ve sınırlar aşağıda.
2. **Adım 34 tamamlandı — Uçtan uca doğrulama ve düzeltmeler:** Gerçek cihazda önceki seans, hedef karşılaştırması, kg/lb, RIR boş/sıfır, bağlantı kesilmesi ve yeniden deneme akışlarını birlikte kontrol etmek; bulunan sorunları kapatıp mevcut turu değerlendirmek.

Adım 34'ün otomatik kontrolleri ve bulunan hataların düzeltmeleri yapıldı; kullanıcı telefon testinin tamamlandığını bildirip sonraki adıma geçilmesini istedi. Bu tur kullanıcı kabulüyle kapandı; bütün projenin tamamlandığı anlamına gelmez. Adım 37 ile egzersizin daha eski seanslarını sayfalar halinde görüntüleme eklendi, Adım 38 ile bu liste ayrı bir modal panele taşındı; her iki adımın da telefon kontrolü bekliyor. Yeni modüller, tüm geçmiş grafiği ve kişisel rekor/kuvvet tahmini ayrı kapsam kararı gerektirir.

### Adım 50: Programs bölümünün sade açık tema ile yeniden tasarımı — 25 Ekim 2026

- Kapsam: Programs listesi (`(tabs)/programs.tsx`), program detayı (`program/[id].tsx`), şablon editörü (`program/template/[id].tsx`) ve onlardan açılan egzersiz seçici. Koç program teklifi ekranlarına, Training/antrenman ekranlarına, Volume ve Profile'a dokunulmadı. Backend, API sözleşmesi, store, migration, bağımlılık, istek sayısı ve program/şablon mantığı (`programActions`, aktif program tekilliği, şablondan antrenman başlatma) değişmedi.
- Görsel: Roman yazı tipi, altın, büyük harf başlıklar ve kesikli kenarlıklar kaldırıldı; Adım 48-49'daki `lightTheme.ts` ve sistem yazı tipi. Liste: "New program" kartı (siyah Create), "Your programs" altında tek gruplanmış beyaz yüzey; aktif program yeşil nokta + "Active program" yazısıyla (yalnızca renk değil). Listede ad ve aktiflik dışında sayaç gösterilmiyor: liste uç noktası başka veri dönmüyor (şablon/egzersiz sayısı yalnızca detayda var) ve bunun için ek istek yapılmadı. Detay: büyük düzenlenebilir ad, aktif değilse siyah "Make this the active program", şablonlar gruplanmış satırlar (sıra numarası + ad + "n exercises"), "New template" kartı. Silme simgesi ve "Delete program?" / "Its templates will be deleted too." uyarısı aynı (tamamlanmış antrenman geçmişinin silindiği ima edilmiyor; "Archive" yok). Şablon editörü: ad, "Exercises" bölümü, her egzersiz beyaz kartta (uzun ad sarar, 44 pt kaldır düğmesi + `Remove <ad>` etiketi), Sets / Reps min / Reps max / RIR alanları hizalı ve dar ekranda/büyük yazıda `flexWrap` ile alt satıra iniyor, doğrulama hatası üstte, "Add exercise", Save (beyaz) ve Start workout (siyah). Alan anlamları, isteğe bağlı değerler, doğrulama metni, sıra, taslak ve çift gönderim korumaları aynı. Klavye için `keyboardShouldPersistTaps`, `automaticallyAdjustKeyboardInsets` (iOS) eklendi. Kaynak/sahiplik bilgisi bu üç ekranda hiç yoktu, eklenmedi; koçun orijinaline eşitleme yok.
- Paylaşılan etki: (1) Egzersiz seçicinin yalnızca iki tüketicisi var (antrenman ekranı ve şablon editörü; `grep` ile doğrulandı), ikisi de artık açık olduğundan Adım 49'da eklenen `appearance=light` rota parametresi ve koyu palet KALDIRILDI: seçici her zaman açık, `usePickedExercise` eski basit hâline döndü (Adım 49'un sınır testi de kaldırıldı; geri kalan 3 posta kutusu testi aynı). Seçici sonucu, `router.back()` ile dönüş ve tek seferlik teslim değişmedi. (2) Sekme çubuğu: Programs sekmesine yalnızca kendi odağındayken geçerli açık `tabBarStyle`/renk/`sceneStyle` seçenekleri eklendi (Training'deki yöntem); Volume ve Profile koyu kalır, sekmeler arası geçişte çubuk rengi değişir (diğer ekranlar yeniden tasarlanana kadar geçici). Yığındaki `program/[id]` zaten kendi çubuğunu çiziyordu; `program/template/[id]` yerel başlığı korudu (başlık + silme) ve onu `Stack.Screen` ile açık yaptı, yani çift başlık yok; `app/(app)/_layout.tsx` değişmedi. (3) Durum çubuğu: yeni `src/FocusedDarkStatusBar.tsx` (odaktayken `StatusBar style="dark"`, Adım 48-49'daki mantığın ortak hâli; antrenman ve Training ekranları kendi kopyalarını kullanmaya devam ediyor) Programs, detay, editör ve seçicide kullanılıyor. Çakışma sonucu ve modal/yerel başlık altındaki görünüm cihazda doğrulanmadı.
- Doğrulama: `tsc --noEmit` temiz, `npm run lint -- --max-warnings 0` çıkış 0, 434/434 mobil test (bu üç ekranı yükleyen test yoktu; sunum fikstürü değişmedi), `expo export --platform ios` temiz, `git diff --check` temiz. Yeni test eklenmedi: davranış değişmedi, geriye kalan seçici davranışı mevcut posta kutusu testlerinde.
- Görsel inceleme (**web önizlemesi, native değil**): depo dışı geçici Expo web projesi gerçek ekran dosyalarını react-native-web ile derledi; router, API, depolama SAHTE, güvenli alan sabit sayı; 393×852 ve 375×667: program yok, aktif/pasif programlar, yükleme hatası + Try again, program detayı (pasif, boş şablonlu), şablon editörü (dolu, boş, uzun egzersiz adı, geçersiz set sayısı hatası). Sınırlar: web'de native üst başlık (şablon editörü), modal seçici başlığı ve sekme çubuğu çizilmez; program oluşturma → şablon ekleme → egzersiz → kaydet → aktifleştir → antrenman başlat akışı, onay Alert'leri, gerçek klavye, Dynamic Type, jestler, VoiceOver ve durum çubuğu rengi İNCELENMEDİ. Geçici hesapla yazma doğrulaması yapılmadı; gerçek kayıtlara dokunulmadı. Bu turda ekran akışı doğrulanmadığından gerçek API turu da koşulmadı.
- Telefonda bakılacaklar: oluştur → şablon ekle → egzersiz seç (seçici açık, doğru editöre dönüş, seçim kayboluyor mu) → alanları düzenle → Save → aktifleştir → Start workout; uzun adlar; şablon editöründe klavye açıkken alanlar ve Save/Start erişimi; silme onayları; yükleme hatası ve Try again; sekme çubuğu ve durum çubuğu renk geçişleri (Training/Programs açık, Volume/Profile koyu); VoiceOver ve büyük yazı. Antrenör–sporcu modülü hâlâ üretime hazır sayılmaz.

### Adım 49: Sporcunun antrenman ekranının sade açık tema ile yeniden tasarımı — 25 Ekim 2026

- Kapsam: yalnızca sporcunun antrenman ekranı (`app/(app)/workout/[id].tsx`, aktif ve tamamlanmış durum) ve ondan açılan paneller: önceki seans özeti (`PreviousExercise`), önceki seanslar paneli (`ExerciseHistory`), koç geri bildirimi (`ReceivedFeedbackSection`), egzersiz ekleme ekranı ve şablon olarak kaydetme sheet'i. Backend, API sözleşmesi, migration, bağımlılık, store mimarisi ve hesaplama değişmedi; yeni istek yok. Programs, Volume, Profile, giriş ve antrenör ekranlarına dokunulmadı. Palet Adım 48'deki `src/lightTheme.ts` (değişmedi).
- Görsel: Roman yazı tipi, altın çerçeve/vurgu, büyük harf + harf aralığı ve kesikli "Add exercise" kaldırıldı. Gri zemin, beyaz yüzeyler, yakın-siyah metin ve birincil eylemler, sistem yazı tipi. Tek üst çubuk: geri, düzenlenebilir ad (salt okunurken 2 satıra kadar), Finish (yuvarlak siyah) ya da Edit/Done. Özet: "working sets" ve "duration" iki hücre (ikon yok, tek erişilebilirlik etiketi). Dinlenme sayacı: beyaz kart, hedef süre seçici, büyük sayaç, siyah yuvarlak başlat/durdur; "Rest over" yeşil ve yazıyla (yalnızca renkle değil). Egzersiz kartı: ad, "Previous session" gri hap düğmesi, Weight/Reps/RIR sütun başlıkları (satırlarla aynı genişlikler, tabular rakamlar), ısınma "W" rozeti, ince ayraçlar. Set girişi gri kuyu içinde beyaz alanlar; alanlar `flexWrap` ile dar ekranda/büyük yazıda alt satıra iniyor (eskiden sıkışırdı), birim etiketi ("Weight (kg|lb)") ve "RIR (optional)" korundu, açıklayıcı cümle geri EKLENMEDİ, "Log set" siyah. Düzenleme durumu gri kuyu + "Editing set N" yazısı (Delete kırmızı, Cancel, Save siyah). "Set awaiting confirmation" kartı ikonlu, siyah çerçeveli, siyah "Retry pending set". "Plan and log" kartı geri gelmedi. Şablon sheet'i beyaz, siyah Save, gri Cancel; Alert'ler yerel olduğundan değişmedi.
- Korunan davranış (mantık aynı): 0 kg ve ondalık/virgül, RIR boş-0 ayrımı ve doğrulaması, hatadan sonra taslak, çift gönderim koruması ve belirsiz kayıt kurtarma, bekleyen set kilidi, düzenle/iptal/sil/kaydet, ısınma varsayılanları ve sıra, başlık taslağı (blur/submit ile kayıt), bitmiş antrenmanda salt okunur + Edit/Done, sayaç durumu (set işlemleri ve panellerle sürüyor), klavye (`KeyboardAvoidingView`, `keyboardShouldPersistTaps`), hesap değişimi/erişim kaybı/geç yanıt korumaları. Blur davranışı değişmedi. Özel sayısal klavye yok. Sayaca skip/+30 sn eklenmedi.
- Paylaşılan etki: (1) Egzersiz seçici program şablon editörüyle ORTAK; sınır olarak `usePickedExercise(onPick, { appearance: "light" })` yalnızca antrenman ekranında rota parametresi (`appearance=light`) gönderiyor; şablon editörü parametresiz eski rotayı açıyor ve eski koyu görünümünü koruyor (regresyon testi eklendi; web önizlemesinde iki hâli de görüldü). Açık seçicide modal başlığı `Stack.Screen` ile yalnızca o örnekte açıklaştırılıyor; `_layout.tsx` DEĞİŞMEDİ. (2) Durum çubuğu: kök düzen `light` (açık yazı) ayarlıyor; ekran yalnızca odaktayken `StatusBar style="dark"` bağlıyor (Adım 48'deki aynı yöntem) ve yerel başlığı kapalı tutuyor, yani çakışan ikinci başlık/StatusBar yok. Çakışmada hangisinin kazandığı Expo belgesinde yazmıyor, cihazda doğrulanmadı. Seçici modalında durum çubuğunun nasıl görüneceği de doğrulanmadı. (3) `PreviousExercise`, `ExerciseHistory`, `ReceivedFeedbackSection` yalnızca bu ekranda kullanıldığından doğrudan açık temaya çevrildi; koçun egzersiz geçmişi paneli (`AthleteExerciseHistoryPanel`) ve `CoachFeedbackSection` ayrı bileşenler, dokunulmadı. `romanTheme.ts` ve `theme.ts` değişmedi.
- Testler: davranış iddiaları korundu. Yalnızca sunuma bağlı fikstürler güncellendi: `set-save`/`rir` saplamalarında `roman` yerine `light`, yeni yardımcı bileşen adları (`FocusedDarkStatusBar`, `SummaryCell`) ve `rirCell`; "Log set" düğmesi stil adıyla değil erişilebilirlik etiketiyle bulunuyor (düğme basılma stili fonksiyon oldu); biten oturum RIR kontrolü " · RIR" yerine "RIR n" arıyor (sütunda ayraç yok, 0 gösterilir/boş uydurulmaz iddiası aynı). Tema modülü saplamaları (`PreviousExercise`, `ExerciseHistory`, `ReceivedFeedbackSection` testleri) `lightTheme`e çevrildi. Yeni test: seçicinin yalnızca isteyen çağırana açık görünümle açılması (435 test).
- Doğrulama: `tsc --noEmit` temiz, `npm run lint -- --max-warnings 0` çıkış 0, 435/435 mobil test, `expo export --platform ios` temiz, `git diff --check` temiz.
- Görsel inceleme (**web önizlemesi, native değil**): geçici, depo dışı bir Expo web projesi (commit'lenmedi) gerçek ekran dosyalarını react-native-web ile derledi; router, API, depolama, kimlik doğrulama ve geri bildirim SAHTE (saplama), güvenli alan sabit iPhone benzeri sayı, tıklamalar DOM'dan betikli; 393×852 ve 375×667'de aktif/dolu, boş, bekleyen set, tamamlanmış (+ koç geri bildirimi), uzun başlık ve egzersiz adı, set düzenleme, lb birimi, önceki seans özeti, önceki seanslar paneli (sayfalama dahil), şablon sheet'i, seçici (açık ve varsayılan) görüldü. Gözlem: uzun başlık düzenlenebilirken tek satırda kesiliyor (tek satırlı TextInput, Finish görünür kalıyor); salt okunurken 2 satıra sarıyor. Sınırlar: web yazı tipi/kenar yumuşatma iOS'tan farklı; web'de güvenli alan, gerçek klavye, native Modal sheet animasyonu, kaydırma/jestler, Dynamic Type, VoiceOver, Alert ve durum çubuğu rengi İNCELENMEDİ/denenmedi.
- Native etkileşim yine yapılamadı (Adım 47'deki engel sürüyor). Telefonda elle bakılacaklar: ağırlık/tekrar/RIR ve başlık klavyesi (odaklı alan ve Log set/Save erişilebilir mi), alanların dar ekran/büyük yazıda sarması, Dynamic Island/alt güvenli alan, durum çubuğu yazısı (ekranda koyu, seçici modalında ve çıkınca doğru mu), sayaç başlat/durdur/süre seçimi ve set/panel işlemleri sırasında sürmesi, set düzenleme/silme (uzun basma), bekleyen set yeniden deneme, Finish → şablon sheet'i, geçmiş panelinin kaydırma/sayfalama/kapatma (düğme, arka plan, Android geri), şablon editöründe seçicinin ESKİ koyu görünümde kalması, VoiceOver sırası ve 44 pt hedefler. Antrenör–sporcu modülü hâlâ üretime hazır sayılmaz.

### Adım 48: Training ana ekranının sade açık tema ile yeniden tasarımı — 25 Ekim 2026

- Kapsam: yalnızca Training ana ekranı (`app/(app)/(tabs)/index.tsx`) + yeni kapsamlı palet `src/lightTheme.ts` + `(tabs)/_layout.tsx`'te yalnızca Training'e ait seçenekler. Özellik, API, store, backend, bağımlılık ve migration değişikliği yok; giriş, aktif antrenman, Programs, Volume, Profile ve antrenör ekranlarına dokunulmadı.
- Görsel: heykel arka planı, gradyan, altın çerçeveler, Roman yazı tipi ve büyük harfli başlıklar kaldırıldı. Yumuşak gri zemin (#F5F5F7), beyaz yüzeyler, yakın-siyah metin/birincil eylem (#111111), sistem yazı tipi. Üst çubukta bir kez "Training" ve Profile'a giden 44 pt "Open profile" düğmesi. Birincil eylem (Start workout / Resume workout + "Workout in progress" göstergesi) ilk ekranda en üstte; aktif program satırı "Start from a template" + program adı olarak sadeleşti (zamanlanmış seans ya da otomatik ilerleme ima etmez); Research, ikincil sessiz bir satıra indi; geçmiş, gün başına tek gruplanmış beyaz yüzey (satırlar arası ince ayraç) ve her satırda ad, süre/başlangıç metni, set sayısı ve ok. Yeni grafik, halka, seri, takvim ya da türetilmiş özet eklenmedi. Boş durum tek başlık + tek cümle (önceki yinelenen metin kaldırıldı). Uzun program/antrenman adları 2 satıra kadar sığıyor, eylemler gizlenmiyor.
- Korunan davranış (kod mantığı satır satır aynı): aktif antrenman uzlaştırması, hazırlık check-in'i ve çift dokunma korumaları (`startingRef`, `navigatingRef`), şablondan başlatma sayfası, geçmiş sıralaması/sayfalama/yenileme/yeniden dene, odakta yenileme, olağan yenileme hatasında eldeki verinin korunması, set sayısı ve süre anlamları (kayıtlı süre / otomatik kapanmış / bilinmiyor metinleri aynı).
- Paylaşılan stil etkisi: (1) Sekme çubuğu: `tabBarStyle`/renkler Training ekranının kendi seçeneklerinde; navigator odaktaki ekranın seçeneklerini uyguladığından çubuk yalnızca Training odaktayken açık, öteki üç sekmede eskisi gibi koyu kalır (sekmeler arası geçişte çubuk rengi değişir; diğer ekranlar yeniden tasarlanana kadar geçici). (2) Durum çubuğu: kök düzen her yerde `light` (açık yazı) ayarlıyor; Training odaktayken ekrana özel `StatusBar style="dark"` bağlanıp odak kaybında kaldırılıyor. Expo SDK 57 belgesi birden çok `StatusBar`ın bağlanma sırasına göre birleştirildiğini söylüyor ama çakışmada hangisinin kazandığını yazmıyor; bu yüzden davranış cihazda doğrulanmadı. `theme.ts`/`romanTheme.ts` değişmedi; hero görseli ve yazı tipleri başka ekranlarca kullanıldığından dosyalar duruyor.
- Kontrast (WCAG): metin/zemin 17,3:1; ikincil metin #636366 zeminde 5,5:1, beyazda 6,0:1; beyaz/siyah düğme 18,9:1; hata rengi beyazda 6,5:1; "in progress" yeşili zeminde 4,7:1.
- Doğrulama: `tsc --noEmit`, `npm run lint -- --max-warnings 0` (çıkış 0), 434/434 mobil test (davranış testlerine dokunulmadı; yeni test eklenmedi çünkü davranış değişmedi), `expo export --platform ios` temiz, `git diff --check` temiz.
- Görsel inceleme (**web önizlemesi, native değil**): projenin kendi Metro'su ile geçici bir önizleme (depo dışında, commit'lenmedi) gerçek `index.tsx` dosyasını react-native-web ile, router/API/depolama/StatusBar için saplamalar ve sabit sahte verilerle derleyip headless Chrome ile 393×852 ve 375×667 ekran görüntüleri aldı: normal, aktif antrenman, uzun adlar, boş geçmiş. Küçük ekranda Start workout ilk ekranda görünüyor; uzun adlar sığıyor. Sınırlar: bu bir web render'ıdır (yazı tipi, kenar yumuşatma, güvenli alan ve dokunma iOS'tan farklı; web'de üst güvenli alan 0 ölçüldü), alt sheet (Modal), büyük yazı boyutu (Dynamic Type), kaydırma/sayfalama, yenile-çek, Profile/Research/geçmiş gezinmesi ve Start/Resume dokunuşları İNCELENMEDİ ya da denenmedi.
- Native etkileşim yine yapılamadı (Adım 47'deki engel geçerli: simülatöre dokunma/yazma gönderecek destekli araç yok). Bu ekranın telefonda elle bakılacakları: Dynamic Island/üst güvenli alan, durum çubuğu yazısının koyu görünmesi ve Training'den çıkınca açık yazıya dönmesi, sekme çubuğu renginin sekme geçişlerindeki davranışı, büyük yazı ve uzun adlar, Start/Resume ve şablon sheet'i, Profile ve Research gezinmesi, geçmişin kaydırılması/sayfalanması/yenilenmesi, VoiceOver sırası ve 44 pt hedefler. Antrenör–sporcu modülü hâlâ üretime hazır sayılmaz.

### Adım 47: Sadeleştirme ve konsolidasyon — antrenör–sporcu modülü — 25 Ekim 2026

- Kapsam: yeni özellik yok, görsel yeniden tasarım yok. Eskimiş görev belgeleri incelendi, bayat durum özeti düzeltildi, Adım 46 migration'ı atılabilir bir veritabanında yukarı/aşağı/yukarı denendi, mobil etkileşim yeteneği bir kez yoklandı.
- Silinen: `ADIM_38_EGZERSIZ_GECMISI_PANELI.md` (git'e hiç eklenmemiş, izlenmeyen dosyaydı; bu yüzden silinmesi Git geçmişinde silme olarak GÖRÜNMEZ). Tamamen okunup bu günlükle karşılaştırıldı: görev tanımı, uygulama sonucu ve kullanıcı kabulü Adım 38 girdisinde zaten vardı ve girdi daha yeni (164 test ve sonraki sertleştirme; dosya yalnızca eski 159 sayısını taşıyordu). Dosyada günlükte olmayan tek şey kabul kutularındaki telefon denetimleriydi (panelin arkasındaki ekranın dokunma/kaydırma almaması, uzun egzersiz adı, açmadan istek yok, hızlı dokunma); bunlar aşağıdaki kontrol listesine taşındı. Başka dosyadan buna referans yoktu (yalnızca günlükteki "Adım 38" kullanıcı-kabulü satırı, o da bu girdide kalıyor). O satır, dosya silinince kabul kaydının tek kopyası olduğu için bu turda commit'lendi.
- Korunan: `ADIM_34_CIHAZ_KONTROLU.md` (kabul kapalı ama madde bazlı telefon listesi günlükte özetlenmiş, ayrıntıları yalnızca burada), `ADIM_37_CIHAZ_KONTROLU.md` (telefon kontrolü hâlâ bekliyor; panele geçişi anlatan bir durum notu eklendi, çünkü "Hide exercise history" gibi adlar Adım 38'den beri panelin kapatma düğmesine denk geliyor), kök `CLAUDE.md` ve `AGENTS.md`, `mobile/AGENTS.md`, "peoject- 1- Ön Hazırlık.txt" (açılmadı), `docker-compose.yml` (commit dışı), testler/migration'lar/varlıklar.
- Düzeltilen somut tutarsızlık: `CLAUDE.md` durum özeti "13 tablo / 9 domain" diyordu; gerçek 18 uygulama tablosu ve 11 domain (coaching, research eksikti, 5 tablo eksikti). Özet güncellendi ve antrenör–sporcu mobil bölümünün ekran etkileşimiyle doğrulanmadığı notu eklendi. Başka somut hata bulunmadı; kod değişmedi, bu yüzden uygulama testleri yeniden koşulmadı (son durum: backend 702, mobil 434; Adım 46).
- Bilinen, bu turda DÜZELTİLMEYEN: (1) `mypy app tests` toplu çağrısı "Source file found twice" ile düşüyor; `--explicit-package-bases` ile çalışınca 7 eski test dosyasında 131 tür notu eksikliği çıkıyor (bu turdan önce de vardı). Projede uygulanan kural `mypy app` + yeni test dosyaları; eski testleri tiplemek ayrı iş. (2) Kod çözen uçların hız sınırı süreç belleğinde (Adım 40), çok süreçli dağıtımda paylaşılmaz. (3) Sporcu listesi LATERAL sorgularının performansı ölçülmedi (Adım 43). (4) `ruff format --check` eski dosyalarda fark gösteriyor; yalnızca dokunulan dosyalar biçimlendiriliyor.
- Migration `e8a3c5d17b24` doğrulaması (geçici `zz_migcheck_*` veritabanı, `bodytrack` ve `bodytrack_test`'e dokunulmadı; iş bitince yalnızca o veritabanı silindi): önceki revizyona (`d5e92b7f3a18`) kadar kurulup 2 kullanıcı, davet, bağlantı, bitmiş antrenman + set ve program eklendi; `head`e yükseltme tablo ve kısıtlamaları kurdu (boş/yalnız boşluk/2001 karakter metin ve ikinci kayıt DB tarafından reddedildi), `alembic check` temiz, mevcut verilerin tüm tabloları satır sayısı + içerik özetiyle birebir aynı kaldı. İçinde bir geri bildirim satırı varken `downgrade -1`: `workout_feedback` tablosu ve indeksleri kalktı (satırı tabloyla birlikte gitti, beklenen), `pg_dump -s` şeması yükseltme öncesiyle birebir aynı, diğer verilerin özeti aynı; yeniden `upgrade head` ilk yükseltmeyle aynı şemayı verdi, `alembic check` temiz. Hata bulunmadı, migration değiştirilmedi. Geliştirme veritabanı hiç geri alınmadı (head `e8a3c5d17b24`, 3/24/21/0/0/96).
- **Mobil etkileşim hâlâ YAPILAMIYOR** (bu turda yetenek bir kez yoklandı, otomasyon tekrarlanmadı): `simctl` dokunma/yazma komutu sunmuyor; `idb`, Maestro, AXe kurulu değil; `Simulator.app` yok, yalnızca DeviceHub var ve Adım 45'te oradan gönderilen tıklamalar cihaza ulaşmadı; yeni bir simülatörde Expo Go de kurulu olmazdı (indirme gerekir) ve mevcut cihazdaki Expo Go gerçek bir oturum taşıyor, onu çıkış yaptırmadım. Ekran Kaydı/Erişilebilirlik izinleri bu kez "verilmiş" görünüyor ama bu tek başına dokunma göndermeyi sağlamıyor. Asgari çözüm: kullanıcı elle denesin ya da `idb`/Maestro kursun.
- Doğrulanmış (otomatik/API): davet→kabul→paylaşım rızası, etkinlik özeti, salt okunur antrenman ve egzersiz geçmişi, program önizleme/gönderme/kabul/ret ve bağımsız kopya, geri bildirim ve izin/eşzamanlılık kuralları; backend 702 test, mobil 434 store/bileşen testi, canlı API turları (Adım 45: 32/32, Adım 46: 38/38). Doğrulanmamış: bütün bu modülün **ekran görünümü ve dokunma etkileşimi**. Otomatik testler sahte API'li store ve eleman ağacı testleridir; bu yüzden modül "üretime hazır" sayılmaz.
- Elle doğrulama kontrol listesi (tek, birleştirilmiş; iki hesap + iki cihaz/oturum gerekir; her madde şu an DENENMEDİ):
  1. Davet ve rıza: antrenörde Coach tools aç → davet kodu üret; sporcuda kodu gir, antrenörün adı görünsün (e-posta yok) → kabul; "Share workouts" kapalıyken antrenör listesi/özet gizli, aç → görünür. Geçersiz kod, süresi dolmuş kod, tekrarlanan yanlış kod (hız sınırı) iletileri anlaşılır mı.
  2. Sporcu etkinlik özeti (My Athletes): sporcu antrenmanı kaydedip bitirince kart sayıları değişiyor; çekerek yenile, sayfalama, boş/hata/yeniden dene durumları.
  3. Salt okunur antrenman: listeden aç; düzenleme denetimi yok; set/RIR/ağırlık birimi (kg/lb) doğru; "Earlier sessions" paneli: açmadan istek yok, sayfa yükleme, "Load older sessions", hata sonrası aynı sayfayı yeniden dene, kapatınca (düğme, arka plana dokunma, Android geri tuşu) aynı ekrana dönüş, arkadaki ekran panel açıkken dokunma/kaydırma almıyor, uzun egzersiz adı ve büyük yazı taşmıyor, alt güvenli alan.
  4. Program: antrenör program seçer → önizleme → gönderir; aynı gönderimi tekrarlamak ikinci teklif yaratmaz; önizlemeden sonra programı düzenleyince bayat önizleme reddedilir ve yeniden onay istenir; sporcu teklifi kabul eder (pasif kopya, mevcut aktif program değişmez) ya da reddeder; kopya bağlantı bitince de durur.
  5. Geri bildirim: antrenör "Write feedback" → yaz → Save (sporcunun okuyacağı uyarısı çıkmalı) → sporcu hesabında aynı bitmiş antrenman "Coach feedback" gösterir; antrenör düzenler → sporcu ekranı yeniden odaklanınca günceller; iki cihazdan eşzamanlı düzenleme çakışma ekranını gösterir ("Keep my text and review" / "Use the latest"); silme onay ister; başarısız kayıtta (ağı kes) taslak kalır; 2000 karakter sınırı ve sayaç; klavye açıkken Save/Cancel erişilebilir.
  6. Erişim kaybı: sporcu paylaşımı kapatır → antrenör açık antrenman/geri bildirim ekranında erişim mesajı görür, taslak temizlenir; sporcu geri bildirimi hâlâ okur. Bağlantı bitirilince aynı; yeniden bağlanınca eski geri bildirim antrenörde görünmez.
  7. Hesap izolasyonu: çıkış yap → başka hesapla giriş; önceki hesabın sporcu listesi, antrenman, panel ve geri bildirim verisi görünmemeli. Oturum süresi dolunca da aynı.
  8. Genel: VoiceOver etiketleri, büyük yazı, 44 pt hedefler, geri düğmesi hedefleri, çevrimdışı iken tüm bu ekranların hata/yeniden dene davranışı.

### Adım 46: Antrenörün paylaşılan, bitmiş antrenmana sporcunun göreceği geri bildirim bırakması — 25 Ekim 2026

- Davranış: antrenör, bağlantılı sporcunun **bitmiş** antrenmanının salt okunur detay ekranında "Your feedback" bölümünü görür; metin yazar, düzenler, siler. Kaydetmeden önce "{sporcu} bunu kendi antrenmanında okuyabilecek" uyarısı ve silmeden önce onay Alert'i çıkar. Sporcu kendi bitmiş antrenmanında "Coach feedback" bölümünü görür: antrenörün adı/@kullanıcı adı, metin, yazılma ve (varsa) düzenlenme zamanı; düzenleme denetimi yok, sporcunun set/notlarından ayrı çerçevede. Yanıt, okundu bilgisi, tepki, bildirim, sohbet, ek dosya, yeni sekme YOK. Tema/arayüz değişmedi.
- Kurallar: bağlantı başına × antrenman başına tek kayıt (DB unique); düz metin, kırpılmış ≤2000 karakter (bayt değil karakter), boş/yalnız boşluk/NUL reddedilir (422, DB CHECK de ayrıca korur). Her antrenör işlemi (okuma/yazma) bağlantıyı, aktifliği, paylaşım anahtarını, antrenmanın sporcuya ait ve bitmiş olduğunu yeniden doğrular; bağlantı bitmiş/başkasının ise 404, paylaşım kapalıysa 403. Yalnızca yazarın bağlantısı düzenler/siler; ikinci antrenör kendi kaydını görür, ötekine dokunamaz. Sporcu tarafı (`GET /coaching/workouts/{id}/feedback`) bağlantı durumundan bağımsız: paylaşım kapansa ya da bağlantı bitse de eski geri bildirimi okur; her antrenörün kaydı ayrı ve kendi adıyla (yalnızca public ad alanları, e-posta yok). Yeniden bağlanma YENİ bağlantı kimliği demektir: eski kaydı göremez/düzenleyemez (düzenleme 409), eskisi sporcuda ayrı kayıt olarak durur, yenisi ayrı yazılır. Geri bildirim sporcunun antrenmanı silmesini/düzenlemesini engellemez (silinince CASCADE ile gider).
- Güvenilir yazma: oluşturma `PUT .../feedback/requests/{request_id}` ile idempotent (aynı kimlik+aynı metin → 200 aynı kayıt; aynı kimlik farklı metin/antrenman → 409; başka kimlikle ikinci kayıt → 409). Düzenleme/silme `expected_version` ister; sürüm uyuşmazlığı 409 ("başkasının/başka cihazın değişikliğini ezme" yok). Kayıp yanıt sonrası aynı düzenleme tekrarı başarı döner; farklı metin eski işlem kimliğine binemez. Her antrenör yazması bağlantı satırında `FOR UPDATE` kilidi alır (bağlantıyı bitiren ve paylaşımı kapatan işlemlerle aynı kilit), yani yazma ya önce tamamlanır ya da yetki değişikliğinden sonra reddedilir. 404 yalnızca erişim kaybı için; çakışma hep 409. Migration `e8a3c5d17b24` (yalnızca ekleyici, `workout_feedback` tablosu; geçmiş migration'lara dokunulmadı), geliştirme DB'sine uygulandı, `alembic check` temiz.
- Mobil: salt-okunur antrenör ekranına bölüm eklendi (`workoutFeedback.ts` store + `CoachFeedbackSection`); taslak store'da tutulur, sıradan başarısız kayıtta korunur, aynı metin tekrarında aynı `requestId` yeniden kullanılır, değişen taslak yeni kimlik alır; çakışmada en son kopya getirilir ve antrenör "Keep my text and review" (taslak korunur, son sürüme oturur, bilerek yeniden kaydeder) ya da "Use the latest" seçer; en son kopya alınamadıysa hiçbiri seçilemez. 403 → her şey (taslak dahil) temizlenir ve mevcut `revoke("not_shared")` yolu; 404 → temizlenir, `refreshAthleteView` ile nedeni bulunur. Hesap/bağlantı/antrenman kapsamı, geç yanıtların atılması, çıkış ve oturum bitişinde sıfırlama (iki yerde), odaklanınca yenileme (polling yok). Sporcu tarafı: `receivedFeedback.ts` (tek-uçuş, kapsamlı, başarısız yenilemede eldekini korur) + `ReceivedFeedbackSection` (`workout/[id].tsx`, yalnızca bitmiş antrenman, geri bildirim yoksa hiçbir şey çizmez). Klavye için `keyboardShouldPersistTaps="handled"`, `automaticallyAdjustKeyboardInsets`, 44 pt hedefler, erişilebilirlik etiketleri. Yeni bağımlılık yok.
- Doğrulama (otomatik): backend **702** test geçti (önceki 640 + 62 yeni: CRUD, yetkisiz/yazar olmayan/ikinci antrenör, paylaşım kapalı, bitmiş bağlantı, bitmemiş/yabancı antrenman, sporcunun erişimi, yeniden bağlanma, yinelenen oluşturma/kayıp yanıt/aynı kimlik farklı metin, eşzamanlı oluşturma ve düzenleme, kilit koordinasyonu [bir bağlantı kilidi başka bağlantıda tutulurken yazma bekler ve sonra reddedilir], sınır/boş/aşırı uzun metin, DB CHECK, antrenman silme/düzenleme sağlam). Mobil **434** test geçti (384 + 50 yeni; mevcut `set-save` testine yalnızca yeni bileşen için bir saplama eklendi). `ruff check`, `mypy app tests/test_coaching_feedback.py`, `alembic check`, `tsc --noEmit`, `npm run lint` (çıkış 0), `expo export --platform ios` temiz. Mutasyon: bağlantı kilidini kaldırmak 3, silmede sürüm kontrolünü kaldırmak 1 backend testini kırdı; mobilde (hep yeni kimlik, çakışmada kaydetme, geç yanıtı atmama, yanlış sürüm, son kopya gelmeden "keep") 5/5 mutasyon test kırdı. `UPDATE ... WHERE version = N` koşulunu kaldırmak testleri kırmadı: kilit + satır içi sürüm kontrolü zaten sıralıyor, o koşul ikinci savunma hattı (eşdeğer mutant).
- Doğrulama (canlı API, **ekran değil**): 4 geçici hesapla (iki antrenör, sporcu, yabancı) 38/38 kontrol geçti: yukarıdaki kuralların tamamı gerçek servis üzerinde (6 eşzamanlı düzenlemeden tam 1'i kazandı). Geçici hesaplar yalnızca kimlikleriyle silindi; DB tekrar 3 kullanıcı, 24 antrenman, 21 set, 0 bağlantı, 0 geri bildirim, 96 egzersiz.
- **Telefon/simülatör etkileşimi YAPILMADI; bu özelliğin hiçbir ekranı gözle veya dokunuşla doğrulanmadı.** Yalnızca sessiz izin yoklaması çalıştırıldı (Ekran Kaydı ve Erişilebilirlik bu kez "verilmiş" görünüyor; hiçbir izin değiştirilmedi, istem açılmadı) ancak Adım 45'te dokunma gönderimi izinden bağımsız olarak cihaza ulaşmadı ve iki hesaplı akış, kullanıcının gerçek oturumu olan cihazda Expo Go kurulumu/çıkışı gerektirdiğinden başlatılmadı. Elle doğrulanacak akış: antrenör hesabında sporcunun bitmiş antrenmanı → "Write feedback" → yaz → kaydet (uyarı çıkmalı) → sporcu hesabında aynı antrenman (geri bildirim görünmeli) → antrenör düzenler → sporcu ekranı yeniden odaklanınca günceller → sporcu paylaşımı kapatır → antrenör bölümü kaybolur/erişim mesajı → sporcu geri bildirimi hâlâ görür.
- Bilinen sınırlar: taslak yalnızca bellekte tutulur (uygulama kapanırsa kaybolur; aynı antrenmana dönülünce korunur); sporcu yeni geri bildirimi ekran odağa gelince görür (anlık değil); geri bildirim sporcuya ayrıca bildirilmez; migration'ın `downgrade()` işlevi (tabloyu siler) yazıldı ama hiç çalıştırılmadı.

### Adım 45: Antrenör–sporcu akışlarının mobil kullanılabilirlik ve regresyon doğrulaması — 25 Ekim 2026

- Kapsam: yeni özellik yok; amaç mevcut antrenör–sporcu akışlarını ekran etkileşimiyle doğrulamaktı. Önceki kilometre taşı (Adım 44) tamamlanmış ve push edilmişti (yerel ve uzak uç `58f1eaa`).
- **Ekran etkileşimi YAPILAMADI; bu adım doğrulanmış sayılmaz.** Denenenler ve sonuçları: (1) Bu Xcode kurulumunda `Simulator.app` yok, yerine `DeviceHub.app` var. DeviceHub açılıyor, yalnızca bu iş için oluşturulan geçici bir iPhone 17 cihazı seçilebiliyor ve `simctl io screenshot` ile cihazın ekranı okunabiliyor; Expo Go kurulumu/başlatması bu aşamaya gelinmeden durduruldu. (2) Dokunma gönderilemedi: Sistem Olayları'nın `click at` komutu yalnızca erişilebilirlik eylemi gönderiyor, cihaz yüzeyi yanıt vermedi; gerçek fare olayı (CGEvent, `clickState` dahil) gönderildi ve cihaz ekran görüntüsü birebir aynı kaldı (ana ekrandaki bir simge açılmadı). `simctl` dokunma/yazma komutu sunmuyor. (3) Neden kesinleştirilemedi: Ekran Kaydı izni olmadığından masaüstü görüntüsü alınamıyor (`screencapture` reddedildi ve macOS'un "Ekran Kaydı" uyarısı açıldı), bu yüzden DeviceHub penceresinin gerçek konumu doğrulanamadı; yani olayların cihaza ulaşıp ulaşmadığı bilinmiyor. Aynı otomasyon yolu başka tekrar denenmedi.
- Yan etkiler: Konumu doğrulayamadan gönderilen iki tıklama başka pencerelere denk geldi (Saat uygulamasında bir metin öğesi ve macOS "Ekran Kaydı" uyarı penceresi); izin uyarısı yanıtlanmadı ve hiçbir işletim sistemi izni değiştirilmedi (uyarı kullanıcı yanıtlayana kadar ekranda kalabilir). iPhone 18 Pro cihazında gerçek bir hesabın açık oturumuyla Expo Go zaten kuruluydu; yalnızca uygulama bir kez açıldı (Metro'ya bağlandı), çıkış yapılmadı ve hiçbir şeye dokunulmadı; cihaz yeniden kapatıldı. Geçici iPhone 17 cihazı silindi, DeviceHub kapatıldı, Metro durduruldu.
- Etkinleştirmek için asgari adımlar: ekran etkileşimi ancak (a) bu oturumu çalıştıran uygulamaya Ekran Kaydı (ve Erişilebilirlik) izninin kullanıcı tarafından Sistem Ayarları > Gizlilik ve Güvenlik'ten verilmesiyle pencere konumu doğrulanıp tıklamalar kalibre edilebilirse, ya da (b) iOS simülatörüne dokunma gönderebilen bir araç (örn. `idb` veya Maestro) kullanıcı tarafından kurulursa, ya da (c) akışlar gerçek telefonda/Expo Go ile elle denenirse mümkün. Bu adımda hiçbiri otomatik yapılmadı.
- Yapılabilen: yalnızca **canlı API düzeyi** tam yolculuk, 2 geçici hesapla (sonra yalnızca kimlikleriyle silindi; veritabanı yine 3 kullanıcı, 24 antrenman, 21 set, 0 bağlantı/davet/teklif), 32 kontrolün 32'si geçti: antrenör etkinleştirme, davet, sporcunun antrenörü önizleyip (e-posta yok) açıkça kabul etmesi, paylaşım kapalıyken liste/özetin gizli olması, paylaşım açılınca doğru etkinlik özeti, salt okunur antrenman detayı, egzersizin önceki seansları (2 sayfa, yinelenmeyen 4 seans), uzun/özel karakterli adla program önizleme (parmak izi) ve gönderme, aynı işlem kimliğiyle tekrarın aynı teklifi dönmesi, bayat önizlemenin 412 ile reddi ve yeniden onayla gönderim, teklif reddi (kopya yok), kabul (pasif kopya; mevcut aktif program aktif kaldı), kopyayı etkinleştirme, şablondan antrenman başlatma, geçerli set, bitirme, antrenörün yeni antrenmanı ve setini görmesi, paylaşımı kapatınca liste/detay/geçmişin 403 olması ve özetin düşmesi, program akışının paylaşımdan bağımsızlığı, bağlantı bitince antrenör 404'ü ve iki tarafta boş listeler, kabul edilmiş kopyanın bağlantıdan bağımsız kalması. Bu bir ekran doğrulaması değildir.
- Hata/düzeltme: bu turda somut bir hata bulunmadı ve hiçbir kod değişmedi; bu yüzden yeni test eklenmedi ve testler yeniden koşulmadı (son durum: backend 640, mobil 384 test; Adım 44).
- Doğrulanmamış kalanlar (hepsi ekran etkileşimi gerektirir): Training → Profile → My Athletes/My Coaches gezinmesi ve geri düğmesinin doğru ekrana dönmesi, güvenli alan ve başlık yerleşimi, davet kodu girişi ve klavye davranışı, kaydırma/sayfalama/çekerek yenileme/yeniden dene düğmeleri, onay Alert'leri ve meşgul/pasif düğmeler, uzun program/egzersiz/sporcu adları, büyük yazı ve VoiceOver, kontrollü ağ hatasıyla yenileme/yeniden deneme, yüklenme/boş/erişilemez/hata durumlarının görünümü, antrenör ekranlarında düzenleme denetimi olmaması, çıkış/hesap değişiminde önceki kullanıcının verisinin görünmemesi, Adım 44 paneli (aç → sayfa yükle → kapat → yeniden aç). Bu davranışların mantığı yalnızca sahte API'li store testleriyle ve backend testleriyle kanıtlı, ekranda görülmüş değildir.

### Adım 44: Antrenörün sporcunun egzersiz geçmişini salt okunur görmesi — 25 Ekim 2026

- Amaç ve sınır: Antrenör, sporcunun paylaşılan tamamlanmış bir antrenmanındaki bir egzersizden "Earlier sessions" ile o egzersizin sporcudaki önceki seanslarını ayrı bir panelde görür. Yalnızca kaydedilenler gösterilir: tarih, antrenman adı, set no, ağırlık (birimle), tekrar, RIR. Gelişme/kalite/kuvvet yorumu, grafik, PR, tahmini 1RM, öneri, düzenleme ve kayıt yoktur.
- Uç: `GET /coaching/athletes/{link_id}/workouts/{workout_id}/exercises/{exercise_id}/history?limit&cursor` (limit 1–50, varsayılan 10; `Cache-Control: no-store`). Yeni tablo/migration yok; `alembic check` temiz. Yanıt yalnızca `items[{workout_id, title, performed_at, sets[{set_number, weight_kg, reps, rir, is_warmup}]}]` ve `next_cursor` taşır; not, süre, kapanış biçimi, kilo, beslenme, profil dönmez.
- Yetki (her istekte veritabanından): oturumdaki antrenör + aktif bağlantı + `shares_workouts` (kapalıysa 403; başkasının/bitmiş/bilinmeyen bağlantı 404, sporcu bu yolu kendi bağlantısında kullanamaz); sonra `workout_id` sporcunun, tamamlanmış (`finished_at IS NOT NULL`) ve istenen egzersizden en az bir set (ısınma dahil, antrenörün baktığı antrenman bu) içeren antrenmanı olmalı, aksi 404. Sporcu kimliği istemciden alınmaz; tüm sorgular bağlantıdan bulunan sporcuya kısıtlıdır. Kapatma/sonlandırma sonraki isteği ve eski bir devam işaretçisini de keser (403/404).
- Geçmiş anlamı (sporcunun kendi egzersiz geçmişiyle aynı sorgu): `workouts.service.earlier_exercise_sessions` ortak, yetkilendirme yapmayan çekirdek; kullanıcıya özel uç onu `load_exercise` ile çağırır, davranışı değişmedi (mevcut geçmiş/önceki-seans testleri geçti). Seans = aynı sporcunun tamamlanmış antrenmanı, `performed_at` açılış antrenmanından KESİN olarak önce (aynı anda başlayan hariç, açılış antrenmanı hiç gelmez), aynı egzersiz KİMLİĞİNDEN en az bir çalışma seti (ısınma değil, `reps > 0`) var. Döndürülen setler yalnızca bu çalışma setleridir (`set_number, id` sırası); 0 kg geçerli, RIR 0 ile boş RIR ayrı. Isınma satırı hiç gelmez (mevcut sözleşme); ekranda `W` rozeti yalnızca savunmadır. İsimle eşleştirme/birleştirme yok: aynı adlı iki egzersiz kimliği ayrı geçmiştir. Aynı ad/tarih/setli ayrı antrenmanlar ayrı satırdır.
- Sıra ve sayfalama: `performed_at DESC, id DESC`; devam işaretçisi `(performed_at, id)` konumunu ve bağlamı (bağlantı, açılış antrenmanı, egzersiz) taşır. Başka bağlamda kullanılırsa 422 (bağlam değiştirme reddi); işaretçi yetki vermez, yalnızca daraltır. Aynı zaman damgalı seanslar `id` ile kararlı sıralanır; sayfalar arasında silinen/eklenen seans sınırı kaydırmaz. Sorgu sayısı sayfa boyutuna ve set sayısına bağlı değil (kimlik doğrulama, bağlantı, açılış antrenmanı, üyelik, seanslar, setler; testte 1 ve 6 seanslık sayfa aynı sayıda ifade).
- Mobil: koç antrenman detayında her egzersiz kartında "Earlier sessions" (etiket: "Earlier sessions of <egzersiz>"; 44 pt). Panel, sporcunun kendi `ExerciseHistory` kalıbında Modal + tek kaydırmalı liste (güvenli alan, geri/arka plan/✕ tek kapatma yolu); başlıkta egzersiz ve sporcu adı. Durum `athleteExerciseHistory.ts` store'unda: hesap + bağlantı + antrenman + egzersiz bağlamına bağlı; aynı anda tek istek (yükle/yeniden dene çift dokunuşa karşı), sayfa hatasında yüklenen satırlar kalır ve aynı sayfa yeniden istenir, kapatıp açma baştan yükler, kapanış/bağlam değişimi/çıkış sonrası gelen yanıtlar atılır. 403: panel kapanır, satırlar silinir ve mevcut `athleteWorkoutsStore.revoke("not_shared")` yolu çağrılır (sporcu ekranı + `followDenials` ile liste kartı). 404'ün nedeni (bağlantı mı, antrenman mı) yanıttan anlaşılmadığı için tahmin edilmez: satırlar silinir, "no longer available" gösterilir ve olağan `refreshAthleteView` çalışır; bağlantı/izin gittiyse o yol doğru nedenle iptal eder. Antrenman ekranından ayrılma, çıkış ve oturum bitimi paneli ve verisini siler. Sporcunun düzenlenebilir antrenman ekranı değiştirilmedi.
- Doğrulama: backend 640 (37'si yeni), mobil 384 (37'si yeni) test; ruff check, mypy (app + yeni test), `alembic check`, typecheck, sıfır uyarılı lint (çıkış 0) ve `expo export --platform ios` temiz. Koruma kaldırma (mutasyon) denemeleri: backend'de 7/7 (bağlam kontrolü, tamamlanmış/sahip açılış antrenmanı, egzersiz üyeliği, sporcu filtresi, `id` tie-breaker, paylaşım anahtarı) ilgili testleri kırdı; mobilde 8 denemenin 7'si kırdı, 8.'si (`request()` içindeki ikinci çift-istek koruması) `loadMore/retry` korumalarıyla örtüştüğü için davranışı değiştirmedi. Yerel API'de 3 geçici hesapla (sonra yalnızca kimlikleriyle silindi; veritabanı yine 3 kullanıcı, 24 antrenman, 21 set, 0 bağlantı/davet, 96 egzersiz) 24 kontrol geçti: paylaşım kapalı 403, sayfalama/sıra/yinelenmeme, eş zaman damgası, 0 kg ve RIR 0/boş, ısınma ve başka egzersiz dışlama, açılış/sonraki/açık antrenmanın hariçliği, ilgisiz antrenör ve sporcunun kendisi 404, egzersiz antrenmanda yok 404, başka antrenmanda/bozuk/büyük limit işaretçisi 422, izin kapatınca eski işaretçi 403 (yeniden açınca çalışır), bağlantı bitince 404, sporcunun kendi geçmişiyle aynı seanslar.
- Sınır: Ekran etkileşimi YAPILAMADI. Bu makinedeki Xcode kurulumunda `Simulator.app` yok; iPhone 17 yalnızca başsız açılabildi ve `simctl` dokunma/yazma gönderemiyor, erişilebilirlik izni ise değiştirilmedi. Bu yüzden liste → sporcu → antrenman → egzersiz geçmişi → sayfalama → kapat/geri akışı hiçbir cihazda/simülatörde ekran üzerinde denenmedi; yerleşim, güvenli alan, büyük yazı, VoiceOver, Android geri tuşu ve dokunma hedefleri doğrulanmadı. Mobil davranış sahte API'li store testleri, bileşen ağacını doğrudan çağıran panel testleri ve kaynak taramalarıyla kanıtlandı, ekran etkileşimiyle değil. Çok sayfalı geçmiş sabit bir veri anının kopyası değildir (sayfalar arasında yapılan düzenleme sonraki sayfaları etkileyebilir; kapatıp açmak yeniler). Antrenörün adı bağlantı listesi yüklenmemişse "This athlete" olarak görünür. Gerçek iki hesapla uçtan uca (iki cihaz) deneme yapılmadı.

### Adım 43: Antrenörün sporcu listesinde kayıtlı antrenman özeti — 25 Ekim 2026

- Amaç ve sınır: "My Athletes" kartı, antrenmanını paylaşan her sporcu için kayıtlı etkinliğin olgusal özetini gösterir. Bir uyum/ilerleme puanı değildir: sıralama, seri, yüzde, "pasif" uyarısı ya da renk yok.
- Uç: `GET /coaching/athletes/overview?limit&offset&as_of` (antrenör araçları şart, aksi 403). Yalnızca çağıranın aktif bağlantılarını, mevcut liste sırasıyla (`created_at DESC, id`) sayfalar. Yeni tablo/migration yok; `alembic check` temiz.
- Tanımlar (mevcut kanonik tanımlar): tamamlanmış antrenman = `finished_at IS NOT NULL`; çalışma seti = ısınma değil ve `reps > 0` (haftalık hacim/teşhis/egzersiz geçmişiyle aynı); 0 kg geçerli set sayılır. Not: `workouts.total_sets` sıfır tekrarlı ısınma-dışı satırı da sayar, bu özet saymaz; yalnızca böyle bir satır olan seansta ikisi farklı çıkar. Sunucuda kesinleşmemiş set `sets` tablosunda yoktur (işlem makbuzu aynı işlemde yazılır), bu yüzden sayılmaz ve aynı isteğin tekrarı ikinci kez sayılmaz.
- Pencere: tek, sabit 28 günlük kayan pencere; yarı açık `start <= performed_at < end`, `end` = istek anı (ya da sonraki sayfalarda ilk sayfanın döndürdüğü `as_of`), `start = end - 28 gün`. Katılımı `performed_at` belirler (analitikle aynı). Takvim haftası/saat dilimi kesimi kullanılmadı: pencere yanıttaki tüm sporcular için aynı olmalı. `as_of` yalnızca son 24 saat içinde geçmişte bir an olabilir (aksi 422), böylece eski dönemleri okumak için kullanılamaz. Sınırlar yanıtta `window` olarak döner; arayüz kendi hesabını yapmaz.
- Kart verisi: `activity` paylaşmayan sporcu için `null` (sıfır değil; bu bağlantılar için antrenman sorgusu hiç çalışmaz); paylaşan için `latest_workout` (tüm zamanların son tamamlanmış seansı, `performed_at < end`, eşitlikte `id` ile deterministik; pencereden bağımsız), `workouts_in_window`, `working_sets_in_window`. Notlar, hacim, süre, RIR, vücut ağırlığı dönmez. Paylaşan ama kaydı olmayan sporcu "No completed workouts recorded" olarak gösterilir.
- Sorgu: sayfa başına iki ifade (aktif bağlantı sayısı + tek sayfa sorgusu; her satır için `LATERAL` toplam ve son-seans aramaları, ikisi de `shares_workouts` koşuluyla korunur). Sporcu başına döngü yok; ifade sayısı sayfa boyutuna bağlı değil (testte 1 ve 6 satırlık sayfa aynı sayıda ifade). Yinelenen birleştirme `count(distinct workouts.id)` ve set kimliği sayımıyla korunur. İzin ve veri aynı ifadeden gelir, bu yüzden eşzamanlı kapatma/sonlandırma tutarsız (izin kapalı ama sayı dolu) bir satır üretemez; yanıt `Cache-Control: no-store`.
- Mobil: kartlar tek istekle ( `athleteOverview.ts` store'u) gelir; odakta tek yenileme, sayfalama ilk sayfanın `window.end` değerini `as_of` olarak taşır, farklı pencereyle gelen sayfa atılır. Hesap değişimi/çıkış/oturum bitimi veriyi siler ve geç yanıtları yok sayar (`AuthContext` sıfırlaması dahil); 403'te veri silinir, sıradan yenileme hatasında önceki veri kalır ve yeniden deneme sunulur. Bağlantı sonlandırılınca kart anında kalkar; sporcu ekranı izin kapalı/bağlantı bitti öğrenirse karttaki sayılar anında düşer (`followDenials`). Kart metni "Recorded in the last 28 days", "N workouts · M working sets", "Latest: ad · tarih", "Workout sharing is off". Kart hâlâ sporcu ekranını açar; davet ve sonlandırma akışları değişmedi.
- Doğrulama: backend 603 (30'u yeni), mobil 347 (24'ü yeni) test; ruff, mypy, `alembic check`, typecheck, sıfır uyarılı lint ve `expo export --platform ios` temiz. Koruma kaldırma denemeleri: sorguda 12, mobilde 15 değişiklik ilgili testleri kırdı. Yerel API'de 4 geçici hesapla (sonra yalnızca kimlikleriyle silindi; veritabanı yine 3 kullanıcı, 24 antrenman, 2 program, 0 bağlantı/davet/teklif) denendi: farklı izinli iki sporcu, pencere dışı ve yarım kalmış antrenman, ısınma/0 kg/sıfır tekrar, ilgisiz antrenör boş liste, `as_of` 422, sayfalarda aynı pencere, izin kapatma ve bağlantı sonlandırma sonrası verinin düşmesi.
- Sınır: Gerçek simülatör hesabında antrenör araçları kapalı olduğundan derin bağlantıyla yalnızca "Coach tools" kartı render edilip görüldü (ekran derlendi/açıldı); hesaba müdahale edilmediği için sporcu kartları cihazda görülmedi. Dokunma, kaydırma/sayfalama, çekerek yenileme, büyük yazı ve VoiceOver cihazda doğrulanmadı; mobil davranış sahte API'li store testleriyle kanıtlandı, ekran etkileşimiyle değil. Canlı kontrol API düzeyindedir. Çok büyük sporcu kümelerinde LATERAL sorguların performansı ölçülmedi.

### Adım 42: Antrenörün programı sporcuya göndermesi, sporcunun kabul etmesi — 25 Ekim 2026

- Model: `program_offers` tablosu (migration `d5e92b7f3a18`, yalnızca yeni tablo). Teklif tek bir bağlantıya (`link_id`) bağlıdır ve gönderim anındaki programın dondurulmuş kopyasını (`snapshot`) taşır: gün/egzersiz sırası, set, tekrar aralığı, RIR/RPE ve program/gün/egzersiz notları. Antrenman kaydı, kilo veya profil verisi içermez. Kaynak program sonradan değişse ya da silinse sporcunun gördüğü değişmez. Notlar için uygulamada ayrı bir "özel not" ayrımı yok ve ekranlarda hiç gösterilmiyorlardı; bu yüzden antrenörün onay ekranında program, gün ve egzersiz notlarıyla birlikte gösterilir ve sporcu aynılarını inceleme ekranında görür.
- Önizleme–gönderim tutarlılığı: Onay ekranındaki içerik istemcide üretilmez; `GET /coaching/athletes/{link_id}/program-preview/{program_id}` sunucunun kuracağı anlık görüntüyü ve bir parmak izini (antrenör + bağlantı + program + içeriğin SHA-256'sı) döner. Gönderim bu parmak izini taşır, istemciden içerik kabul edilmez. Sunucu bağlantıyı kilitler, programı ve günlerini paylaşımlı satır kilidiyle okur (bir düzenleme sürerken gönderim bekler, gönderim sürerken düzenleme bekler), anlık görüntüyü kendisi kurar, parmak izini bu nesneyle karşılaştırır ve saklanan da aynı nesnedir; karşılaştırma ile kayıt arasında ayrı bir okuma yoktur. Eşleşmezse 412 ("program onaydan sonra değişti, güncel hâlini inceleyip tekrar onayla") döner ve hiçbir teklif oluşmaz; kaynak silindiyse 404, bağlantı bittiyse 404. Gönderim makbuzu (`request_id`) içerik parmak izini de kapsar: başarılı bir gönderimin tekrarı kaynak değişmiş olsa da özgün teklifi döner (200), yeni içeriğe verilen yeni onay ise yeni bir işlem kimliğiyle gider ve eski teklifi yeniden oynatmaz (aynı kimlikle farklı içerik 409).
- Sahiplik: Antrenör yalnızca kendi programını ve yalnızca aktif bağlantısındaki sporcuya gönderir (`PUT /coaching/athletes/{link_id}/program-offers/{request_id}`; sporcu kimliği alınmaz). Sporcu teklifleri `GET /coaching/program-offers[/{id}]`, `.../accept`, `.../decline` ile yönetir. Kabul, sporcuya ait yeni ve **pasif** bir program üretir; aktif programa dokunmaz, mevcut bir programı birleştirmez/ezmez. Antrenör kopyayı okuyamaz, etkinleştiremez, silemez; kopyanın kimliğini de görmez. Program alma `shares_workouts`'tan bağımsızdır.
- Güvenilirlik: Aynı programın ikinci bekleyen teklifi kısmi benzersiz indeksle engellenir. Kabul/ret önce bağlantı satırını, sonra teklifi kilitler (`end_link` ile aynı satır), bu yüzden bağlantı bittikten sonra gelen eski bir istek reddedilir; eşzamanlı kabullerde tek kopya oluşur. Program, günler, egzersizler ve teklif durumu tek işlemde yazılır; kullanılamayan egzersiz varsa hiçbir şey oluşmaz (409, egzersiz adlarıyla). Bağlantı bitince bekleyen teklifler her iki taraf için de erişilemez olur; yeniden bağlanma yeni bağlantıdır ve eski teklifleri (ve eski bağlantıya ait onayları) göstermez. Kabul edilmiş kopya bağlantıdan ve kaynaktan bağımsız kalır.
- Mobil: "My Coaches" içinde "Received programs" girişi, sporcu ekranında "Send a program". Gönderme ekranı antrenörün programlarını listeler, sunucunun önizlemesini (alıcı + günler + her egzersizin reçetesi + notlar) gösterir, açık onayla gönderir; 412 gelirse güncel önizlemeyi yükler ve yeni bir açık onay bekler. Alıcı tarafta inceleme, kabul/ret ve "Open my copy" bağlantısı. Durum ayrı bir store'da (`programOffers.ts`): kullanıcıya bağlı, çıkışta/oturum bitiminde sıfırlanır, 404'te teklif ekrandan silinir, kabul/ret/gönderim çift dokunuşa karşı kilitli, kayıp kabul/ret yanıtında sonuç geri okunur, belirsiz gönderim aynı içerik onayı için aynı işlem kimliğiyle tekrarlanır, yeniden incelenen içerik yeni kimlik alır.
- Doğrulama: backend 573, mobil 323 test; ruff, mypy, `alembic check`, typecheck, sıfır uyarılı lint ve `expo export --platform ios` temiz; koruma kaldırma (mutasyon) denemeleri ilgili testleri kırdı. Yerel API'de geçici hesaplarla (sonra yalnızca kimlikleriyle silindi) iki akış çalıştırıldı: gönder → önizle → kabul → pasif kopya → etkinleştir → şablondan antrenman başlat (ret, kopya teklif, kopma, yeniden bağlanma dahil) ve bayat önizleme senaryosu (başka cihazda düzenleme → 412 → yenile → yeniden onay; başarılı gönderimin değişen kaynakla tekrarı; silinen kaynak; biten bağlantı). Migration, ayrı bir deneme veritabanında zincirin tamamı kurulup mevcut veri korunarak yükseltildi ve geri alındı.
- Sınır: Simülatörde yalnızca "Received programs" ekranı derin bağlantıyla açılıp boş durumu görüldü; sonraki turda bu ortamda Simulator uygulaması çalışmadığından (cihaz başsız) ve dokunma/UI betiği mümkün olmadığından hiçbir düğmeye dokunulamadı. Gönderme/önizleme/yeniden onay/kabul/ret ekranlarının görünümü, Alert akışı, klavye, kaydırma ve VoiceOver cihazda doğrulanmadı; mobil davranış sahte API'li store testleriyle kanıtlandı, ekran etkileşimiyle değil. Gönderimle eşzamanlı bir düzenleme kilit yüzünden sıralanır; bu sıralama (gönderimden önce/sonra) backend testleriyle ve yerel API'de doğrulandı, ama gerçek iki cihazla denenmedi.

### Adım 41: Bağlı sporcunun tamamlanmış antrenmanlarını salt okunur görme — 25 Ekim 2026

- İzin modeli: `coach_athlete_links.shares_workouts` (migration `c4d81f6a2b90`, yalnızca ekleme). Her bağlantıda varsayılan kapalı; mevcut bağlantılar kapalı kalır, yeni davet/yeniden bağlanma da kapalı başlar. Yalnızca sporcu `PUT /coaching/links/{id}/workout-sharing` ile açıp kapatır (antrenör 403, ilgisiz kullanıcı 404); açarken ekranda tüm tamamlanmış geçmişin paylaşılacağı yazılı bir onay çıkar. Kilo, beslenme, profil ve antrenman notları paylaşılmaz.
- Antrenör uçları (`GET /coaching/athletes/{link_id}/workouts[/{workout_id}]`) sporcu kimliği almaz; bağlantı kimliğinden sporcuyu bulur ve her istekte oturumdaki antrenörü, aktif bağlantıyı, izni ve antrenmanın o sporcuya ait ve tamamlanmış olduğunu veritabanından doğrular. Yalnızca ekranın çizdiği alanlar döner. Kapatma veya sonlandırma erişimi anında keser; mevcut kullanıcıya özel uçlara dokunulmadı.
- Mobil: "My Athletes" satırı sporcu ekranını açar (`coaching/athlete/[linkId]`), oradan salt okunur antrenman detayı. Durum ayrı bir store'da (`athleteWorkouts.ts`), kullanıcı + bağlantıya bağlı; çıkışta/oturum bitiminde sıfırlanır, 403/404 yanıtında eski veri silinir, sıradan yenileme hatasında korunur. İzin kapalıysa antrenman isteği hiç gönderilmez. Süre anlamı sporcunun kendi geçmişiyle aynı (otomatik kapanan/bilinmeyen süre gösterilmez).
- Doğrulama: backend 499, mobil 289 test; ruff, mypy, `alembic check`, typecheck, sıfır uyarılı lint ve `expo export --platform ios` temiz. Yerel API'de 3 geçici hesapla (sonra yalnızca kimlikleriyle silindi) tüm akış çalıştırıldı; migration, ayrı bir deneme veritabanında mevcut bağlantıyı koruyup kapalı bırakarak ve geri alınarak denendi.
- Sınır: Yeni ekranlara simülatörde dokunulmadı (erişilebilirlik izni olmadığından düğmelere basılamadı); görünüm, Switch/Alert davranışı, kaydırma ve VoiceOver cihazda doğrulanmadı. Mobil davranış store testleriyle (sahte API) kanıtlandı, ekran etkileşimiyle değil.

### Adım 40: Antrenör–sporcu bağlantısının temeli — 24 Ekim 2026

- Backend: `users.coach_enabled` (varsayılan false; mevcut kullanıcılar korunur), `coach_invites` ve `coach_athlete_links` tabloları (migration `b7e3a91c5d24`, yalnızca ekleme yapar) ve `/coaching` uçları: antrenör araçlarını açma, 12 karakterli (≈60 bit) 48 saatlik tek kullanımlık davet kodu (veritabanında yalnızca SHA-256 özeti), kodu önizleme, açık onayla kabul, iki taraf için bağlantı listesi, iki tarafın da sonlandırması. Tek kullanım `UPDATE ... WHERE accepted_at IS NULL` ile, "çift aktif bağlantı yok" kısmi benzersiz indeksle korunuyor. Sonlandırılan bağlantı eski kodla yeniden açılamıyor.
- Antrenör olmak hiçbir veriye erişim vermiyor ve bu aşamada bağlantı üzerinden antrenman, kilo veya beslenme verisi paylaşılmıyor. Hesap türü ayrımı yok: antrenör kendi kişisel antrenmanını kullanmaya devam ediyor.
- Projede daha önce hız sınırlama yoktu; kod çözen uçlar için hesap başına 10 yanlış kod / 10 dakika sınırı eklendi. Bu sınır süreç belleğinde tutuluyor (çok süreçli dağıtımda paylaşılmaz). İnceleme düzeltmesi: deneme önce yalnızca arama sonrasında sayılıyordu, bu yüzden 30 eşzamanlı yanlış kodun 11'i geçti; artık deneme aramadan önce sayılıyor, gerçek kod bulunursa geri alınıyor (canlı API'de 60 eşzamanlı denemede tam 10 tanesi 404 aldı).
- Mobil: Profile → "My Coaches" (kod gir, antrenörü gör, açıkça bağlan) ve "My Athletes" / "Coach Tools" (araçları aç, kod üret, sporcuları gör, sonlandır). Çift basış kilidi, kaybolan yanıtta sonucu yeniden okuma, çıkış/kullanıcı değişiminde temizlik ve geç yanıtların yok sayılması `src/coaching/coachingStore.ts` içinde.
- Mobil inceleme düzeltmeleri: kod aranırken metin değişirse geç gelen önizleme artık görünen kodla eşleştirilmiyor (yanlış antrenör + "Connect" gösterebiliyordu); etkinleştirme sonrası profil yenilenemezse ekran sessiz kalmıyor, mesaj gösteriyor.
- Doğrulama: backend 472 test, `ruff check`, mypy ve `alembic check` temiz; mobil 260 test, typecheck, sıfır uyarılı lint temiz. Yerel API'de 3 geçici hesapla (sonra yalnızca kimlikleriyle silindi; geliştirme veritabanı yine 3 özgün kullanıcı, 0 davet/bağlantı) akış gerçekten çalıştırıldı: etkinleştirme → davet → önizleme (kod tüketilmedi) → iki kullanıcının eşzamanlı kabulü (201 + 409) → iki tarafta liste → üçüncü kişi sonlandıramadı (404) → bağlı antrenör sporcunun antrenmanını göremedi → sonlandırma → eski kod 409 → yeni davetle yeniden bağlanma. Ham kod ne logda ne veritabanında bulundu.
- Sınır: Yeni ekranlara simülatörde dokunulmadı (erişilebilirlik izni olmadığından düğmelere basılamadı); mobil akış yalnızca store testleri ve tip/lint ile doğrulandı. Ekran düzeltmeleri için etkileşim testi yok. Antrenör doğrulama rozeti, program atama, mesajlaşma, bildirim ve veri paylaşımı kapsam dışı.

### Adım 39: Roman tema, Research ekranı ve commit kapsamı — 23 Ekim 2026

- Backend: PubMed (NCBI E-utilities) yayın kayıtlarını sunan `research` domain'i ve `NCBI_API_KEY` / `NCBI_EMAIL` ayarları; `httpx` artık çalışma zamanı bağımlılığı.
- Mobil: cursor sayfalamalı Research ekranı (PMID ile tekrar önleme, hata sonrası yeniden deneme, geç yanıt koruması, PMID eşleşmesi doğrulanan PubMed bağlantısı), Training'den açılış ve geçmişsiz deep-link için `(tabs)` çapası.
- Roman tema (`romanTheme.ts`, yerel Cinzel ve Plus Jakarta Sans fontları) giriş, kayıt, Training, aktif antrenman, Programs, program detayı, Volume, Profile ve Research ekranlarına uygulandı; `theme.ts` değişmedi. Geri düğmesi yalnızca ok gösteriyor; RIR açıklama satırı ve "Plan and log" kart başlığı kaldırıldı (RIR alanı duruyor).
- Doğrulama: 243 mobil test, typecheck ve sıfır uyarılı lint geçti; backend 424 test, `ruff check` ve mypy geçti. `research-navigation` testi kaynak-metin taramasıdır, native gezinme kanıtı değildir.
- Sınır: Bu ekranların hiçbiri telefonda veya simülatörde denenmedi; canlı PubMed bağlantısı da denenmedi. Docker Compose'daki yerel PostgreSQL port değişikliği commit dışında bırakıldı.

### Adım 38: Egzersiz geçmişini ayrı panelde göster — 30 Eylül 2026

Kullanıcı kabulü — 23 Ekim 2026: Kullanıcı “tamamdır sıkıntı yok devam edelim” diyerek sonucu kabul etti. Cihaz ve senaryo ayrıntıları verilmediğinden telefon kontrolleri doğrulanmış sayılmadı. Bu turda kod değişikliği veya yeni test koşusu yapılmadı; sıradaki uygulama görevi henüz belirlenmedi.

- Adım 37'de kart içinde büyüyen "All earlier sessions" listesi, `ExerciseHistory`
  içinde React Native `Modal` + `FlatList` ile ekranın büyük bölümünü kaplayan
  ayrı bir panele taşındı. Sabit başlık (gerçek egzersiz adıyla), erişilebilir
  kapatma düğmesi ve tek yönlü kayan `FlatList`; kapatma düğmesi, Android geri
  tuşu ve arka plana dokunma aynı kapatma akışını paylaşıyor. Panel açılmadan
  istek gönderilmiyor; sayfalama, hata sonrası yeniden deneme, çift istek
  engeli ve kapatıp-açma sonrası baştan yenileme davranışları korundu.
  Antrenman ekranı, set taslakları ve dinlenme sayacı yeniden mount edilmedi.
- Bu turda panel sertleştirildi: kullanımdan kaldırılmış (deprecated) ve yalnızca
  iOS'ta çalışan React Native `SafeAreaView` yerine mevcut bağımlılık
  `react-native-safe-area-context` (`SafeAreaProvider` + `SafeAreaView`)
  kullanıldı; arka plan paneli saran `Pressable` olmaktan çıkarılıp kardeş
  eleman yapıldı (liste kaydırması arka plana ulaşamaz); egzersiz adı 2 satıra
  kadar gösteriliyor; kapatma düğmesinin etiketi "Close exercise history"; ilk
  yükleme hatası ile sonraki sayfa hatası ayrı metinlerle gösteriliyor.

Doğrulama: **164 mobil test geçti** (egzersiz geçmişi testlerine panel yapısı,
çift dokunuş, yinelenen seans, geç yanıt ve ilk sayfa hatası testleri eklendi);
`tsc --noEmit` ve sıfır uyarıyla ESLint temiz; `git diff --check` temiz.
Backend/API/bağımlılık değişmedi. Expo `~57.0.20`, RN 0.86.3 doğrulandı.
**Gerçek telefon veya simülatörde denenmedi** (bu makinede açık simülatör ve
`adb` yok); testler bileşenleri stub'lı hook'larla çalıştırıyor, native
düzeni kanıtlamaz. Telefonda bakılacaklar: panel yüksekliği ve alt güvenli
alan (Android gezinme çubuğu), büyük yazı boyutu, uzun liste kaydırması,
klavye açıkken panel açma (klavye kapanır, taslaklar kalmalı), Android geri
tuşu, açıp kapattıktan sonra set taslağı / açık düzenleyici / dinlenme sayacı.

**Kod incelemesi (commit öncesi):** Somut hata bulunmadı, ürün kodu değişmedi.
- `Keyboard.dismiss()`: tek `onBlur` işleyicisi `TitleField`'da (başlık, zaten
  yazılmış değer değiştiyse kaydediliyor — tasarlanmış blur-kayıt davranışı).
  Ağırlık/tekrar/RIR alanlarında (`SetForm`, `SetRow`) blur işleyicisi yok;
  taslaklar bileşen state'inde, panel onları mount/unmount etmiyor.
- Eski istekler: her istek kendi `active` bayrağıyla iptal ediliyor (kapanış,
  yeniden açılış, unmount, tekrar deneme). Egzersiz/antrenman/tarih ayrımı
  bileşen içinde değil, çağıranın `key`'leriyle (`workout.id:performed_at:
  exerciseId`) sağlanıyor; bu `key`'ler kodda mevcut ama yalnızca statik
  olarak doğrulandı.
- Testlerin sınırı: testler gerçek React yerine elle yazılmış hook çalıştırıcısı
  kullanıyor. İstek/sayfalama/hata/çift basış mantığı davranış olarak sınanıyor;
  paneldeki yapı ve `key` testleri statik kontroldür. Set taslağı, açık
  düzenleyici ve dinlenme sayacının korunması, safe-area, Android geri tuşu ve
  klavye otomatik testle KANITLANMADI — yalnızca kod okumasıyla çıkarıldı.
- Cihaz doğrulaması: kullanıcı yalnızca sıradaki adıma geçmek istediğini bildirdi;
  hangi telefon senaryolarının denendiği bildirilmedi, bu yüzden telefon
  kontrolü hâlâ bekliyor sayılıyor.

### Adım 37: Egzersizin daha eski seanslarını görüntüleme — 30 Eylül 2026

- Antrenmandaki `Previous session` bölümü açıldıktan sonra `All earlier sessions` ile o egzersizin referans antrenmandan önceki kapanmış seansları görüntüleniyor. Tarih/saat, seans adı, çalışma setlerinin ağırlık/tekrar/RIR bilgisi ve otomatik veya bilinmeyen kapanma açıklaması gösteriliyor. Mevcut önceki-seans ağırlık karşılaştırması korunuyor.
- Yeni `GET /workouts/{workout_id}/exercises/{exercise_id}/history` endpoint'i kullanıcı sahipliğini denetliyor. Yalnızca aynı hesaba ait, referans başlangıcından kesin olarak eski, kapanmış ve ilgili egzersize ait pozitif tekrarlı çalışma seti içeren seanslar dönüyor. Isınma ve sıfır tekrar dışarıda; sıfır ağırlık ve boş/sıfır RIR ayrımı korunuyor. Eski `/previous` endpoint'i aynı sorgu mantığını kullanmaya devam ediyor.
- Liste mobilde 10 seanslık sayfalarla yükleniyor. Tarih ve UUID sırasına dayalı devam işaretçisi, önceki sayfadaki bir seans silindiğinde eski kayıtlara erişimin kaymasını önlüyor; aynı tarihli seanslar kararlı sırada geliyor. Sunucuda sayfa boyutu en fazla 50. Devam işaretçisi hesap veya referans antrenman yetkisi sağlamıyor.
- Bölüm açılmadan geçmiş isteği gönderilmiyor. Sayfa hatasında yüklenen kayıtlar korunuyor, `Retry history` aynı sayfayı yeniden istiyor. Art arda dokunmalar tek sayfa isteği oluşturuyor. Bölümü kapatıp açmak geçmişi baştan yeniliyor; eski veya kapanmış bileşenin yanıtları yeni durumu değiştiremiyor. kg/lb gösterimi mevcut tercihe uyuyor, geçmiş verileri cihazda kalıcı saklanmıyor.

Doğrulama: **386 backend testi** (11 yeni geçmiş vakası dahil) gerçek PostgreSQL `bodytrack_test` veritabanında ve **156 mobil test** (7 yeni geçmiş testi dahil) geçti. Son SQL tip düzeltmesinden sonra ilgili geçmiş testleri tekrar kontrol edildi. TypeScript, sıfır uyarıyla ESLint, backend Ruff kod/biçim kontrolleri ve mypy (uygulama + yeni test dosyası, 53 dosya) temiz. Backend bağımlılıklarının mevcut `crypt`/`datetime.utcnow` uyarıları sürüyor. Şema, migration, bağımlılık ve gerçek antrenman verileri değiştirilmedi.

Sınır: Liste seçili antrenmandan önceki çalışma kayıtlarını gösterir; açık, aynı başlangıç tarihli veya daha yeni seansları içermez. Çok sayfalı geçmiş sabit bir veri anının kopyası değildir; başka cihazda yapılan düzenlemeler veya geçmiş tarihli eklemeler için bölümü kapatıp açarak yenilemek gerekir. Grafik, kişisel rekor veya kuvvet tahmini eklenmedi. Bu yeni görünüm için gerçek telefon testi henüz yapılmadı; `ADIM_37_CIHAZ_KONTROLU.md` açık kontrol listesidir. Adım 34 için alınan önceki telefon kabulü bu yeni adıma taşınmaz.

### Mac üzerinde yeniden doğrulama ve telefon kabulü — 30 Eylül 2026

- Branch `fix/set-input-reliability`; Adım 36'nın dört dosyalık değişikliği incelendi. Mac üzerinde 149/149 mobil test, TypeScript ve sıfır uyarıyla ESLint geçti.
- PostgreSQL dış port eşlemesinin kaldırılması ayrı Mac taşıma değişikliğidir. Docker servisleri çalışıyor; db ve redis sağlıklı, backend `/health` yanıtı başarılı. Bu tur backend testleri yeniden çalıştırılmadı.
- Kullanıcı “tamamdır telefonda test edildi sıradaki adıma geçelin” diyerek telefon testinin tamamlandığını bildirdi. Adım 34 kullanıcı kabulüyle kapatıldı. Cihaz/işletim sistemi, Expo Go sürümü ve madde bazında sonuç verilmedi; Codex cihaz testi yapmış gibi raporlanmadı. Ayrıntılar `ADIM_34_CIHAZ_KONTROLU.md` içinde.
- Aşağıdaki 24 Eylül girdileri, o tarihteki doğrulama durumunu anlatan tarihsel kayıtlardır; telefon kontrolünün beklediğini belirten ifadeler bu kabul kaydıyla güncellenmiştir.

### Adım 36: Set girişinde hassasiyet ve anlaşılır doğrulama — 24 Eylül 2026

- Yeni set formunda ağırlık yazılmadığında önceki setin saklanan kilogram değeri doğrudan kullanılıyor. Ekranda yuvarlanmış kg/lb ipucunu geri çevirerek ağırlık değiştirme sorunu giderildi: örneğin `20.04 kg` kaydı kg görünümünde tekrar eklenince `20 kg` olmuyor. Kullanıcı açıkça yeni bir ağırlık yazarsa kendi biriminden normal dönüşüm uygulanıyor.
- Set ekleme ve düzenleme sırasında geçersiz/negatif ağırlık veya pozitif tam sayı olmayan tekrar için alanların yanında hata gösteriliyor. Kaydet düğmesi artık sessizce durmuyor; taslak korunuyor ve düzeltildikten sonra kaydetmek mümkün.
- Düzenlemede silinmiş veya yalnızca boşluk içeren ağırlığın JavaScript dönüşümüyle `0` olarak kaydedilmesi engellendi. Bilinçli `0` girişi geçerli. Yeni egzersizde henüz önceki set yokken boş ağırlığın `0`, boş tekrarın `8` varsayılanı korunur; önceki setin RIR değeri otomatik kopyalanmaz.
- Telefon kontrol listesi yeni doğrulama senaryolarıyla genişletildi; Adım 35'te kaldırılan kart hedef karşılaştırmasını bekleyen eski madde güncellendi.

Doğrulama: 4 yeni davranış testi dahil **149 mobil test geçti**; tam TypeScript ve sıfır uyarıyla ESLint temiz. Yeni testlerin üçü düzeltme öncesinde gerçek hataları tekrarladı; diğer test yeni egzersizin sıfır ağırlık varsayılanını ve ondalık virgül girişini koruduğumuzu doğruladı. kg/lb tekrar kullanımı, açık ağırlık girişi, geçersiz değerlerde kayıt gönderilmemesi, hata gösterimi, taslağın korunması ve düzeltme sonrası başarı kapsandı. Backend veya veritabanı değişmedi. Gerçek telefon kabul kontrolü bekliyor.

### Adım 35: Egzersiz kartlarının sadeleştirilmesi — 24 Eylül 2026

- Kullanıcının ekran görüntüsünde işaret ettiği, egzersiz adı ile `Previous session` arasındaki metinler bütün egzersiz kartlarından kaldırıldı: `Target`, `Recorded`, çalışma seti kapsam açıklaması, tekrar ve RIR hedef karşılaştırmaları. Aynı kart yapısını kullanan aktif ve bitmiş antrenmanlarda uygulanır.
- Egzersiz adının hemen ardından `Previous session` gelir; önceki seans içeriği, kaydedilmiş setler ve set giriş/düzenleme akışı korunur. Üstteki genel `Plan and log` özeti ayrı kalır. Saklanan başlangıç planı, hedef verileri ve karşılaştırma yardımcıları silinmedi; backend/API veya veritabanı değişmedi.
- Kullanılmayan kart biçimlendirme işlevi, karşılaştırma çağrıları, import ve stiller kaldırıldı.

Doğrulama: Mevcut **145 mobil test geçti**; tam TypeScript ve sıfır uyarıyla ESLint temiz. Yeni görünümün fiziksel telefonda kontrolü henüz yapılmadı. Kullanıcının paylaştığı önceki görünüm, Adım 34'teki bütün kabul senaryolarının geçtiğini göstermediğinden cihaz kontrol listesi açık kalır.

### Adım 34: Birlikte doğrulama ve kullanım akışı düzeltmeleri — 24 Eylül 2026

**Durum: Otomatik kontroller tamamlandı; telefon kabul kontrolü bekliyor.** Bu ortamda telefona erişim veya Android cihaz aracı bulunamadı. Kullanıcıdan Expo Go ile kontrol yapıp yapamayacağı soruldu. `ADIM_34_CIHAZ_KONTROLU.md` dosyasındaki maddeler sonuç gelene kadar açık kalacak.

- Backend testlerinin tamamı gerçek PostgreSQL test veritabanında çalıştırıldı: **375 test geçti**. Bu tur backend kodu değiştirilmedi. Bağımlılıklardan gelen mevcut `crypt`/`datetime.utcnow` kullanımdan kaldırma uyarıları var; test hatası yok.
- Libreyle set düzenlemede iki sorun önce testle tekrarlandı ve düzeltildi: yalnızca tekrar/RIR düzenlenirken ekrandaki yuvarlanmış ağırlığı tekrar kg'ye çevirmek gerçek değeri değiştirebiliyordu; değiştirilen lb ağırlığı ise API'nin iki ondalık sınırını aşabiliyordu. Dokunulmayan ağırlık artık saklanan kg değerini koruyor; bilinçli değişiklik API'ye iki ondalıklı kg olarak gönderiliyor. Kısmi güncellemede hiç gönderilmemiş ağırlık alanı eklenmiyor.
- Antrenman sunucuda bittikten sonra yerel aktif-antrenman işaretçisini temizlemek hata verirse ekrandan çıkış duruyordu. Sunucunun onayladığı bitirme artık yerel temizliğe bağlı değil. Ana ekranın aktif seans çözümlemesinde de temizleme hatası bitmiş seansı tekrar açmıyor veya ekran yüklemesini düşürmüyor. Yanlış/eski işaretçi temizlenemese bile mevcut hesabın sunucu kaydı kontrol ediliyor.
- Bitirme işlemi için eşzamanlılık koruması yalnızca ekrandaki buton durumuna dayanıyordu. Senkron işlem kilidi eklendi: art arda aynı onay tek sunucu isteği oluşturuyor; daha önce oluşturulmuş bir set-ekleme callback'i de bitirme sürerken yeni kayıt başlatamıyor. Sunucu hatasında kilit açılıyor ve yeniden denemeye izin veriliyor.
- Eklenen **7 regresyon testi** dahil tüm **145 mobil test geçti**. Tam TypeScript ve sıfır uyarıyla ESLint temiz. İlk dört test ve iki aktif-seans temizleme testi düzeltme öncesinde başarısız, sonrasında başarılı oldu; ayrıca sunucu bitirme hatasından sonra yeniden deneme sınandı.

Paketleme: Son mobil kaynak için iOS ve Android üretim JavaScript/Hermes dışa aktarımı başarıyla tamamlandı (iOS 1245, Android 1369 modül). İlk denemedeki Windows Hermes çalıştırma izni sorunu, izinli çalıştırmayla çözüldü. Paketleme çıktısı yalnızca yerel doğrulama içindir, dağıtılmadı; test API adresi `127.0.0.1` kullanıldı ve projenin telefon bağlantı ayarı değiştirilmedi. Bu işlem APK/IPA üretimi veya gerçek cihaz testi değildir.

Kalan: Telefonda lb düzenleme, boş/sıfır RIR, önceki seans ve hedef karşılaştırması, kesinti/yeniden açılma sonrası bekleyen setin çözülmesi, bitirme ve klavye/yerleşim kontrolü. Bu sonuçlar olmadan Adım 34 veya geliştirme turu tamamen bitti denmez.

### Adım 33: Yanıt kaybından sonra set oluşturmayı güvenli yeniden denemek — 24 Eylül 2026

- Mobil set ekleme akışı artık `PUT /workouts/{workout_id}/sets/requests/{request_id}` kullanıyor. UUID işlem kimliği, egzersiz adı ve gönderilecek değerler ağ isteğinden önce hesap/antrenman anahtarı altında SecureStore'a kaydediliyor. Yerel kayıt başarısızsa sunucuya izlenemeyen bir yazma isteği gönderilmiyor. `expo-crypto` eklendi; sürümü Expo 57'nin paket eşlemesine uygun, kilit dosyasında 57.0.3.
- Sunucu, antrenman sahipliğini kontrol edip mevcut antrenman kilidi altında işlem kaydını ve seti aynı transaction'da oluşturuyor. Aynı kimlik ve aynı içerik tekrar geldiğinde ikinci set oluşturulmuyor; farklı içerik 409 veriyor. Ondalık yazım farkları ve eksik/varsayılan alanlar normalize ediliyor. Farklı işlem kimlikleriyle bilinçli kaydedilen aynı değerlere sahip yeni setler ayrı kalıyor.
- İşlem kaydı sete bağlanmadığından set silinse de korunuyor. Tekrar yanıtta güncel antrenman dönüyor: sonraki düzenlemeler geri alınmıyor, silinmiş set diriltilmiyor. Antrenman silinirse işlem kayıtları da siliniyor ve eski antrenmana tekrar istek 404 alıyor. Eski `POST /sets` yolu uyumluluk için duruyor; yeni mobil akış başarısızlıkta o yola düşmüyor.
- Sonucu belirsiz kayıt için `Set awaiting confirmation` kartı ağırlık/tekrar/RIR/ısınma ayrımını gösteriyor. Kullanıcı `Retry pending set` ile özgün kimlik ve değerleri yeniden gönderiyor. Çözülene kadar yeni set, set düzenleme/silme ve bitirme engelleniyor. Uygulama yeniden açıldığında ilk seti henüz sunucuda olmayan serbest egzersiz de bekleyen kayıttan geri kuruluyor. Henüz gönderilmemiş diğer egzersiz taslakları mevcut ekran belleğinde korunuyor; başarılı tekrar yalnızca ilgili formu temizliyor.
- 422 doğrulama reddinde bekleyen işlem temizlenip düzeltmeye izin veriliyor. Ağ, oturum, 404/409 ve sunucu hataları belirsiz kaydı silmiyor. Sunucu başarı yanıtından sonra yerel temizleme hata verirse aynı işlem tekrar kullanılabiliyor. Aynı uygulamanın örtüşen ekranları depolama/ağ kilidini paylaşıyor; eski bir tekrar yeni bekleyen kaydı temizleyemiyor. Ekrandan ayrılmış bir işlemin yanıtı yeni ekran durumunu değiştirmiyor.
- Yeni set ağırlıkları, kg/lb dönüşümünden sonra API'nin iki ondalıklı kilogram hassasiyetine yuvarlanarak saklanıyor ve gönderiliyor. RIR boş/sıfır ayrımı korunuyor; hedef veya önceki set RIR'ı otomatik doldurulmuyor.

Doğrulama: 13 yeni mobil test dahil 138 mobil testi geçti; TypeScript ve sıfır uyarıyla tam ESLint temiz. PostgreSQL'de set/antrenman/önceki seans için 67 test geçti; son eklenen migration geri/ileri kontrolüyle yeni kayıt dosyasındaki 14 test ayrıca geçti (toplam 68 farklı backend vakası). Eşzamanlı aynı/farklı kimlikler, farklı içerik reddi, rollback, sahiplik, silme/düzeltme sonrası tekrar, cihaz yeniden açılışı, depolama hataları, eski ekran ve form temizliği kapsandı. Backend uygulamasının tamamında mypy (52 dosya), değişen dosyalarda Ruff kod ve biçim kontrolleri temiz. `a31d92f0c683` migration'ı yerel geliştirme veritabanına başarıyla uygulandı. Fiziksel telefonda görsel/ağ kesintisi kontrolü henüz yapılmadı; Adım 34'te ele alınacak.

Sınır: Bu tam çevrimdışı kuyruk değildir; antrenman başına tek çözülmemiş set tutulur ve yeni kayıt için önce onun sonucu çözülür. Uygulama verisinin silinmesi/yeniden kurulması cihazdaki işlem kimliğini kaybettirebilir. Eski istemcilerin kimliksiz POST istekleri yeni garantiden yararlanmaz. Migration geri alınırsa antrenmanlar/setler korunur ama tekrar önleme kayıtları silinir; bekleyen işlemler varken geri alma yapılmamalıdır. Cihazda depolama bozulması veya 409 uyuşmazlığı otomatik olarak yok sayılmaz; kayıt incelenmelidir.

### Adım 32: Önceki seansla aynı tekrar ve kayıtlı RIR grubunda ağırlık karşılaştırması — 24 Eylül 2026

- `Previous session` bölümüne mevcut seans ile önceki seansın kayıtlı ağırlık karşılaştırması eklendi. Aynı egzersiz, tam olarak aynı tekrar sayısı ve aynı gerçek RIR değerine sahip çalışma setleri gruplanıyor. Her ortak grupta iki seansın en yüksek kayıtlı ağırlığı, grubun set sayıları ve ağırlık farkı gösteriliyor. Sıralı set eşleştirmesi veya hedef RIR'dan gerçekleşen efor varsayımı yapılmıyor.
- Isınma/sıfır tekrarlı setler ve boş RIR değerleri eşleştirmeye girmiyor; gerçek `RIR 0` geçerli. Kayıtlı ağırlığı sıfır olan set korunuyor, vücut ağırlığı eklenmiyor. Ortak grup bulunmazsa bunun nedeni açıklanıyor. En yüksek ağırlık farklı sayıda setten seçilmiş olabileceği için iki grubun set sayıları görünür tutuluyor.
- Hesaplama veritabanının kilogram hassasiyetinde yapılıyor; gösterim kg/lb tercihini izliyor. Ağırlık farkı pozitif, negatif veya değişmedi olarak tarafsız gösteriliyor. Ekrandaki yuvarlama hassasiyetinden küçük gerçek farklar `+0` gibi yazılmıyor; `under 0.1` olarak belirtiliyor.
- Set ekleme, düzenleme, silme, ısınma veya RIR değişikliği sonucu sunucudan gelen güncel setler karşılaştırmayı yeniden hesaplatıyor. Bunun için önceki seans tekrar tekrar istenmiyor. Önceki kaydı yenilemek için bölümü kapatıp açma davranışı korunuyor.

Doğrulama: 9 yeni hesaplama testi ve 1 bileşen davranış testi dahil 125 mobil testi geçti. Testler grup maksimumları ve örnek sayıları, farklı tekrar/RIR'ın karışmaması, boş/sıfır RIR, ısınma/sıfır tekrar ayrımı, sıfır ağırlık, ondalık hassasiyet, kg/lb farkları, kararlı sıralama, girdilerin korunması ve canlı set düzeltme/silme akışını kapsıyor. Tam TypeScript ve sıfır uyarıyla tam ESLint temiz. Backend/API veya veritabanı değişmedi; backend testleri tekrar çalıştırılmadı. Fiziksel cihazda görsel kontrol henüz yapılmadı.

Sınır: Aynı tekrar ve öz bildirilen RIR, bütün antrenman koşullarının eşit olduğunu kanıtlamaz. Bu adım kayıtlı ağırlık farkını gösterir; kuvvet artışı, kişisel rekor, e1RM veya otomatik antrenman önerisi üretmez. Önceki seansın otomatik/legacy kapanma açıklamaları görünmeye devam eder.

### Adım 31: Egzersizin önceki seanstaki kayıtlarına antrenman içinden erişim — 24 Eylül 2026

- Her egzersiz bloğuna açılıp kapanabilen `Previous session` bölümü eklendi. Kullanıcı açtığında aynı hareketin önceki kapalı seansındaki çalışma setleri; seans adı, tarih/saat, ağırlık, tekrar ve gerçek RIR ile gösteriliyor. Kilogram/libre tercihi uygulanıyor; boş RIR `not recorded`, sıfır ise `RIR 0` olarak ayrılıyor. Önceki kayıtlar yeni set formuna kopyalanmıyor.
- Yeni `GET /workouts/{workout_id}/exercises/{exercise_id}/previous` sorgusu referans antrenmanın sahipliğini kontrol ediyor ve yalnızca o kullanıcının kayıtlarını arıyor. Başlangıç tarihi referans antrenmandan kesin olarak eski, kapanmış ve aynı egzersiz için pozitif tekrarlı en az bir çalışma seti bulunan en son seans seçiliyor. Geçmiş bir antrenman görüntülenirken daha yeni veya aynı başlangıç zamanlı seanslar kullanılmıyor; ilk 20 kayıt sınırı yok.
- Isınma ve sıfır tekrarlı satırlar sonuçtan çıkarılıyor; sıfır ağırlıklı çalışma setleri korunuyor. Otomatik kapanmış seanslar ve kapanma biçimi bilinmeyen eski kayıtlar açıklamalarıyla gösteriliyor. Geçmiş kaydı bulunmaması başarılı boş yanıt, bağlantı/sunucu sorunu yeniden denenebilir hata olarak ele alınıyor.
- Bölüm açılana kadar ek ağ isteği yok. Kapatıp açmak kaydı yeniden getiriyor; kapanmış bileşene veya eski isteğe ait geç yanıtlar yeni sonucu değiştiremiyor. Antrenman, başlangıç tarihi veya egzersiz değiştiğinde bölüm sıfırlanıyor. Kullanıcıya özel geçmiş cihazda kalıcı olarak saklanmıyor.

Doğrulama: 6 yeni test dahil 115 mobil testi geçti; son düzenlemeden sonra 6 yeni test tekrar geçti. TypeScript ve sıfır uyarıyla tam ESLint temiz. Gerçek PostgreSQL üzerinde 9 yeni geçmiş testi ve mevcut antrenman testleri birlikte çalıştırıldı: 54 test geçti. Sahiplik/kimlik doğrulama, tarih sırası, açık ve boş seanslar, set kapsamı, kapanma bilgisi, sayfalama sınırını aşan geçmiş ve kayıt düzeltme/silme durumları test edildi. Değişen backend dosyalarında Ruff kod/biçim kontrolleri ve backend uygulamasının tamamında mypy (52 kaynak dosyası) temiz. Veritabanı şeması veya migration değişmedi. Fiziksel cihazda görsel kontrol henüz yapılmadı.

Sınır: Bu, önceki gerçek kayda erişim adımıdır; e1RM, kişisel rekor, başarı puanı veya otomatik gelişim yorumu üretmez. Farklı tekrar, efor, hareket sırası ve seans koşulları eşdeğer kabul edilmez. Bütün egzersiz geçmişi grafiği ve eş koşullu ilerleme karşılaştırması ayrı çalışmalardır.

### Adım 30: Gerçekleşen tekrar ve RIR değerlerini başlangıç hedefleriyle karşılaştırma — 24 Eylül 2026

- Antrenman ekranında her egzersizin kayıtlı tekrarları ve RIR değerleri, seansın saklanan başlangıç planındaki hedeflerle karşılaştırılıyor. Canlı şablon sonradan değiştirilse veya silinse de karşılaştırmanın dayanağı başlangıç planı. Canlı ve bitmiş seanslarda aynı hesaplama kullanılıyor.
- Pozitif tekrarlı, ısınma olmayan bütün çalışma setleri, fazladan setler dahil, karşılaştırmaya giriyor; bu kapsam ekranda açıklanıyor. Hedef set sayısının karşılanması ayrı gösterilmeye devam ediyor. Tekrar aralığının alt ve üst sınırları dahil; yalnızca alt veya üst sınır varsa o sınır kullanılıyor.
- RIR için hedefin altında, hedefte, üstünde ve kaydedilmemiş set sayıları ayrı gösteriliyor. Gerçek veya hedef RIR `0` geçerli bir değer; boş kayıt sıfır sayılmıyor. RPE'den RIR türetilmiyor. Hedefi olmayan boyut için karşılaştırma üretilmiyor, henüz set yoksa tarafsız bir kayıt yok açıklaması gösteriliyor.
- Aynı egzersizin tekrarlanan hedef blokları aynı hedefleri içeriyorsa her gerçek set bir kez sayılıyor. Blokların tekrar veya RIR hedefleri farklıysa, setlerin hangi bloğa ait olduğu kayıtlı olmadığından ilgili boyut karşılaştırılmıyor ve neden açıklanıyor. Boyutlar bağımsız: tekrar hedefleri farklı ama RIR hedefleri aynıysa RIR karşılaştırılabiliyor.

Doğrulama: 12 yeni test dahil 109 mobil testi geçti. Testler sınır değerleri, tek taraflı aralıklar, fazladan setler, boş/sıfır RIR ayrımı, ısınma/sıfır tekrar ayrımı, vücut ağırlığı setleri, hedef bulunmaması, aynı/farklı hedef blokları ve kayıt düzeltmelerini kapsıyor. Tam TypeScript ve sıfır uyarıyla tam ESLint temiz. Backend ve veritabanı değişmedi; backend testleri tekrar çalıştırılmadı. Fiziksel cihazda görsel kontrol henüz yapılmadı.

Sınır: Bu adım hedef ile kayıt arasındaki farkı gösterir; başarı puanı, daha yüksek değerin daha iyi olduğu yorumu veya otomatik antrenman önerisi üretmez. Farklı hedef bloklarını gerçek setlerle eşleştirmek ve seanslar arası ilerlemeyi değerlendirmek ayrı çalışmalardır.

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
