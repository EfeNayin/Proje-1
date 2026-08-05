-- ============================================================================
--  BodyTrack — schema_v1.sql  ·  KATMAN 1 (Çekirdek)
-- ============================================================================
--  Bu dosya Faz 1 MVP'sinin veri temelidir: manuel antrenman loglama +
--  kas grubu hacim analizi (MEV/MAV/MRV). Katman 2-5 (sosyal, mezocycle,
--  vücut ölçüleri, video) ihtiyaç geldikçe ayrı dosyalarda eklenecek.
--
--  Tasarım kararları (CLAUDE.md mimari prensipleri):
--   • UUID  → dışa açılan entity'ler (users, exercises, workouts).
--             Tahmin edilemez; URL/API'de güvenle paylaşılır; sharding-dostu.
--   • BIGSERIAL → çok satırlı, dışa açılmayan tablolar (sets). Daha küçük
--             indeks, daha hızlı insert; tahmin edilebilirliği sorun değil.
--   • Denormalize agregatlar (workouts.total_volume_kg) → her hacim sorgusunda
--             tüm set'leri toplamamak için. Yazarken bir kez hesapla, oku ucuz olsun.
--   • exercise_muscle_groups → hipertrofi analitiğinin KALBİ. Bir egzersizin
--             hangi kasa yüzde kaç katkı yaptığını tutar (contribution_pct).
--   • muscle_groups → MEV/MAV/MRV sabitleri (Renaissance Periodization referansı).
--   • Gizlilik default PRIVATE (is_private = true). Sosyal opsiyonel.
-- ============================================================================

-- citext: büyük/küçük harf duyarsız metin. "Efe@x.com" ile "efe@x.com" aynı
-- sayılsın diye email/username için kullanıyoruz (manuel LOWER() derdi olmaz).
CREATE EXTENSION IF NOT EXISTS citext;

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
--  Küçük, sabit bir küme (~12-15 satır) → SMALLSERIAL yeterli.
--  MEV/MAV/MRV = haftalık SET sayısı eşikleri (Renaissance Periodization):
--    MEV (Minimum Effective Volume)  → büyüme için gereken alt sınır
--    MAV (Maximum Adaptive Volume)   → en verimli aralık
--    MRV (Maximum Recoverable Volume)→ üstünde toparlanamama/aşırı yük
--  Analitik bu eşiklere bakıp "eksik / yeterli / fazla" der.
CREATE TABLE muscle_groups (
    id         SMALLSERIAL  PRIMARY KEY,
    name       TEXT         NOT NULL UNIQUE,    -- 'chest' (kod/sabit referans)
    name_tr    TEXT         NOT NULL,           -- 'Göğüs' (Türkçe arayüz — TR-first)
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


-- ─────────────────────────────────────────────────────────────────────────
--  exercise_muscle_groups  ·  Egzersiz → kas katkısı (ANALİTİĞİN KALBİ)
-- ─────────────────────────────────────────────────────────────────────────
--  Bir egzersizin yapılan her set'i, kaslara YÜZDE ile dağıtılır.
--  Örn. Bench Press: göğüs %70 (primary), ön omuz %15, triceps %15 (secondary).
--  "Haftalık göğüs seti" = ilgili set'lerin contribution_pct toplamı.
--  Bu sayede 1 set bench, göğüse 0.7 set, omuza 0.15 set olarak sayılabilir.
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
