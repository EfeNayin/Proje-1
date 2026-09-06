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

-- unaccent: aksan/çengel işaretlerini soyar. "Göğüs" → "Gogus", "Sırt" → "Sirt".
-- Telefonda çoğu kullanıcı Türkçe karakter yazmadığı için arama bunu kullanır:
-- "gogus" yazan "Göğüs"ü bulabilmeli.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- pg_trgm: metni 3 harflik parçalara bölerek GIN indeksinde saklar. Arama
-- "%bench%" gibi iki taraflı joker kullandığı için buna ihtiyaç var — btree
-- indeksi bu kalıbı hiçbir şekilde karşılayamaz, sadece "bench%" öneklerini.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() varsayılan olarak STABLE'dır (kullanılan sözlüğe bağlı olduğu için)
-- ve bu haliyle indeks ifadesinde kullanılamaz. Sözlüğü açıkça sabitleyen bu
-- sarmalayıcı IMMUTABLE olarak işaretlenebilir, böylece hem sorguda hem
-- indekste aynı fonksiyonu kullanıp indeksten faydalanabiliriz.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

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

    -- IANA saat dilimi adı ('Europe/Istanbul', 'America/New_York').
    -- ZORUNLU: haftalık hacim analitiği "hafta" sınırını kullanıcının YEREL
    -- saatine göre belirlemeli. performed_at TIMESTAMPTZ olduğu için UTC'de
    -- saklanır; UTC üzerinden date_trunc('week') alınırsa İstanbul'da
    -- Pazartesi 01:00'de yapılan antrenman (UTC'de Pazar 22:00) bir ÖNCEKİ
    -- haftaya düşer. Bu bilgi sonradan geriye dönük türetilemez, o yüzden
    -- ilk kayıttan itibaren tutulur. İstemci cihazın saat dilimini gönderir.
    timezone      TEXT         NOT NULL DEFAULT 'Europe/Istanbul',

    -- BCP 47 dil etiketi ('tr', 'en', ileride 'de'...). Arayüz dili ve
    -- sunucudan dönen metinler için. Geçerli değerler uygulama katmanında
    -- kısıtlanır; burada CHECK yok ki yeni dil eklemek migration gerektirmesin.
    locale        TEXT         NOT NULL DEFAULT 'tr',

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

-- Kas grubu adıyla arama/filtreleme (hacim ekranı). exercises ile aynı kalıp.
CREATE INDEX idx_muscle_groups_name_tr ON muscle_groups
    USING GIN (lower(immutable_unaccent(name_tr)) gin_trgm_ops);


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

-- Egzersiz arama (GET /exercises?q=bench). İki özellik birleşiyor:
--  • immutable_unaccent + lower → "gogus" yazan "Göğüs"ü bulur
--  • GIN + gin_trgm_ops → "%bench%" ortadan eşleşmesi indeksten faydalanır
-- Sorgu tarafında AYNI ifade kullanılmalı (bkz. exercises/service.py
-- _normalise), yoksa planner indeksi eşleştiremez ve sessizce seq scan'e döner.
CREATE INDEX idx_exercises_name ON exercises
    USING GIN (lower(immutable_unaccent(name)) gin_trgm_ops);
CREATE INDEX idx_exercises_name_tr ON exercises
    USING GIN (lower(immutable_unaccent(name_tr)) gin_trgm_ops);


-- ─────────────────────────────────────────────────────────────────────────
--  exercise_muscle_groups  ·  Egzersiz → kas ilişkisi (ANALİTİĞİN KALBİ)
-- ─────────────────────────────────────────────────────────────────────────
--  İki BAĞIMSIZ boyut tutuyoruz:
--
--  role: 'primary' = bu hareket bu kası DOĞRUDAN çalıştırır.
--        'secondary' = kas dahil oluyor ama hareketin hedefi değil.
--        Haftalık set sayımı (direct_sets) yalnızca primary satırları sayar.
--        Sebebi: RP'nin yayınladığı MEV/MAV/MRV eşikleri doğrudan çalışma
--        için kalibre edilmiştir — presleme gibi hareketlerden gelen dolaylı
--        hacim eşiklere zaten dahil edilip sayılar aşağı çekilmiştir. Dolaylı
--        hacmi ayrıca eklemek çift sayım olur.
--        (rpstrength.com/expert-advice/training-volume-landmarks-muscle-growth)
--
--  effectiveness: 1-5. Bu hareketin BU kas için ne kadar iyi bir seçim
--        olduğu. Ölçüm değil, değerlendirme — bilinçli olarak öyle
--        tasarlandı. Yüzdeyle katkı dağıtmak sahte bir kesinlik yaratıyordu;
--        elimizde her hareket için EMG verisi yok.
--          5 → bu kas için en iyi seçeneklerden biri
--          4 → iyi, küçük eksiklerle (gerilme veya yüklenebilirlik sınırlı)
--          3 → işe yarar ama optimal değil
--          2 → zayıf uyarı, yardımcı rol
--          1 → marjinal, kas aktif ama büyüme uyarısı sayılmaz
--        İki boyut bağımsız: barfiks pazıya secondary ama etkili (4).
CREATE TABLE exercise_muscle_groups (
    exercise_id      UUID      NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    muscle_group_id  SMALLINT  NOT NULL REFERENCES muscle_groups(id) ON DELETE RESTRICT,
    role             TEXT      NOT NULL DEFAULT 'primary'
                     CHECK (role IN ('primary', 'secondary')),
    effectiveness    SMALLINT  NOT NULL
                     CHECK (effectiveness BETWEEN 1 AND 5),
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


-- ─────────────────────────────────────────────────────────────────────────
--  readiness_logs  ·  Günlük durum kaydı (iç kullanım → BIGSERIAL)
-- ─────────────────────────────────────────────────────────────────────────
--  Amaç TEŞHİS: kullanıcı gelişemediğinde sebebi programda mı, toparlanmada
--  mı, beslenmede mi görebilsin. Hacim analitiği "yeterli çalıştın mı"
--  sorusunu yanıtlıyor; bu tablo "toparlanabildin mi" tarafını tutuyor.
--
--  GÜNLÜK, antrenman başına DEĞİL: uyku ve ruh hali güne aittir. Aynı gün
--  iki antrenman yapan aynı cevabı iki kez girmemeli, ve dinlenme günlerinin
--  kaydı da değerli ("dinlenme günlerinde bile 5 saat uyuyorsun").
--  Bu yüzden workout_id yok, UNIQUE(user_id, log_date) var.
--
--  Tüm alanlar NULL olabilir: kayıt tamamen opsiyoneldir, kullanıcı sadece
--  uykusunu girip gerisini boş bırakabilmeli. Her zorunlu alan, her antrenman
--  öncesi tekrarlanan bir sürtünmedir.
--
--  log_date KULLANICININ YEREL tarihidir (users.timezone), UTC değil —
--  haftalık hacimdeki aynı gerekçe: gece 01:00'de girilen kayıt o güne ait.
CREATE TABLE readiness_logs (
    id            BIGSERIAL    PRIMARY KEY,
    user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    log_date      DATE         NOT NULL,

    sleep_hours   NUMERIC(3,1) CHECK (sleep_hours >= 0 AND sleep_hours <= 24),
    sleep_quality SMALLINT     CHECK (sleep_quality BETWEEN 1 AND 5),
    energy        SMALLINT     CHECK (energy BETWEEN 1 AND 5),
    mood          SMALLINT     CHECK (mood BETWEEN 1 AND 5),

    -- Kas grubu → ağrı şiddeti (1-5), örn. {"chest": 3, "quads": 5}.
    -- JSONB çünkü 17 kas için 17 kolon açmak anlamsız; kullanıcı genelde
    -- birkaç kas işaretler. Anahtarların muscle_groups.name ile eşleştiği
    -- ve değerlerin 1-5 olduğu uygulama katmanında doğrulanır (DB'de
    -- zorlamak trigger gerektirir, o karmaşıklık bu veri için fazla).
    soreness      JSONB,

    notes         TEXT,

    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- Gün içinde tekrar girilirse yeni satır değil güncelleme olur.
    UNIQUE (user_id, log_date)
);

-- "Son N günün kaydı, yeniden eskiye" — teşhis ekranının tek sorgusu.
CREATE INDEX idx_readiness_user_date ON readiness_logs(user_id, log_date DESC);

CREATE TRIGGER readiness_logs_set_updated_at
    BEFORE UPDATE ON readiness_logs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────
--  programs  ·  Bir antrenman programı (dışa açık → UUID)
-- ─────────────────────────────────────────────────────────────────────────
--  Kullanıcının şablonlarını gruplayan üst yapı. "PPL Programım", "5/3/1"
--  gibi. Neden grup: deload, program değiştirme, eski sisteme dönme —
--  hepsi program bazında anlamlı. Düz şablon listesi "programın neresindesin"
--  diyemez, bu tablo diyebilir.
--
--  is_active: kullanıcının ŞU AN takip ettiği program. Bir kullanıcının aynı
--  anda tek aktif programı olur (kısmi UNIQUE index ile zorlanır). Eski
--  programlar silinmez, arşivlenir (is_active=false) — "eski sisteme dönme"
--  senaryosu için geçmiş korunur.
CREATE TABLE programs (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT         NOT NULL,
    notes       TEXT,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Bir kullanıcının aktif programlarını listelemek + tek aktif zorlaması.
-- Kısmi UNIQUE: aynı anda sadece bir program is_active=true olabilir.
CREATE UNIQUE INDEX idx_programs_one_active
    ON programs(user_id) WHERE is_active;

CREATE INDEX idx_programs_user ON programs(user_id, created_at DESC);

CREATE TRIGGER programs_set_updated_at
    BEFORE UPDATE ON programs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────
--  workout_templates  ·  Program içindeki bir "gün" (Push A, Pull A...)
-- ─────────────────────────────────────────────────────────────────────────
--  Bir programa ait şablon. day_order programdaki sırayı tutar (Push=1,
--  Pull=2, Legs=3) — takvime SABİT gün değil, çünkü kullanıcı haftada 3 de
--  gidebilir 5 de; sıra bozulmaz. "Bugün push günü" kullanıcının seçimi,
--  dayatma değil (kullanıcının split-serbest tercihi bu şekilde korunur).
CREATE TABLE workout_templates (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id  UUID         NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    name        TEXT         NOT NULL,
    day_order   SMALLINT     NOT NULL DEFAULT 0,   -- program içi sıralama
    notes       TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_templates_program ON workout_templates(program_id, day_order);

CREATE TRIGGER workout_templates_set_updated_at
    BEFORE UPDATE ON workout_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────
--  template_exercises  ·  Şablondaki bir hareket + hedefleri (iç → BIGSERIAL)
-- ─────────────────────────────────────────────────────────────────────────
--  "Bench Press, 4 set, 6-8 tekrar, RIR 2" gibi. Gerçek performans değil
--  HEDEF — kullanıcı salonda bunu görüp gerçekleşeni sets tablosuna girer.
--
--  Tekrar ARALIK (target_reps_min/max), tek sayı değil: hipertrofide 6-8,
--  8-12 gibi aralıklar kullanılır. min=max girilirse sabit sayı olur.
--  RIR/RPE hedefi opsiyonel (bilim-temelli konumlanma için değerli).
CREATE TABLE template_exercises (
    id                BIGSERIAL   PRIMARY KEY,
    template_id       UUID        NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
    exercise_id       UUID        NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
    exercise_order    SMALLINT    NOT NULL DEFAULT 0,  -- şablon içi sıra

    target_sets       SMALLINT    NOT NULL CHECK (target_sets > 0),
    target_reps_min   SMALLINT    CHECK (target_reps_min > 0),
    target_reps_max   SMALLINT    CHECK (target_reps_max > 0),
    target_rir        SMALLINT    CHECK (target_rir BETWEEN 0 AND 10),
    target_rpe        NUMERIC(3,1) CHECK (target_rpe BETWEEN 1 AND 10),

    notes             TEXT,

    -- Aralık tutarlı olmalı: min <= max. İkisi de NULL olabilir (aralık
    -- belirtmeden sadece "4 set" demek geçerli).
    CONSTRAINT template_exercises_reps_range
        CHECK (target_reps_min IS NULL OR target_reps_max IS NULL
               OR target_reps_min <= target_reps_max)
);

CREATE INDEX idx_template_exercises ON template_exercises(template_id, exercise_order);


-- ─────────────────────────────────────────────────────────────────────────
--  workouts tablosuna bağlantı: bir antrenman hangi şablondan başlatıldı?
-- ─────────────────────────────────────────────────────────────────────────
--  Nullable: serbest loglama (şablonsuz) hâlâ geçerli. Şablondan başlatılan
--  antrenman bu alanı doldurur — böylece "bu programda kaç kez push yaptın",
--  "geçen push'ta ne kaldırdın" sorguları mümkün olur.
--  ON DELETE SET NULL: şablon silinse bile geçmiş antrenman korunur.
ALTER TABLE workouts
    ADD COLUMN template_id UUID REFERENCES workout_templates(id) ON DELETE SET NULL;

CREATE INDEX idx_workouts_template ON workouts(template_id)
    WHERE template_id IS NOT NULL;


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
--  SEED: exercise_muscle_groups — 20 egzersizin tamamı
--
--  role          : primary = doğrudan çalışma (haftalık set sayımına girer)
--                  secondary = dahil ama hedef değil (sayıma girmez)
--  effectiveness : 1-5, bu hareketin BU kas için ne kadar iyi olduğu.
--                  Ölçüm değil değerlendirme; ileride kendi kullanıcı
--                  verinizle veya literatürle kalibre edilebilir.
-- ============================================================================

-- Barbell Back Squat
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 5 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Back Squat' AND m.name = 'quads';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 4 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Back Squat' AND m.name = 'glutes';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 2 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Back Squat' AND m.name = 'hamstrings';

-- Barbell Front Squat
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 5 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Front Squat' AND m.name = 'quads';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Front Squat' AND m.name = 'glutes';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Front Squat' AND m.name = 'abs';

-- Conventional Deadlift
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 4 FROM exercises e, muscle_groups m
WHERE e.name = 'Conventional Deadlift' AND m.name = 'hamstrings';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 4 FROM exercises e, muscle_groups m
WHERE e.name = 'Conventional Deadlift' AND m.name = 'glutes';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 4 FROM exercises e, muscle_groups m
WHERE e.name = 'Conventional Deadlift' AND m.name = 'lower_back';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 2 FROM exercises e, muscle_groups m
WHERE e.name = 'Conventional Deadlift' AND m.name = 'lats';

-- Romanian Deadlift
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 5 FROM exercises e, muscle_groups m
WHERE e.name = 'Romanian Deadlift' AND m.name = 'hamstrings';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 4 FROM exercises e, muscle_groups m
WHERE e.name = 'Romanian Deadlift' AND m.name = 'glutes';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Romanian Deadlift' AND m.name = 'lower_back';

-- Barbell Bench Press
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 5 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Bench Press' AND m.name = 'chest';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Bench Press' AND m.name = 'triceps';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Bench Press' AND m.name = 'front_delts';

-- Incline Barbell Bench
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 5 FROM exercises e, muscle_groups m
WHERE e.name = 'Incline Barbell Bench' AND m.name = 'chest';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 4 FROM exercises e, muscle_groups m
WHERE e.name = 'Incline Barbell Bench' AND m.name = 'front_delts';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Incline Barbell Bench' AND m.name = 'triceps';

-- Dumbbell Bench Press
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 5 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Bench Press' AND m.name = 'chest';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Bench Press' AND m.name = 'triceps';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Bench Press' AND m.name = 'front_delts';

-- Overhead Press
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 5 FROM exercises e, muscle_groups m
WHERE e.name = 'Overhead Press' AND m.name = 'front_delts';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Overhead Press' AND m.name = 'triceps';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Overhead Press' AND m.name = 'side_delts';

-- Barbell Row
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 4 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Row' AND m.name = 'upper_back';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 4 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Row' AND m.name = 'lats';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Row' AND m.name = 'biceps';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Barbell Row' AND m.name = 'rear_delts';

-- Pull-up
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 5 FROM exercises e, muscle_groups m
WHERE e.name = 'Pull-up' AND m.name = 'lats';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 4 FROM exercises e, muscle_groups m
WHERE e.name = 'Pull-up' AND m.name = 'biceps';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Pull-up' AND m.name = 'upper_back';

-- Lat Pulldown
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 5 FROM exercises e, muscle_groups m
WHERE e.name = 'Lat Pulldown' AND m.name = 'lats';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Lat Pulldown' AND m.name = 'biceps';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Lat Pulldown' AND m.name = 'upper_back';

-- Dumbbell Row
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 4 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Row' AND m.name = 'lats';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 4 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Row' AND m.name = 'upper_back';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Row' AND m.name = 'biceps';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 2 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Row' AND m.name = 'rear_delts';

-- Leg Press
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 4 FROM exercises e, muscle_groups m
WHERE e.name = 'Leg Press' AND m.name = 'quads';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 3 FROM exercises e, muscle_groups m
WHERE e.name = 'Leg Press' AND m.name = 'glutes';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 2 FROM exercises e, muscle_groups m
WHERE e.name = 'Leg Press' AND m.name = 'hamstrings';

-- Leg Curl
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 5 FROM exercises e, muscle_groups m
WHERE e.name = 'Leg Curl' AND m.name = 'hamstrings';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 1 FROM exercises e, muscle_groups m
WHERE e.name = 'Leg Curl' AND m.name = 'calves';

-- Leg Extension
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 4 FROM exercises e, muscle_groups m
WHERE e.name = 'Leg Extension' AND m.name = 'quads';

-- Lateral Raise
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 5 FROM exercises e, muscle_groups m
WHERE e.name = 'Lateral Raise' AND m.name = 'side_delts';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 2 FROM exercises e, muscle_groups m
WHERE e.name = 'Lateral Raise' AND m.name = 'traps';

-- Dumbbell Curl
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 5 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Curl' AND m.name = 'biceps';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 2 FROM exercises e, muscle_groups m
WHERE e.name = 'Dumbbell Curl' AND m.name = 'forearms';

-- Tricep Pushdown
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 4 FROM exercises e, muscle_groups m
WHERE e.name = 'Tricep Pushdown' AND m.name = 'triceps';

-- Calf Raise
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 5 FROM exercises e, muscle_groups m
WHERE e.name = 'Calf Raise' AND m.name = 'calves';

-- Cable Fly
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'primary', 4 FROM exercises e, muscle_groups m
WHERE e.name = 'Cable Fly' AND m.name = 'chest';
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id, role, effectiveness)
SELECT e.id, m.id, 'secondary', 2 FROM exercises e, muscle_groups m
WHERE e.name = 'Cable Fly' AND m.name = 'front_delts';

-- ============================================================================
--  ŞEMA TAMAM — Katman 1: 11 tablo, seed dahil
--  users, refresh_tokens, muscle_groups, exercises,
--  exercise_muscle_groups, workouts, sets, readiness_logs,
--  programs, workout_templates, template_exercises
--
--  ULUSLARARASILAŞMA NOTLARI (bilinçli ertelenenler):
--   • week_start_day → date_trunc('week') HER ZAMAN Pazartesi'den başlar (ISO
--     8601). Türkiye ve Avrupa için doğru; ABD'de haftalar Pazar başlar. Bu
--     "yanlış veri" değil "farklı konvansiyon" — geçmişe dönük yeniden
--     hesaplanabildiği için users.week_start_day kolonu sonradan eklenebilir.
--   • Çok dilli katalog → şu an exercises.name (EN) + name_tr (TR) kolonları
--     var. 3. dil eklenirken bu kalıp bozulur; o noktada ayrı bir
--     exercise_translations(exercise_id, locale, name) tablosuna geçilmeli.
--     Katalog 20 satır olduğu sürece bu migration önemsiz, şimdi yapmak erken.
--   • Metinsel sıralama ve arama → veritabanı C.UTF-8 collation ile kurulur
--     (bkz. docker-compose.yml, POSTGRES_INITDB_ARGS). Bu, Unicode varsayılan
--     kurallarını uygular: ö/ü/ş/ğ/ç doğru küçülür, ama Türkçe'ye özgü I→ı
--     kuralı UYGULANMAZ. Mevcut 20 egzersizde bu fark hiçbir soruna yol
--     açmıyor (test edildi). GET /exercises?q= aramasını yazarken tekrar
--     değerlendir: gerekirse name_tr kolonuna Türkçe ICU collation ver
--     (CREATE COLLATION tr_icu (provider=icu, locale='tr-TR')). DİKKAT:
--     Türkçe collation'ı veritabanı geneline verme — lower('INCLINE') o zaman
--     'ınclıne' olur ve İngilizce arama bozulur. Dile duyarlı arama, ileride
--     çeviri tablosuna geçmenin bir başka gerekçesi.
--
--  SCHEMA BACKLOG (ileriki fazlarda migration'la eklenecekler):
--   Faz 2 → follows, workout_likes, workout_comments, personal_records,
--           notifications, body_measurements, progress_photos
--   Faz 3 → mesocycles, program_recommendations,
--           users.experience_level, users.primary_goal
--           (readiness_logs ve workout_templates bu listeden çıktı — ikisi de
--           Faz 3 beklenmeden şimdi eklendi, bkz. tablolar yukarıda)
--   Faz 4+ → set_videos, video_analyses (CV) · sensor_recordings (HAR)
--   Ayrıca → sets.rest_seconds, sets.source, exercises.slug (gerekirse)

--  ANTRENMAN TERMİNOLOJİSİ (kasıtlı olarak ertelenenler):
--   • sets.set_type → dropset / rest_pause için. Şu an sadece is_warmup var.
--     Mobil çalışıp gerçek kullanım görüldükten sonra eklenecek. Dropset'in
--     kaç set sayılacağı KULLANICI TERCİHİ olacak (users.dropset_counting
--     gibi bir ayar) — camiada ortak standart yok, kimi tek set kimi her
--     düşüşü ayrı sayıyor.
--   • personal_records + estimated_1rm → Faz 2. 1RM saklanan değil türetilen
--     bir değer (Epley/Brzycki), asıl anlamı PR takibi ve leaderboard'da.
--   • workout_templates.is_amrap → Faz 3. AMRAP bir programlama talimatı,
--     loglama alanı değil: seti yaptıktan sonra kaydedilen şey çıkan tekrar
--     sayısı ve RPE. Failure de RPE 10 / RIR 0 ile zaten ifade edilebiliyor.
-- ============================================================================