export type ChickenIdDisplayFormat = 'short' | 'ch' | 'profile';

export type ExcelSheetName =
  | 'behavior_events'
  | 'detection_tracking'
  | 'observation_windows'
  | 'environment_readings';

export interface BirdDef {
  shortId: 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'R1';
  chId: 'CH01' | 'CH02' | 'CH03' | 'CH04' | 'CH05' | 'CH06';
  profileLabel: string;
  saddleColor: string;
  dotColor: string;
  trackId: number;
}

export const BIRD_DEFINITIONS: Record<'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'R1', BirdDef> = {
  H1: { shortId: 'H1', chId: 'CH01', profileLabel: 'H1 (Yellow)', saddleColor: 'yellow', dotColor: '#eab308', trackId: 1 },
  H2: { shortId: 'H2', chId: 'CH02', profileLabel: 'H2 (Blue)', saddleColor: 'blue', dotColor: '#2563eb', trackId: 2 },
  H3: { shortId: 'H3', chId: 'CH03', profileLabel: 'H3 (Red)', saddleColor: 'red', dotColor: '#dc2626', trackId: 3 },
  H4: { shortId: 'H4', chId: 'CH04', profileLabel: 'H4 (White)', saddleColor: 'white', dotColor: '#94a3b8', trackId: 4 },
  H5: { shortId: 'H5', chId: 'CH05', profileLabel: 'H5 (Yellow-Green)', saddleColor: 'yellowgreen', dotColor: '#65a30d', trackId: 5 },
  R1: { shortId: 'R1', chId: 'CH06', profileLabel: 'R1 (Rooster)', saddleColor: 'red', dotColor: '#b91c1c', trackId: 6 },
};

export const ORDERED_BIRDS: BirdDef[] = [
  BIRD_DEFINITIONS.H1,
  BIRD_DEFINITIONS.H2,
  BIRD_DEFINITIONS.H3,
  BIRD_DEFINITIONS.H4,
  BIRD_DEFINITIONS.H5,
  BIRD_DEFINITIONS.R1,
];

export function mapBirdToDef(labelRaw?: string, trackIdRaw?: number): BirdDef {
  const lbl = (labelRaw || '').toUpperCase();
  if (lbl.includes('ROOSTER') || lbl.includes('R1') || lbl.includes('CH06')) return BIRD_DEFINITIONS.R1;
  if (lbl.includes('HEN1') || lbl.includes('H1') || lbl.includes('CH01') || lbl.includes('YELLOW')) return BIRD_DEFINITIONS.H1;
  if (lbl.includes('HEN2') || lbl.includes('H2') || lbl.includes('CH02') || lbl.includes('BLUE')) return BIRD_DEFINITIONS.H2;
  if (lbl.includes('HEN3') || lbl.includes('H3') || lbl.includes('CH03') || lbl.includes('RED')) return BIRD_DEFINITIONS.H3;
  if (lbl.includes('HEN4') || lbl.includes('H4') || lbl.includes('CH04') || lbl.includes('WHITE')) return BIRD_DEFINITIONS.H4;
  if (lbl.includes('HEN5') || lbl.includes('H5') || lbl.includes('CH05') || lbl.includes('YELLOWGREEN') || lbl.includes('YELLOW-GREEN')) {
    return BIRD_DEFINITIONS.H5;
  }
  const tid = Number(trackIdRaw);
  if (tid === 1) return BIRD_DEFINITIONS.H1;
  if (tid === 2) return BIRD_DEFINITIONS.H2;
  if (tid === 3) return BIRD_DEFINITIONS.H3;
  if (tid === 4) return BIRD_DEFINITIONS.H4;
  if (tid === 5) return BIRD_DEFINITIONS.H5;
  if (tid === 6) return BIRD_DEFINITIONS.R1;
  return BIRD_DEFINITIONS.H1;
}

// ── 1. Observation Windows ──────────────────────────────────────────────────
export interface ObservationWindowRow {
  video: string;
  chicken_id: string;
  shortId: string;
  chId: string;
  profileLabel: string;
  saddleColor: string;
  dotColor: string;
  window_start: string;
  window_end: string;
  window_duration_s: number;
  valid_observation_duration_s: number;
  occluded_duration_s: number;
  lost_duration_s: number;
  valid_observation_pct: number;
}

// ── 2. Behavior Events ──────────────────────────────────────────────────────
export interface BehaviorEventRow {
  video: string;
  track_id: number;
  chicken_id: string;
  shortId: string;
  chId: string;
  profileLabel: string;
  saddle_color: string;
  dotColor: string;
  identity_status: 'confirmed' | 'assigned_during_tracking';
  behavior: string;
  start_time: string;
  end_time: string;
  start_s: number;
  end_s: number;
  duration_s: number;
  tracking_visible_pct: number;
  mean_detection_conf: number;
  nearest_distance_mean_px: number;
  nearest_distance_min_px: number;
  nearest_distance_max_px: number;
  nearest_distance_mean_body_lengths: number;
  nearest_distance_min_body_lengths: number;
  nearest_distance_max_body_lengths: number;
  weather_alert: boolean;
}

// ── 3. Detection Tracking ───────────────────────────────────────────────────
export interface DetectionTrackingRow {
  timestamp: string;
  frame_number: number;
  chicken_id: string;
  shortId: string;
  chId: string;
  profileLabel: string;
  saddle_color: string;
  dotColor: string;
  track_id: number;
  x_center_px: number;
  y_center_px: number;
  bbox_width_px: number;
  bbox_height_px: number;
  detection_confidence: number;
  visibility_status: 'visible' | 'occluded' | 'lost';
  in_feeder_zone: boolean;
  in_waterer_zone: boolean;
  nearest_neighbor_distance_px: number;
  nearest_neighbor_distance_body_lengths: number;
  visible_chicken_count: number;
}

// ── 4. Environment Readings ─────────────────────────────────────────────────
export interface EnvironmentReadingRow {
  timestamp: string;
  temperature_c: number;
  humidity_pct: number;
  ammonia_ppm: number;
  sound_db: number;
}
