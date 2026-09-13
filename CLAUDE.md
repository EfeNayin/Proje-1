# CLAUDE.md — BodyTrack

Bu dosya Claude Code'un projeyi tanıması içindir. Öğrenmeye öncelik veren,
dürüst bir mentor gibi davran: aşırı övme, gerçek riskleri söyle, scope
creep'e karşı uyar. Kullanıcı bilgisayar mühendisliği 3. sınıf öğrencisi,
bodybuilding ile ilgileniyor (founder-market fit), bu bir bitirme projesi +
startup. Türkçe konuş, kod İngilizce yaz.

## NE YAPIYORUZ
Bodybuilder'lar için hipertrofi-odaklı mobil antrenman platformu. Türkiye-first,
sonra Avrupa. Ana farklılaşma: kas grubu bazlı haftalık hacim analitiği
(MEV/MAV/MRV) — Hevy'de yok. Rakipler: Hevy (logger, analitik yok), FitBod
(kişiselleşmiyor), GymVid (henüz yok).

## MİMARİ KARARLAR (gerekçeleriyle — bunları koru)
- Backend: FastAPI (async) + PostgreSQL + Redis, hepsi Docker Compose'da.
- Mobil: React Native + Expo (expo-router), TypeScript strict.
- UUID dışa açılan entity'ler için (users, workouts, exercises), BIGSERIAL
  yoğun/iç tablolar için (sets, refresh_tokens).
- Denormalize agregatlar (workouts.total_volume_kg, total_sets) — her
  mutasyondan sonra SIFIRDAN yeniden hesaplanır, artımlı değil (kaçırılan bir
  artım sonsuza kadar yanlış kalır, tam sayım kendi kendini onarır).
- Gizlilik default PRIVATE. Sosyal opsiyonel.
- citext + C.UTF-8 collation — email/username case-insensitive, Türkçe harf
  katlaması doğru. musl/alpine C.UTF-8'i desteklemez, bu yüzden Debian tabanlı
  postgres:16 imajı; alpine DEĞİL.
- unaccent + pg_trgm GIN — arama aksan-duyarsız ("gogus" → "Göğüs") ve
  substring ("%bench%"). btree bunu karşılayamaz. Sorgudaki ifade indeksteki
  lower(immutable_unaccent(...)) ile BİREBİR aynı olmalı yoksa seq scan'e düşer.
- Token rotasyonu: refresh token kullanılınca iptal edilir; kullanılmış token
  tekrar gelirse çalıntı sayılır ve TÜM oturumlar kapatılır. Bu yüzden mobilde
  refresh single-flight — eşzamanlı 401'ler tek refresh'i paylaşır.
- Timezone: performed_at UTC'de saklanır ama haftalık hacim sınırı
  KULLANICININ saat diliminde kesilir (AT TIME ZONE users.timezone). İstanbul'da
  Pzt 01:00 antrenmanı UTC'de Paz 22:00; UTC ile hesaplanırsa önceki haftaya
  düşer. users.timezone kayıtta cihazdan alınır, sonradan türetilemez.

## VERİTABANI ŞEMASI — Alembic tek gerçek kaynak
2026-09-07'de yaşanan olay: schema_v1.sql'e `finished_at` kolonu eklendi ama
Postgres init script'i (docker-entrypoint-initdb.d) sadece BOŞ volume'de
çalışıyor — dolu volume onu sessizce atladı, kolon veritabanına hiç girmedi.
Uygulama "column workouts.finished_at does not exist" ile 500 verdi, programlar
kaybolmuş gibi göründü, kullanıcı elle ALTER TABLE çalıştırmak zorunda kaldı.
"Şema dosyasına ekledim, tamam" YETERLİ DEĞİL — Postgres'e gerçekten uygulanmış
olması gerekir. Bunun için artık Alembic var, bu yüzden bir daha olmamalı.

Tek gerçek kaynak artık **backend/alembic/versions/** — schema_v1.sql
DONDURULDU (bkz. dosyanın başındaki uyarı), bir daha ELLE DÜZENLENMEYECEK.
Baseline migration (e272543ef2bb) onu path üzerinden okuyup çalıştırıyor;
dosyayı değiştirmek o migration'ı bozar.

Şema nasıl kurulur (ikisi de otomatik):
- **Sıfırdan** (`docker compose down -v && docker compose up --build`): db boş
  başlar, backend container'ı ayağa kalkarken `alembic upgrade head` çalışır
  (bkz. backend/Dockerfile CMD) — baseline migration şemayı + seed'i sıfırdan
  kurar.
- **Mevcut/dolu veritabanı**: aynı `alembic upgrade head`, zaten uygulanmış
  migration'ları atlar (no-op). docker init script'i artık YOK, dolayısıyla
  bu tek yol.

Şemayı DEĞİŞTİRMEK istediğinde:
1. İlgili SQLAlchemy modelini güncelle (backend/app/models/).
2. `docker compose exec backend alembic revision --autogenerate -m "kısa açıklama"`
   ile taslak migration üret.
3. Taslağı MUTLAKA elle gözden geçir — autogenerate CREATE EXTENSION,
   fonksiyon/trigger, ifade indeksi (GIN + immutable_unaccent gibi) ve seed
   veri YAKALAMAZ; bunlar gerekiyorsa migration'a elle eklenmeli.
4. `docker compose exec backend alembic upgrade head` ile kendi ortamına uygula.
5. `docker compose exec backend alembic check` ile model-DB farkının SIFIR
   olduğunu doğrula.
6. `docker compose exec backend pytest` — tests/conftest.py test veritabanını
   artık schema_v1.sql'den değil, aynı migration zincirinden kuruyor; bu da
   migration'ların gerçekten uygulandığını her test koşusunda doğruluyor.

## HİPERTROFİ MODELİ (önemli — yüzde DEĞİL)
exercise_muscle_groups tablosu iki BAĞIMSIZ boyut tutar:
- role ('primary'/'secondary'): haftalık set sayımı yalnızca primary'yi sayar.
  Sebep: RP'nin MEV/MAV/MRV eşikleri DOĞRUDAN çalışma için kalibre;
  presleme/çekişten gelen dolaylı hacim zaten bu sayılara dahil edilip
  düşürülmüş. Dolaylıyı ayrıca saymak çift sayım olur.
- effectiveness (1-5): bu hareketin BU kas için ne kadar iyi olduğu. ÖLÇÜM
  DEĞİL, DEĞERLENDİRME. Eskiden contribution_pct (yüzde) vardı, kaldırıldı —
  yüzde, elimizde olmayan EMG verisi varmış gibi sahte kesinlik ima ediyordu.
  5=en iyi seçeneklerden, 3=işe yarar ama optimal değil, 1=marjinal.

## DURUM (GÜNCEL — GERÇEK DOSYALARA GÜVEN, VARSAYMA)
Backend ve mobil çalışıyor, sürekli genişliyor. Bu bölüm bir anlık görüntüdür
ve eskiyebilir — **en güncel, tarihli durum ve test sayıları için
`PROJE_1_CODEX_INCELEME.md` içindeki "Uygulama günlüğü" (Adım N) girdilerine
bakın**; en son girdi (bu satırın yazıldığı tarihte Adım 13, 13 Eylül 2026)
309 backend ve 63 mobil testinin geçtiğini raporluyor. Buraya sabit bir test
sayısı yazmıyoruz çünkü hızla eskiyor ve yanlış güven verir.

Backend (backend/app/, ruff+mypy strict temiz olmalı — bkz. `app/domains/`
ve `app/models/` gerçek listesi için):
- core/: config, database (async), security (JWT+bcrypt, jti claim'li), exceptions
- models/: 13 tablo — users, refresh_tokens, muscle_groups, exercises,
  exercise_muscle_groups, workouts, sets, programs, workout_templates,
  template_exercises, template_save_requests, readiness_logs,
  body_measurements
- domains/ (9 domain): auth (register/login/refresh), users (GET/PATCH /me),
  exercises (katalog arama+filtre), workouts (workout+set CRUD, başlangıç
  plan anlık görüntüsü), programs (program/şablon CRUD, idempotent şablon
  kaydetme), readiness (günlük toparlanma kaydı), body (kilo ölçümü),
  nutrition (beslenme hedefi hesaplama), analytics (haftalık hacim +
  dönemsel değerlendirme/"teşhis")

Mobil (mobile/, Expo SDK 57, TypeScript strict sıfır hata):
- src/api/: client (single-flight refresh), tokens (SecureStore), auth,
  exercises, workouts, programs, readiness, body, nutrition, analytics
- src/auth/AuthContext: kalıcı oturum, bağlantı hatasında oturumu koruma
- src/workout/: activeWorkout (yarım kalan seans cihazda), restPreference
- app/(auth)/: login, register
- app/(app)/(tabs)/: index (training home + geçmiş sayfalama), programs,
  volume, profile
- app/(app)/workout/: [id] (canlı loglama, başlangıç planı, şablona
  kaydetme), checkin, exercise-picker
- app/(app)/program/: [id], template/[id]
- app/(app)/diagnosis: dönemsel değerlendirme ("Neden gelişemiyorum?")
- app/(app)/profile/*: kişisel bilgiler, tercihler, kilo geçmişi, beslenme
  hedefleri

Çalışan akış: kayıt → canlı antrenman loglama (set set, dinlenme sayacı,
başlık düzenleme, set düzeltme/silme, şablondan başlatma) → program/şablon
yönetimi → haftalık hacim ekranı (renkli MEV/MAV/MRV) → dönemsel
değerlendirme → profil/beslenme hedefleri. Telefonda görsel/uçtan uca
doğrulama yalnızca ilk adımlarda (Adım 1-2) kullanıcı tarafından yapıldı;
sonraki adımların çoğu yalnızca statik/otomatik testlerle doğrulandı —
"kodda mevcut" ile "telefonda denendi" birbirine karıştırılmamalı (bkz.
PROJE_1_CODEX_INCELEME.md doğrulama sınırı notu).

## TEST & KALİTE (her değişiklikten sonra)
- Backend: docker compose exec backend pytest, ruff, mypy strict — geçen
  test sayısı için PROJE_1_CODEX_INCELEME.md'deki en güncel Adım'a bakın
- Mobil: npx tsc --noEmit (sıfır hata olmalı), npm run lint (sıfır hata/uyarı
  olmalı), npm run test:* (bkz. mobile/README.md — her komutu ayrı ayrı veya
  `node --test tests/*.test.cjs` ile hepsini birden çalıştırın)
- Testler gerçek PostgreSQL'e karşı çalışır (mock/SQLite değil), çünkü şema
  CITEXT/trigger/AT TIME ZONE kullanıyor. Ownership ve timezone bugları
  sessizdir — bunları test eden mevcut testleri BOZMA.

## SEED BACKLOG (schema_v1.sql sonunda, İLERİDE, ŞİMDİ DEĞİL)
- sets.set_type → dropset/rest_pause. Dropset kaç set sayılır KULLANICI TERCİHİ.
- personal_records + estimated_1rm → Faz 2. 1RM türetilen değer (Epley).
- workout_templates.is_amrap → Faz 3. AMRAP programlama talimatı, loglama değil.
- exercises.instructions_tr/en → şu an boş, info ekranı için doldurulacak.
- exercises.thumbnail_url/demo_video_url → görsel için (telif dikkat: Hevy'nin
  görselleri lisanslı; kendi çekimimiz veya CC-lisanslı kaynak gerekir).
- Bitmiş antrenmana yazma engeli backend'de YOK; salt-okunurluk yalnızca
  istemcide. Kasıtlı, çünkü Düzenle akışı aynı endpoint'leri kullanıyor.
  İleride ayrı bir reopen/unfinish adımı ile sunucu tarafında da korunabilir.
- Profil "Premium" rozeti/taç → abonelik sistemi (ödeme, App Store IAP,
  entitlement kontrolü) kurulmadan EKLENMEYECEK. Referans tasarımda var ama
  sabit "Premium" yazmak kullanıcıya yalan söylemek olur.
- Profil "Change Photo" / fotoğraf yükleme → dosya depolama altyapısı (S3/
  MinIO) yok. Tek avatar için o altyapıyı kurmak orantısız; şimdilik baş
  harfler kullanılıyor (bkz. profile.tsx, initials()). Altyapı kurulunca
  gelecek.
- weight_unit SADECE bir gösterim etiketi (bkz. profile/preferences.tsx) —
  lb seçilince kg değerleri DÖNÜŞTÜRÜLMÜYOR. Gerçek lb desteği için gösterim
  katmanında (ve muhtemelen girişte) dönüşüm gerekir.
- Preferences ekranı referansında (foto 3) olup karşılığı olmadığı için
  EKLENMEYENLER:
  - Tema (System/Light/Dark): uygulama şu an sadece koyu tema, theme.ts'te
    renkler sabit, ~15 ekranın StyleSheet'i çalışma zamanında tema
    değiştiremiyor. Aydınlık tema ayrı ve büyük bir refactor.
  - Badge celebrations: rozet sistemi yok.
  - Live activity: iOS kilit ekranı widget'ı, native modül + kalori verisi
    gerektiriyor.
  - Add burned calories / Rollover calories: kalori TAKİBİ (ne yenildiği,
    ne yakıldığı) olmadan anlamsız — o sistem yok.
  - NOT: "Auto adjust macros" bunlardan farklı, zaten VAR
    (profile/nutrition-goals.tsx, `autoAdjust` state'i) — ama tüketilen
    yemeğe veya kilo trendine göre değil, yalnızca ekrandaki makro
    alanlarıyla kalori hedefi arasındaki aritmetiği canlı senkronlar. Otomatik
    beslenme koçu değildir.
  - Marketing emails: e-posta altyapısı hiç yok (kayıt doğrulama, şifre
    sıfırlama dahil).
- Beslenme TAKİBİ yok — sadece HEDEF belirleme var (bkz.
  app/domains/nutrition/, profile/nutrition-goals.tsx). "Bugün ne yedin"
  kaydı, yemek veritabanı, barkod tarama — hiçbiri yok. Kullanıcı bunu
  açıkça istedi ("beslenme takibi olmayacak şimdilik").
- Mikro besinler (referanstaki "View micronutrients") → yok, takip
  olmadan mikro besin hedefi anlamsız.
- Halka renkleri / ana sayfa besin halkaları (foto 10) → kalori TAKİBİ
  olmadan (bugün ne yenildi bilinmeden) gösterilecek bir ilerleme yok.
  Takip eklenmeden yapılamaz.

## FAZ PLANI
- Faz 1 (TAMAM): loglama + hacim analitiği MVP
- Faz 2: sosyal (follows, likes, feed, leaderboard, PR), vücut ölçüleri
- Faz 3: mezocycle, program önerisi (kural-tabanlı), video form check
- Faz 4: RL program önerisi · Faz 5: HAR sensör (asıl akademik değer, tez)

## ÇALIŞMA KURALLARI
- Ayrı git branch'inde çalış, git diff ile gözden geçirilsin.
- Her commit tek başına derlenebilir olmalı (dosya başına değil, çalışan
  değişiklik başına commit). Conventional Commits (feat/fix/test/...).
- Mevcut kalıpları takip et: yeni ekran exercise-picker/volume kalıbında,
  yeni endpoint mevcut domain yapısında.
- Bir şeyi varsaymadan önce gerçek dosyayı oku. Bu dosyanın durum bölümü bile
  eskimiş olabilir — dosya sistemine güven.
- Takılırsan (aynı hatayı tekrar düzeltmeye çalışıyorsan) DUR; bu genelde
  yaklaşımın yanlış olduğunun işareti, kullanıcıya danış.
- Doğrulama veya deneme amacıyla çalışma dizinini ezen komutlar ASLA
  kullanılmayacak: git checkout <sha> -- ., git checkout -- ., git reset
  --hard, git clean -fd. Bunlar commit'lenmemiş değişiklikleri uyarısız
  siler ve geri getirilemez. Bir commit'i incelemek gerekiyorsa git show
  <sha>:<dosya> veya git stash kullan. Çalışma dizininde commit'lenmemiş
  değişiklik varken HEAD taşıma.
