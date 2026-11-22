-- ============================================================================
-- ChickenSee (ZAMPEN Poultry Analytics) — Complete Connected Supabase/PostgreSQL ERD
-- All 12 tables with explicit PRIMARY KEY and FOREIGN KEY relationships
-- (zero orphan tables). Paste into Supabase SQL Editor -> Schema Visualizer,
-- dbdiagram.io, DrawSQL, Lucidchart, or pgAdmin.
-- ============================================================================

-- 1. Staff & Admin Accounts (persisted in Supabase Storage auth/staff-accounts.json)
CREATE TABLE IF NOT EXISTS public.staff_accounts (
    id            TEXT PRIMARY KEY,
    username      VARCHAR(64) NOT NULL UNIQUE,
    display_name  VARCHAR(128) NOT NULL,
    role          VARCHAR(16) NOT NULL DEFAULT 'staff'
                  CHECK (role IN ('admin', 'staff')),
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by    VARCHAR(64) REFERENCES public.staff_accounts(username) ON DELETE SET NULL
);

-- 2. Archive & Retention Registry (created by an admin user)
CREATE TABLE IF NOT EXISTS public.chickensee_archive_registry (
    archive_id          TEXT PRIMARY KEY,
    file_name           TEXT NOT NULL,
    scope               VARCHAR(16) NOT NULL,
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    archived_dates_json JSONB NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by          VARCHAR(64) NOT NULL REFERENCES public.staff_accounts(username) ON DELETE RESTRICT
);

-- 3. Live IoT Sensor Telemetry (Supabase Cloud Postgres Table: public.sensor_logs)
CREATE TABLE IF NOT EXISTS public.sensor_logs (
    id              BIGSERIAL PRIMARY KEY,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    temperature     DOUBLE PRECISION,
    humidity        DOUBLE PRECISION,
    ammonia_ppm     DOUBLE PRECISION,
    sound_db        DOUBLE PRECISION
);

-- 4. Paired Video Recording Metadata (from paired sensors.sqlite)
CREATE TABLE IF NOT EXISTS public.recording (
    id                BIGSERIAL PRIMARY KEY,
    video_file        TEXT NOT NULL,
    started_at        TIMESTAMPTZ NOT NULL,
    ended_at          TIMESTAMPTZ,
    fps               DOUBLE PRECISION NOT NULL,
    width             INTEGER NOT NULL,
    height            INTEGER NOT NULL,
    frame_count       INTEGER NOT NULL DEFAULT 0,
    duration_seconds  DOUBLE PRECISION NOT NULL DEFAULT 0,
    save_reason       TEXT NOT NULL DEFAULT 'recording'
);

-- 5. Frame-Synced Video Sensor Readings (links recording <-> cloud sensor_logs)
CREATE TABLE IF NOT EXISTS public.video_sensor_logs (
    id                BIGSERIAL PRIMARY KEY,
    recording_id      BIGINT NOT NULL REFERENCES public.recording(id) ON DELETE CASCADE,
    sensor_log_id     BIGINT REFERENCES public.sensor_logs(id) ON DELETE SET NULL,
    frame_index       INTEGER NOT NULL,
    elapsed_seconds   DOUBLE PRECISION NOT NULL,
    video_time        TEXT NOT NULL,
    captured_at       TIMESTAMPTZ NOT NULL,
    recorded_at       TIMESTAMPTZ,
    temperature       DOUBLE PRECISION,
    humidity          DOUBLE PRECISION,
    ammonia_ppm       DOUBLE PRECISION,
    ammonia_raw       INTEGER,
    sound_db          DOUBLE PRECISION,
    sound_raw         INTEGER,
    temp_status       INTEGER,
    hum_status        INTEGER,
    ammonia_status    INTEGER,
    sound_status      INTEGER
);

-- 6. Video Processing Queue & Job State Manager (analytics/zampen_analytics.db)
CREATE TABLE IF NOT EXISTS public.processing_jobs (
    id                BIGSERIAL PRIMARY KEY,
    recording_id      BIGINT REFERENCES public.recording(id) ON DELETE SET NULL,
    triggered_by      VARCHAR(64) REFERENCES public.staff_accounts(username) ON DELETE SET NULL,
    video_filename    VARCHAR(255) NOT NULL UNIQUE,
    video_path        VARCHAR(512) NOT NULL,
    date_slot         VARCHAR(32) NOT NULL,   -- YYYY-MM-DD
    hour_slot         VARCHAR(32) NOT NULL,   -- HH:00
    start_time        TIMESTAMPTZ NOT NULL,
    end_time          TIMESTAMPTZ NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'QUEUED'
                      CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
    frames_processed  INTEGER NOT NULL DEFAULT 0,
    progress_frames   INTEGER,
    total_frames      INTEGER NOT NULL DEFAULT 0,
    source_size       BIGINT,
    source_mtime_ns   BIGINT,
    source_ctime_ns   BIGINT,
    processing_time_s DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    error_message     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ
);

-- 7. 30-Minute Chunk Flock & Environment Metrics (1-to-Many from processing_jobs)
CREATE TABLE IF NOT EXISTS public.half_hour_metrics (
    id                           BIGSERIAL PRIMARY KEY,
    job_id                       BIGINT NOT NULL REFERENCES public.processing_jobs(id) ON DELETE CASCADE,
    date_slot                    VARCHAR(32) NOT NULL,
    hour_slot                    VARCHAR(32) NOT NULL,
    chunk_index                  INTEGER NOT NULL,
    chunk_start                  TIMESTAMPTZ NOT NULL,
    chunk_end                    TIMESTAMPTZ NOT NULL,

    -- Environmental Averages
    temp_avg_c                   DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    temp_min_c                   DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    temp_max_c                   DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    humidity_avg_pct             DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    humidity_min_pct             DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    humidity_max_pct             DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    ammonia_ppm_avg              DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    ammonia_ppm_max              DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    lux_avg                      DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    thi_avg                      DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    heat_stress_level            VARCHAR(32) NOT NULL DEFAULT 'Normal',
    sensor_data_available        BOOLEAN NOT NULL DEFAULT FALSE,

    -- Flock Vision & Tracking Metrics
    unique_birds_tracked         INTEGER NOT NULL DEFAULT 0,
    avg_birds_in_frame           DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    flock_mobility_px_s          DOUBLE PRECISION NOT NULL DEFAULT 0.0,

    -- 4-Behavior Summary Metrics
    feeding_time_total_s         DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    feeding_bouts                INTEGER NOT NULL DEFAULT 0,
    reduced_eating_events        INTEGER NOT NULL DEFAULT 0,
    reduced_eating_index         DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    drinking_time_total_s        DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    drinking_bouts               INTEGER NOT NULL DEFAULT 0,
    drinking_frequency_per_bird  DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    inactivity_time_total_s      DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    inactivity_pct               DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    lethargic_birds_flagged      INTEGER NOT NULL DEFAULT 0,
    feather_pecking_events       INTEGER NOT NULL DEFAULT 0,
    agitation_score              DOUBLE PRECISION NOT NULL DEFAULT 0.0,

    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Per-Bird Tracked Behavior Metrics (1-to-Many from half_hour_metrics)
CREATE TABLE IF NOT EXISTS public.bird_track_metrics (
    id                      BIGSERIAL PRIMARY KEY,
    chunk_metric_id         BIGINT NOT NULL REFERENCES public.half_hour_metrics(id) ON DELETE CASCADE,
    track_id                INTEGER NOT NULL,
    bird_label              VARCHAR(64) NOT NULL,  -- e.g. 'Hen1 (Yellow)', 'Rooster', 'Chicken'
    bird_type               VARCHAR(32) NOT NULL,  -- 'hen' or 'rooster'
    feeding_s               DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    feeding_bouts           INTEGER NOT NULL DEFAULT 0,
    reduced_eating_flag     INTEGER NOT NULL DEFAULT 0,
    drinking_s              DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    drinking_bouts          INTEGER NOT NULL DEFAULT 0,
    inactivity_s            DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    is_lethargic            INTEGER NOT NULL DEFAULT 0,
    pecking_aggressor_count INTEGER NOT NULL DEFAULT 0,
    pecking_victim_count    INTEGER NOT NULL DEFAULT 0,
    avg_velocity_px_s       DOUBLE PRECISION NOT NULL DEFAULT 0.0
);

-- 9. Edge Hourly Flock Telemetry Rollup (linked to processing_jobs)
CREATE TABLE IF NOT EXISTS public.hourly_flock_telemetry (
    id                          BIGSERIAL PRIMARY KEY,
    processing_job_id           BIGINT REFERENCES public.processing_jobs(id) ON DELETE SET NULL,
    date                        DATE NOT NULL,
    hour_slot                   VARCHAR(32) NOT NULL,
    start_time                  TIMESTAMPTZ NOT NULL,
    end_time                    TIMESTAMPTZ NOT NULL,
    total_frames                INTEGER NOT NULL,
    avg_fps                     DOUBLE PRECISION NOT NULL,
    unique_birds                INTEGER NOT NULL,
    avg_birds_present           DOUBLE PRECISION NOT NULL,
    rooster_detections          INTEGER NOT NULL,
    identified_hens_count       INTEGER NOT NULL,
    unidentified_chickens_count INTEGER NOT NULL,
    feeding_time_pct            DOUBLE PRECISION NOT NULL,
    drinking_time_pct           DOUBLE PRECISION NOT NULL,
    active_time_pct             DOUBLE PRECISION NOT NULL,
    resting_time_pct            DOUBLE PRECISION NOT NULL,
    agitated_time_pct           DOUBLE PRECISION NOT NULL,
    flock_mobility_score        DOUBLE PRECISION NOT NULL,
    temp_mean                   DOUBLE PRECISION NOT NULL,
    temp_min                    DOUBLE PRECISION NOT NULL,
    temp_max                    DOUBLE PRECISION NOT NULL,
    humidity_mean               DOUBLE PRECISION NOT NULL,
    humidity_min                DOUBLE PRECISION NOT NULL,
    humidity_max                DOUBLE PRECISION NOT NULL,
    ammonia_ppm_mean            DOUBLE PRECISION NOT NULL,
    ammonia_ppm_max             DOUBLE PRECISION NOT NULL,
    lux_mean                    DOUBLE PRECISION NOT NULL,
    thi_mean                    DOUBLE PRECISION NOT NULL,
    heat_stress_alert           VARCHAR(32) NOT NULL,
    notes                       TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Edge Per-Bird Hourly Behavior (1-to-Many from hourly_flock_telemetry)
CREATE TABLE IF NOT EXISTS public.bird_hourly_behavior (
    id                  BIGSERIAL PRIMARY KEY,
    hourly_telemetry_id BIGINT NOT NULL REFERENCES public.hourly_flock_telemetry(id) ON DELETE CASCADE,
    date                DATE NOT NULL,
    hour_slot           VARCHAR(32) NOT NULL,
    track_id            INTEGER NOT NULL,
    bird_label          VARCHAR(64) NOT NULL,
    bird_type           VARCHAR(32) NOT NULL,
    feeding_sec         DOUBLE PRECISION NOT NULL,
    drinking_sec        DOUBLE PRECISION NOT NULL,
    active_sec          DOUBLE PRECISION NOT NULL,
    resting_sec         DOUBLE PRECISION NOT NULL,
    agitated_sec        DOUBLE PRECISION NOT NULL,
    feeding_bouts       INTEGER NOT NULL,
    drinking_bouts      INTEGER NOT NULL,
    avg_velocity_px_s   DOUBLE PRECISION NOT NULL,
    lethargic_alert     INTEGER NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Edge Raw Environmental Sensor Logs (aggregated into hourly_flock_telemetry)
CREATE TABLE IF NOT EXISTS public.environmental_logs_raw (
    id                  BIGSERIAL PRIMARY KEY,
    hourly_telemetry_id BIGINT REFERENCES public.hourly_flock_telemetry(id) ON DELETE SET NULL,
    timestamp           TIMESTAMPTZ NOT NULL,
    temperature_c       DOUBLE PRECISION NOT NULL,
    humidity_pct        DOUBLE PRECISION NOT NULL,
    ammonia_ppm         DOUBLE PRECISION NOT NULL,
    lux                 DOUBLE PRECISION NOT NULL,
    thi                 DOUBLE PRECISION NOT NULL,
    heat_stress_level   VARCHAR(32) NOT NULL
);

-- 12. Edge Device System Health Telemetry (recorded per hourly_flock_telemetry window)
CREATE TABLE IF NOT EXISTS public.edge_system_health (
    id                  BIGSERIAL PRIMARY KEY,
    hourly_telemetry_id BIGINT REFERENCES public.hourly_flock_telemetry(id) ON DELETE SET NULL,
    timestamp           TIMESTAMPTZ NOT NULL,
    hour_slot           VARCHAR(32) NOT NULL,
    cpu_pct             DOUBLE PRECISION NOT NULL,
    ram_mb              DOUBLE PRECISION NOT NULL,
    fps                 DOUBLE PRECISION NOT NULL,
    status              VARCHAR(32) NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sensor_logs_recorded_at ON public.sensor_logs (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_sensor_recording ON public.video_sensor_logs (recording_id, frame_index);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_date_hour ON public.processing_jobs (date_slot, hour_slot);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON public.processing_jobs (status);
CREATE INDEX IF NOT EXISTS idx_half_hour_job_id ON public.half_hour_metrics (job_id);
CREATE INDEX IF NOT EXISTS idx_half_hour_date_hour ON public.half_hour_metrics (date_slot, hour_slot);
CREATE INDEX IF NOT EXISTS idx_bird_track_chunk_id ON public.bird_track_metrics (chunk_metric_id);
CREATE INDEX IF NOT EXISTS idx_bird_track_id ON public.bird_track_metrics (track_id);
CREATE INDEX IF NOT EXISTS idx_hourly_env_raw ON public.environmental_logs_raw (hourly_telemetry_id);
CREATE INDEX IF NOT EXISTS idx_hourly_edge_health ON public.edge_system_health (hourly_telemetry_id);
