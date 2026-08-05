-- ============================================================================
--  BodyTrack — schema_v1.sql  ·  KATMAN 1 (Çekirdek) — FİNAL
-- ============================================================================
--  Bu dosya Faz 1 MVP'sinin veri temelidir: manuel antrenman loglama +
--  kas grubu hacim analizi (MEV/MAV/MRV). Katman 2-5 (sosyal, mezocycle,
--  vücut ölçüleri, video) ihtiyaç geldikçe Alembic migration'larıyla eklenecek.
--
--  Tasarım kararları:
--   • UUID  → dışa açılan entity'ler (users, exercises, workouts).
--             Tahmin edilemez; URL/API'de güvenle paylaşılır; sharding-dostu.
--   • BIGSERIAL → çok satırlı, dışa açılmayan tablolar (sets, refresh_tokens).
--             Daha küçük indeks, daha hızlı insert.
--   • Denormalize agregatlar (workouts.total_volume_kg) → her hacim sorgusunda
--             tüm set'leri toplamamak için. Yazarken bir kez hesapla, oku ucuz olsun.
--   • exercise_muscle_groups → hipertrofi analitiğinin KALBİ. Bir egzersizin
--             hangi kasa yüzde kaç katkı yaptığını tutar (contribution_pct).
--   • muscle_groups → MEV/MAV/MRV sabitleri (Renaissance Periodization referansı).
--   • Gizlilik default PRIVATE (is_private = true). Sosyal opsiyonel.
--   • Seed dahil: 17 kas grubu + 20 egzersiz + tüm kas eşleştirmeleri.
--             Boş katalogla uygulama çalışmaz; bu dosya yüklenince katalog hazır.
-- ============================================================================

-- citext: büyük/küçük harf duyarsız metin. "Efe@x.com" ile "efe@x.com" aynı
-- sayılsın diye email/username için kullanıyoruz (manuel LOWER() derdi olmaz).
CREATE EXTENSION IF NOT EXISTS citext;

-- gen_random_uuid() PostgreSQL 13+ içinde built-in; eski sürümlere karşı garanti.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- updated_at alanını her UPDATE'te otomatik güncelleyen ortak fonksiyon.
-- Her tabloda elle "updated_at = now()" yazmak yerine trigger ile merkezi tutuyoruz.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ─────────────────────────────────────────────────────────────────────────
--  users  ·  Kullanıcı hesabı (dışa açık → UUID)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email         CITEXT       NOT NULL UNIQUE,
    username      CITEXT       NOT NULL UNIQUE,        -- leaderboard/sosyal için benzersiz
    password_hash TEXT         NOT NULL,               -- bcrypt hash; ham şifre ASLA tutulmaz
    display_name  TEXT,                                -- ekranda görünen ad (opsiyonel)
    bio           TEXT,
    is_private    BOOLEAN      NOT NULL DEFAULT TRUE,  -- gizlilik default PRIVATE
    weight_unit   TEXT         NOT NULL DEFAULT 'kg'
                  CHECK (weight_unit IN ('kg', 'lb')), -- ileride lb desteği için hazır
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────
--  refresh_tokens  ·  JWT yenileme jetonları (iç kullanım → BIGSERIAL)
-- ─────────────────────────────────────────────────────────────────────────
--  Access token kısa ömürlü ve stateless (DB'ye bakılmaz). Refresh token ise
--  burada saklanır ki "çıkış yap" / "tüm cihazlardan çık" yapılabilsin.
--  Jetonun KENDİSİ değil HASH'i tutulur — DB sızsa bile jetonlar kullanılamaz.
CREATE TABLE refresh_tokens (
    id         BIGSERIAL    PRIMARY KEY,
    user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT         NOT NULL UNIQUE,           -- ham token'ın SHA-256 hash'i
    expires_at TIMESTAMPTZ  NOT NULL,
    revoked_at TIMESTAMPTZ,                            -- NULL = hâlâ geçerli
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Bir kullanıcının aktif jetonlarını bulmak sık yapılan sorgu.
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);


-- ─────────────────────────────────────────────────────────────────────────
--  muscle_groups  ·  Kas grubu kataloğu + bilimsel hacim sabitleri
-- ─────────────────────────────────────────────────────────────────────────
--  Küçük, sabit bir küme (17 satır) → SMALLSERIAL yeterli.
--  MEV/MAV/MRV = haftalık SET sayısı eşikleri (Renaissance Periodization):
--    MEV (Minimum Effective Volume)  → büyüme için gereken alt sınır
--    MAV (Maximum Adaptive Volume)   → en verimli aralık
--    MRV (Maximum Recoverable Volume)→ üstünde toparlanamama/aşırı yük
--  Analitik bu eşiklere bakıp "eksik / yeterli / fazla" der.
--  region → UI'da kasları gruplu göstermek için ('upper' / 'lower' / 'core').
CREATE TABLE muscle_groups (
    id         SMALLSERIAL  PRIMARY KEY,
    name       TEXT         NOT NULL UNIQUE,    -- 'chest' (kod/sabit referans)
    name_tr    TEXT         NOT NULL,           -- 'Göğüs' (Türkçe arayüz — TR-first)
    region     TEXT         NOT NULL DEFAULT 'upper'
               CHECK (region IN ('upper', 'lower', 'core')),
    mev        SMALLINT,                        -- haftalık min set (NULL = veri yok)
    mav        SMALLINT,
    mrv        SMALLINT,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);


-- ─────────────────────────────────────────────────────────────────────────
--  exercises  ·  Egzersiz kataloğu (dışa açık → UUID)
-- ─────────────────────────────────────────────────────────────────────────
--  created_by NULL → sistem egzersizi (resmi katalog).
--  created_by dolu → kullanıcının eklediği özel egzersiz (ileride).
CREATE TABLE exercises (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT         NOT NULL,
    name_tr     TEXT,
    equipment   TEXT,                            -- 'barbell','dumbbell','machine','cable','bodyweight'
    is_compound BOOLEAN      NOT NULL DEFAULT FALSE,  -- çok eklemli mi (bench) tek eklemli mi (curl)
    created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Egzersiz arama (GET /exercises?q=bench) için isim indeksi.
CREATE INDEX idx_exercises_name ON exercises(lower(name));
-- Türkçe isimle arama da yapılacak (TR-first ürün).
CREATE INDEX idx_exercises_name_tr ON exercises(lower(name_tr));


-- ─────────────────────────────────────────────────────────────────────────
--  exercise_muscle_groups  ·  Egzersiz → kas katkısı (ANALİTİĞİN KALBİ)
-- ─────────────────────────────────────────────────────────────────────────
--  Bir egzersizin yapılan her set'i, kaslara YÜZDE ile dağıtılır.
--  Örn. Bench Press: göğüs %65 (primary), triceps %20, ön omuz %15 (secondary).
--  "Haftalık göğüs seti" = ilgili set'lerin contribution_pct toplamı.
--  Bu sayede 1 set bench, göğüse 0.65 set, omuza 0.15 set olarak sayılabilir.
--  Bir egzersizin tüm satırlarının contribution_pct toplamı ≈ 100 olmalı
--  (uygulama katmanında doğrulanır; DB'de zorlamak triggersız mümkün değil).
CREATE TABLE exercise_muscle_groups (
    exercise_id      UUID      NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    muscle_group_id  SMALLINT  NOT NULL REFERENCES muscle_groups(id) ON DELETE RESTRICT,
    role             TEXT      NOT NULL DEFAULT 'primary'
                     CHECK (role IN ('primary', 'secondary')),
    contribution_pct SMALLINT  NOT NULL
                     CHECK (contribution_pct BETWEEN 1 AND 100),  -- bu kasa katkı yüzdesi
    PRIMARY KEY (exercise_id, muscle_group_id)   -- bir egzersiz-kas çifti tekil
);

-- "Bu kası çalıştıran egzersizler" yönünde de sorgu yapacağız.
CREATE INDEX idx_emg_muscle_group ON exercise_muscle_groups(muscle_group_id);


-- ─────────────────────────────────────────────────────────────────────────
--  workouts  ·  Bir antrenman seansı (dışa açık → UUID)
-- ─────────────────────────────────────────────────────────────────────────
--  total_volume_kg / total_sets DENORMALIZE: set ekl/çıkar oldukça uygulama
--  katmanında güncellenir. Feed/profil/leaderboard'da set'leri toplamadan okunur.
CREATE TABLE workouts (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           TEXT,
    notes           TEXT,
    performed_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),  -- antrenmanın yapıldığı an
    total_volume_kg NUMERIC(10,2) NOT NULL DEFAULT 0,     -- Σ(weight_kg × reps) — denormalize
    total_sets      INTEGER      NOT NULL DEFAULT 0,      -- ısınma hariç set sayısı — denormalize
    is_private      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- "Kullanıcının antrenmanları, en yeniden eskiye" en sık sorgu.
CREATE INDEX idx_workouts_user_performed ON workouts(user_id, performed_at DESC);

CREATE TRIGGER workouts_set_updated_at
    BEFORE UPDATE ON workouts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────
--  sets  ·  Tek bir set (en yoğun tablo → BIGSERIAL)
-- ─────────────────────────────────────────────────────────────────────────
--  Kullanıcı başına on binlerce satır olabilir → BIGSERIAL (küçük indeks, hızlı insert).
--  RIR (Reps In Reserve) ve RPE iki farklı yorgunluk ölçeği; ikisi de opsiyonel.
CREATE TABLE sets (
    id          BIGSERIAL    PRIMARY KEY,
    workout_id  UUID         NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    exercise_id UUID         NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
    set_number  SMALLINT     NOT NULL,                   -- egzersiz içindeki sıra (1,2,3...)
    weight_kg   NUMERIC(6,2) NOT NULL CHECK (weight_kg >= 0),
    reps        SMALLINT     NOT NULL CHECK (reps >= 0),
    rir         SMALLINT     CHECK (rir BETWEEN 0 AND 10),    -- yedekte kalan tekrar
    rpe         NUMERIC(3,1) CHECK (rpe BETWEEN 1 AND 10),    -- algılanan zorluk
    is_warmup   BOOLEAN      NOT NULL DEFAULT FALSE,          -- ısınma seti hacme sayılmaz
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Bir antrenmanın tüm set'lerini çekmek (workout detayı) sık sorgu.
CREATE INDEX idx_sets_workout ON sets(workout_id);
-- Hacim analitiği: belirli egzersiz/kas üzerinden zaman serisi sorguları.
CREATE INDEX idx_sets_exercise ON sets(exercise_id);


-- ============================================================================
--  SEED: muscle_groups — 17 kas grubu, MEV/MAV/MRV değerleriyle
--  Değerler Renaissance Periodization'ın yayınladığı aralıkların orta noktaları;
--  bireysel farklılık büyüktür, bunlar başlangıç referansıdır.
-- ============================================================================

INSERT INTO muscle_groups (name, name_tr, region, mev, mav, mrv) VALUES
('chest',       'Göğüs',          'upper',  8, 14, 22),
('upper_back',  'Üst Sırt',       'upper', 10, 16, 25),
('lats',        'Sırt Kanatları', 'upper', 10, 16, 26),
('lower_back',  'Alt Sırt',       'core',   6, 12, 18),
('front_delts', 'Ön Omuz',        'upper',  6, 12, 20),
('side_delts',  'Yan Omuz',       'upper',  8, 16, 26),
('rear_delts',  'Arka Omuz',      'upper',  8, 14, 22),
('biceps',      'Pazı',           'upper',  8, 14, 20),
('triceps',     'Arka Kol',       'upper',  6, 14, 22),
('forearms',    'Ön Kol',         'upper',  4, 10, 16),
('traps',       'Trapez',         'upper',  4, 12, 20),
('quads',       'Ön Bacak',       'lower',  8, 14, 22),
('hamstrings',  'Arka Bacak',     'lower',  6, 12, 20),
('glutes',      'Kalça',          'lower',  4, 10, 16),
('calves',      'Baldır',         'lower',  8, 14, 22),
('abs',         'Karın',          'core',   6, 14, 25),
('obliques',    'Yan Karın',      'core',   4, 10, 16);


-- ============================================================================
--  SEED: exercises — 20 temel egzersiz (sistem kataloğu, created_by = NULL)
-- ============================================================================

INSERT INTO exercises (name, name_tr, equipment, is_compound) VALUES
('Barbell Back Squat',     'Barbell Back Squat',    'barbell',    TRUE),
('Barbell Front Squat',    'Barbell Front Squat',   'barbell',    TRUE),
('Conventional Deadlift',  'Klasik Deadlift',       'barbell',    TRUE),
('Romanian Deadlift',      'Romanian Deadlift',     'barbell',    TRUE),
('Barbell Bench Press',    'Barbell Bench Press',   'barbell',    TRUE),
('Incline Barbell Bench',  'Eğimli Bench Press',    'barbell',    TRUE),
('Dumbbell Bench Press',   'Dumbbell Bench Press',  'dumbbell',   TRUE),
('Overhead Press',         'Overhead Press',        'barbell',    TRUE),
('Barbell Row',            'Barbell Row',           'barbell',    TRUE),
('Pull-up',                'Barfiks',               'bodyweight', TRUE),
('Lat Pulldown',           'Lat Pulldown',          'cable',      TRUE),
('Dumbbell Row',           'Tek Kol Dumbbell Row',  'dumbbell',   TRUE),
('Leg Press',              'Leg Press',             'machine',    TRUE),
('Leg Curl',               'Leg Curl',              'machine',    FALSE),
('Leg Extension',          'Leg Extension',         'machine',    FALSE),
('Lateral Raise',          'Lateral Raise',         'dumbbell',   FALSE),
('Dumbbell Curl',          'Dumbbell Curl',         'dumbbell',   FALSE),
('Tricep Pushdown',        'Tricep Pushdown',       'cable',      FALSE),
('Calf Raise',             'Calf Raise',            'machine',    FALSE),
('Cable Fly',              'Cable Fly',             'cable',      FALSE);


-- ============================================================================
--  SEED: exercise_muscle_groups — 20 egzersizin TAMAMI için kas eşleştirmesi
--  Her egzersizin contribution_pct toplamı = 100.
--  Yüzdeler EMG çalışmaları + antrenman literatürüne dayalı yaklaşık değerler;
--  ileride veriye göre kalibre edilebilir.
-- ============================================================================

-- Barbell Back Squat: quads 55 + glutes 30 + hamstrings 15
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 55 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Back Squat' AND m.name = 'quads';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 30 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Back Squat' AND m.name = 'glutes';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 15 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Back Squat' AND m.name = 'hamstrings';

-- Barbell Front Squat: quads 65 + glutes 20 + abs 15 (dik gövde → core yükü)
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 65 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Front Squat' AND m.name = 'quads';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 20 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Front Squat' AND m.name = 'glutes';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 15 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Front Squat' AND m.name = 'abs';

-- Conventional Deadlift: hamstrings 40 + glutes 30 + lower_back 20 + lats 10
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 40 FROM exercises e, muscle_groups m
WHERE e.name = 'Conventional Deadlift' AND m.name = 'hamstrings';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 30 FROM exercises e, muscle_groups m
WHERE e.name = 'Conventional Deadlift' AND m.name = 'glutes';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 20 FROM exercises e, muscle_groups m
WHERE e.name = 'Conventional Deadlift' AND m.name = 'lower_back';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 10 FROM exercises e, muscle_groups m
WHERE e.name = 'Conventional Deadlift' AND m.name = 'lats';

-- Romanian Deadlift: hamstrings 55 + glutes 30 + lower_back 15
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 55 FROM exercises e, muscle_groups m
WHERE e.name = 'Romanian Deadlift' AND m.name = 'hamstrings';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 30 FROM exercises e, muscle_groups m
WHERE e.name = 'Romanian Deadlift' AND m.name = 'glutes';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 15 FROM exercises e, muscle_groups m
WHERE e.name = 'Romanian Deadlift' AND m.name = 'lower_back';

-- Barbell Bench Press: chest 65 + triceps 20 + front_delts 15
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 65 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Bench Press' AND m.name = 'chest';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 20 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Bench Press' AND m.name = 'triceps';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 15 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Bench Press' AND m.name = 'front_delts';

-- Incline Barbell Bench: chest 55 + front_delts 25 + triceps 20
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 55 FROM exercises e, muscle_groups m
WHERE e.name = 'Incline Barbell Bench' AND m.name = 'chest';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 25 FROM exercises e, muscle_groups m
WHERE e.name = 'Incline Barbell Bench' AND m.name = 'front_delts';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 20 FROM exercises e, muscle_groups m
WHERE e.name = 'Incline Barbell Bench' AND m.name = 'triceps';

-- Dumbbell Bench Press: chest 65 + triceps 20 + front_delts 15
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 65 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Bench Press' AND m.name = 'chest';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 20 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Bench Press' AND m.name = 'triceps';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 15 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Bench Press' AND m.name = 'front_delts';

-- Overhead Press: front_delts 55 + triceps 25 + side_delts 20
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 55 FROM exercises e, muscle_groups m
WHERE e.name = 'Overhead Press' AND m.name = 'front_delts';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 25 FROM exercises e, muscle_groups m
WHERE e.name = 'Overhead Press' AND m.name = 'triceps';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 20 FROM exercises e, muscle_groups m
WHERE e.name = 'Overhead Press' AND m.name = 'side_delts';

-- Barbell Row: upper_back 40 + lats 35 + biceps 15 + rear_delts 10
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 40 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Row' AND m.name = 'upper_back';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 35 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Row' AND m.name = 'lats';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 15 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Row' AND m.name = 'biceps';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 10 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Row' AND m.name = 'rear_delts';

-- Pull-up: lats 60 + biceps 20 + upper_back 20
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 60 FROM exercises e, muscle_groups m
WHERE e.name = 'Pull-up' AND m.name = 'lats';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 20 FROM exercises e, muscle_groups m
WHERE e.name = 'Pull-up' AND m.name = 'biceps';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 20 FROM exercises e, muscle_groups m
WHERE e.name = 'Pull-up' AND m.name = 'upper_back';

-- Lat Pulldown: lats 65 + biceps 20 + upper_back 15
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 65 FROM exercises e, muscle_groups m
WHERE e.name = 'Lat Pulldown' AND m.name = 'lats';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 20 FROM exercises e, muscle_groups m
WHERE e.name = 'Lat Pulldown' AND m.name = 'biceps';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 15 FROM exercises e, muscle_groups m
WHERE e.name = 'Lat Pulldown' AND m.name = 'upper_back';

-- Dumbbell Row: lats 45 + upper_back 30 + biceps 15 + rear_delts 10
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 45 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Row' AND m.name = 'lats';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 30 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Row' AND m.name = 'upper_back';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 15 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Row' AND m.name = 'biceps';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 10 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Row' AND m.name = 'rear_delts';

-- Leg Press: quads 65 + glutes 25 + hamstrings 10
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 65 FROM exercises e, muscle_groups m
WHERE e.name = 'Leg Press' AND m.name = 'quads';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 25 FROM exercises e, muscle_groups m
WHERE e.name = 'Leg Press' AND m.name = 'glutes';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 10 FROM exercises e, muscle_groups m
WHERE e.name = 'Leg Press' AND m.name = 'hamstrings';

-- Leg Curl: hamstrings 90 + calves 10
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 90 FROM exercises e, muscle_groups m
WHERE e.name = 'Leg Curl' AND m.name = 'hamstrings';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 10 FROM exercises e, muscle_groups m
WHERE e.name = 'Leg Curl' AND m.name = 'calves';

-- Leg Extension: quads 100
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 100 FROM exercises e, muscle_groups m
WHERE e.name = 'Leg Extension' AND m.name = 'quads';

-- Lateral Raise: side_delts 90 + traps 10
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 90 FROM exercises e, muscle_groups m
WHERE e.name = 'Lateral Raise' AND m.name = 'side_delts';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 10 FROM exercises e, muscle_groups m
WHERE e.name = 'Lateral Raise' AND m.name = 'traps';

-- Dumbbell Curl: biceps 85 + forearms 15
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 85 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Curl' AND m.name = 'biceps';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 15 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Curl' AND m.name = 'forearms';

-- Tricep Pushdown: triceps 100
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 100 FROM exercises e, muscle_groups m
WHERE e.name = 'Tricep Pushdown' AND m.name = 'triceps';

-- Calf Raise: calves 100
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 100 FROM exercises e, muscle_groups m
WHERE e.name = 'Calf Raise' AND m.name = 'calves';

-- Cable Fly: chest 85 + front_delts 15
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'primary', 85 FROM exercises e, muscle_groups m
WHERE e.name = 'Cable Fly' AND m.name = 'chest';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, contribution_pct)
SELECT e.id, m.id, 'secondary', 15 FROM exercises e, muscle_groups m
WHERE e.name = 'Cable Fly' AND m.name = 'front_delts';


-- ============================================================================
--  ŞEMA TAMAM — Katman 1: 7 tablo, seed dahil
--  users, refresh_tokens, muscle_groups, exercises,
--  exercise_muscle_groups, workouts, sets
--
--  SCHEMA BACKLOG (ileriki fazlarda migration'la eklenecekler):
--   Faz 2 → follows, workout_likes, workout_comments, personal_records,
--           notifications, body_measurements, progress_photos
--   Faz 3 → mesocycles, workout_templates, program_recommendations,
--           readiness_logs, users.experience_level, users.primary_goal
--   Faz 4+ → set_videos, video_analyses (CV) · sensor_recordings (HAR)
--   Ayrıca → sets.rest_seconds, sets.source, exercises.slug (gerekirse)
-- ============================================================================