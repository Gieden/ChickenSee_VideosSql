-- ============================================================================
-- ChickenSee (ZAMPEN Poultry Analytics) — Simplified 6-Table ERD Schema
-- PostgreSQL / Supabase compatible DDL with explicit PKs and FKs.
-- Paste into Supabase SQL Editor -> Schema Visualizer, dbdiagram.io, DrawSQL,
-- or Lucidchart to generate a clean, presentation-ready ERD.
-- ============================================================================

-- 1. Users (Admin & Staff Portal Accounts)
CREATE TABLE IF NOT EXISTS public.users (
    id            TEXT PRIMARY KEY,
    username      VARCHAR(64) NOT NULL UNIQUE,
    display_name  VARCHAR(128) NOT NULL,
    role          VARCHAR(16) NOT NULL DEFAULT 'staff'
                  CHECK (role IN ('admin', 'staff')),
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by    VARCHAR(64) REFERENCES public.users(username) ON DELETE SET NULL
);

-- 2. Videos (Processed Video Jobs & Recording Metadata)
CREATE TABLE IF NOT EXISTS public.videos (
    id                BIGSERIAL PRIMARY KEY,
    video_filename    VARCHAR(255) NOT NULL UNIQUE,
    video_path        VARCHAR(512) NOT NULL,
    date_slot         DATE NOT NULL,
    hour_slot         VARCHAR(16) NOT NULL,
    start_time        TIMESTAMPTZ NOT NULL,
    end_time          TIMESTAMPTZ NOT NULL,
    fps               DOUBLE PRECISION NOT NULL DEFAULT 20.0,
    total_frames      INTEGER NOT NULL DEFAULT 0,
    status            VARCHAR(20) NOT NULL DEFAULT 'QUEUED'
                      CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
    processing_time_s DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    uploaded_by       VARCHAR(64) REFERENCES public.users(username) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ
);

-- 3. Sensor Logs (Live IoT Stream & Video-Paired Environmental Readings)
CREATE TABLE IF NOT EXISTS public.sensor_logs (
    id             BIGSERIAL PRIMARY KEY,
    video_id       BIGINT REFERENCES public.videos(id) ON DELETE SET NULL,
    frame_index    INTEGER,
    recorded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    temperature_c  DOUBLE PRECISION,
    humidity_pct   DOUBLE PRECISION,
    ammonia_ppm    DOUBLE PRECISION,
    sound_db       DOUBLE PRECISION
);

-- 4. Interval Metrics (30-Minute Flock & Microclimate Rollups)
CREATE TABLE IF NOT EXISTS public.interval_metrics (
    id                    BIGSERIAL PRIMARY KEY,
    video_id              BIGINT NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
    chunk_index           INTEGER NOT NULL,
    date_slot             DATE NOT NULL,
    hour_slot             VARCHAR(16) NOT NULL,
    chunk_start           TIMESTAMPTZ NOT NULL,
    chunk_end             TIMESTAMPTZ NOT NULL,
    temp_avg_c            DOUBLE PRECISION,
    humidity_avg_pct      DOUBLE PRECISION,
    ammonia_ppm_avg       DOUBLE PRECISION,
    thi_avg               DOUBLE PRECISION,
    heat_stress_level     VARCHAR(32) NOT NULL DEFAULT 'Normal',
    unique_birds_tracked  INTEGER NOT NULL DEFAULT 0,
    avg_birds_in_frame    DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    feeding_time_total_s  DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    drinking_time_total_s DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    inactivity_pct        DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Bird Behaviors (Per-Bird Tracked Behavior Breakdown per 30-Min Interval)
CREATE TABLE IF NOT EXISTS public.bird_behaviors (
    id                      BIGSERIAL PRIMARY KEY,
    interval_id             BIGINT NOT NULL REFERENCES public.interval_metrics(id) ON DELETE CASCADE,
    track_id                INTEGER NOT NULL,
    bird_label              VARCHAR(64) NOT NULL,  -- e.g. 'Hen1 (Yellow)', 'Rooster', 'Chicken'
    bird_type               VARCHAR(16) NOT NULL,  -- 'hen' or 'rooster'
    feeding_s               DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    feeding_bouts           INTEGER NOT NULL DEFAULT 0,
    drinking_s              DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    drinking_bouts          INTEGER NOT NULL DEFAULT 0,
    inactivity_s            DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    is_lethargic            BOOLEAN NOT NULL DEFAULT FALSE,
    social_isolation_events INTEGER NOT NULL DEFAULT 0,
    avg_velocity_px_s       DOUBLE PRECISION NOT NULL DEFAULT 0.0
);

-- 6. Archives (Data Retention & SQL Backup Manifests)
CREATE TABLE IF NOT EXISTS public.archives (
    archive_id          TEXT PRIMARY KEY,
    file_name           TEXT NOT NULL,
    scope               VARCHAR(16) NOT NULL,
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    archived_dates_json JSONB NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by          VARCHAR(64) NOT NULL REFERENCES public.users(username) ON DELETE RESTRICT
);

-- Core Indexes
CREATE INDEX IF NOT EXISTS idx_videos_date_status ON public.videos (date_slot, status);
CREATE INDEX IF NOT EXISTS idx_sensor_logs_recorded ON public.sensor_logs (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_logs_video ON public.sensor_logs (video_id, frame_index);
CREATE INDEX IF NOT EXISTS idx_interval_metrics_video ON public.interval_metrics (video_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_bird_behaviors_interval ON public.bird_behaviors (interval_id, track_id);
