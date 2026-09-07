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
Backend TAMAM ve test edilmiş. Mobil Faz 1 TAMAM.

Backend (backend/app/, 125 pytest testi geçiyor, ruff+mypy strict temiz):
- core/: config, database (async), security (JWT+bcrypt, jti claim'li), exceptions
- models/: User, RefreshToken, MuscleGroup, Exercise, ExerciseMuscleGroup,
  Workout, Set (7 tablo, schema_v1.sql ile birebir)
- domains/auth: register, login, refresh (rotasyon)
- domains/users: GET/PATCH /users/me
- domains/exercises: GET /exercises (arama+filtre), /exercises/{id}, /muscle-groups
- domains/workouts: workout + set CRUD, sahiplik kontrolü (404, 403 değil)
- domains/analytics: GET /analytics/weekly-volume (MEV/MAV/MRV, timezone-aware)

Mobil (mobile/, Expo SDK 57, TypeScript strict sıfır hata):
- src/api/: client (single-flight refresh), tokens (SecureStore), auth,
  exercises, workouts, analytics
- src/auth/AuthContext: kalıcı oturum
- src/workout/: activeWorkout (yarım kalan seans cihazda), restPreference
- app/(auth)/: login, register
- app/(app)/(tabs)/: index (training home), volume, profile
- app/(app)/workout/: [id] (canlı loglama), exercise-picker

Çalışan akış: kayıt → canlı antrenman loglama (set set, dinlenme sayacı, başlık
düzenleme, set düzeltme/silme) → haftalık hacim ekranı (renkli MEV/MAV/MRV) →
profil. Uçtan uca telefonda çalışıyor.

## TEST & KALİTE (her değişiklikten sonra)
- Backend: docker compose exec backend pytest (125 test), ruff, mypy strict
- Mobil: npx tsc --noEmit (sıfır hata olmalı)
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
