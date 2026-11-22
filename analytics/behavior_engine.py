"""
analytics/behavior_engine.py
Behavior Detection & Spatial Kinematics Engine for ZAMPEN Layer Chickens.
Accurately detects and tracks the 4 primary poultry behaviors:
  1. Reduced feeding behavior (feeder proximity + localized intake motion drop or feeding deficit)
  2. Reduced drinking behavior (drinker linger without intake or prolonged visit deficit)
  3. Prolonged low activity (sustained immobility/lethargy below low-motion velocity threshold)
  4. Social isolation (spatial segregation beyond nearest-neighbor flock distance thresholds)
"""

import math
from typing import Dict, List, Tuple, Optional, Any
from dataclasses import dataclass, field
from collections import deque

from .config import CONFIG
from .tracker import TrackedDetection, TrackerFrameOutput


@dataclass
class BirdTrackState:
    track_id: int
    label: str
    bird_type: str
    last_centroid: Optional[Tuple[int, int]] = None
    last_timestamp_s: float = 0.0
    
    # Kinematics
    velocity_px_s: float = 0.0
    instant_velocity_px_s: float = 0.0          # Single-frame velocity
    recent_velocities: deque = field(default_factory=lambda: deque(maxlen=20))
    total_displacement_px: float = 0.0

    # 1. Reduced Feeding Behavior
    is_in_feeder_zone: bool = False
    feeding_time_s: float = 0.0
    active_feeding_time_s: float = 0.0
    feeding_bouts: int = 0
    feeder_stationary_time_s: float = 0.0      # In zone but not actively feeding
    reduced_feeding_events: int = 0

    # 2. Reduced Drinking Behavior
    is_in_waterer_zone: bool = False
    drinking_time_s: float = 0.0
    active_drinking_time_s: float = 0.0
    drinking_bouts: int = 0
    drinker_stationary_time_s: float = 0.0     # In zone without head-dip/drinking motion
    time_since_last_drinking_s: float = 0.0
    reduced_drinking_events: int = 0

    # 3. Prolonged Low Activity
    continuous_stationary_s: float = 0.0
    total_inactivity_s: float = 0.0
    prolonged_low_activity_events: int = 0
    is_lethargic_flag: bool = False

    # 4. Social Isolation
    continuous_isolation_s: float = 0.0
    total_isolation_s: float = 0.0
    social_isolation_events: int = 0
    is_isolated_flag: bool = False
    in_isolation_bout: bool = False

    # Legacy interaction counts (preserved for backward compatibility)
    pecking_aggressor_count: int = 0
    pecking_victim_count: int = 0

    # 5. Tracking Continuity & Observation Validity (frame-by-frame accumulation)
    valid_observation_s: float = 0.0
    occluded_s: float = 0.0
    unobserved_streak_s: float = 0.0
    last_feeder_center_dist: Optional[float] = None
    last_drinker_center_dist: Optional[float] = None
    feeder_immobile_s: float = 0.0
    current_behavior: str = "Active"


@dataclass
class BehaviorChunkSummary:
    unique_birds: int
    avg_birds_present: float
    flock_mobility_px_s: float
    
    # 1. Reduced Feeding Behavior
    feeding_time_total_s: float
    feeding_bouts: int
    reduced_feeding_events: int
    reduced_eating_events: int                # Backward-compatible alias
    reduced_eating_index: float               # Low-intake ratio
    
    # 2. Reduced Drinking Behavior
    drinking_time_total_s: float
    drinking_bouts: int
    drinking_frequency_per_bird: float
    reduced_drinking_events: int
    
    # 3. Prolonged Low Activity
    inactivity_time_total_s: float
    inactivity_pct: float
    prolonged_low_activity_events: int
    lethargic_birds_flagged: int
    
    # 4. Social Isolation
    social_isolation_events: int
    feather_pecking_events: int               # Backward-compatible interaction count
    agitation_score: float

    # Per-bird breakdown records
    bird_records: List[Dict[str, Any]]
    # Exact frame-by-frame verification logs (for Research Logs manual checking)
    behavior_events: List[Dict[str, Any]] = field(default_factory=list)
    detection_tracking: List[Dict[str, Any]] = field(default_factory=list)


class BehaviorAnalysisEngine:
    """
    Computes spatial kinematics, infrastructure interactions, and behavior events
    across 30-minute chunk intervals using persistent ByteTrack trajectories.
    Accurately tracks the 4 primary poultry behaviors:
      1. Reduced feeding behavior
      2. Reduced drinking behavior
      3. Prolonged low activity
      4. Social isolation
    """

    def __init__(self):
        self.cfg = CONFIG
        self.bird_states: Dict[int, BirdTrackState] = {}
        self.feather_pecking_events: int = 0
        self.total_frames_in_chunk: int = 0
        self.bird_frame_counts: List[int] = []
        self.pecking_cooldowns: Dict[Tuple[int, int], float] = {}
        self.current_chunk_elapsed_s: float = 0.0
        self._active_bouts: Dict[Tuple[int, str], Dict[str, Any]] = {}
        self._completed_bouts: List[Dict[str, Any]] = []
        self._detection_tracking_rows: List[Dict[str, Any]] = []

    def reset_chunk(self):
        """Resets tracking accumulators for a new 30-minute interval."""
        self.bird_states.clear()
        self.feather_pecking_events = 0
        self.total_frames_in_chunk = 0
        self.bird_frame_counts.clear()
        self.pecking_cooldowns.clear()
        self.current_chunk_elapsed_s = 0.0
        self._active_bouts.clear()
        self._completed_bouts.clear()
        self._detection_tracking_rows.clear()

    def get_live_bird_behaviors(self) -> Dict[int, str]:
        """Returns the current live behavior label for every tracked bird ID (for video HUD overlays)."""
        return {tid: st.current_behavior for tid, st in self.bird_states.items()}

    def _update_bout(
        self,
        tid: int,
        label: str,
        behavior: str,
        active: bool,
        frame_idx: int,
        elapsed_s: float,
        dt: float,
        conf: float,
        nn_px: float,
        nn_bl: float,
    ) -> None:
        key = (tid, behavior)
        if active:
            bout = self._active_bouts.get(key)
            if bout is None:
                self._active_bouts[key] = {
                    "track_id": tid,
                    "bird_label": label,
                    "behavior": behavior,
                    "start_frame": frame_idx,
                    "end_frame": frame_idx,
                    "start_s": max(0.0, elapsed_s - dt),
                    "end_s": elapsed_s,
                    "frames": 1,
                    "conf_sum": conf,
                    "nn_px": [nn_px] if nn_px > 0 else [],
                    "nn_bl": [nn_bl] if nn_bl > 0 else [],
                }
            else:
                bout["bird_label"] = label
                bout["end_frame"] = frame_idx
                bout["end_s"] = elapsed_s
                bout["frames"] += 1
                bout["conf_sum"] += conf
                if nn_px > 0:
                    bout["nn_px"].append(nn_px)
                if nn_bl > 0:
                    bout["nn_bl"].append(nn_bl)
        else:
            bout = self._active_bouts.pop(key, None)
            if bout is not None:
                self._finalize_bout(bout)

    def _finalize_bout(self, bout: Dict[str, Any]) -> None:
        dur_s = round(max(0.0, bout["end_s"] - bout["start_s"]), 1)
        if dur_s < 1.0 or len(self._completed_bouts) >= 1500:
            return
        nn_px = bout["nn_px"]
        nn_bl = bout["nn_bl"]
        frames = max(1, bout["frames"])
        self._completed_bouts.append({
            "track_id": bout["track_id"],
            "bird_label": bout["bird_label"],
            "behavior": bout["behavior"],
            "start_frame": int(bout["start_frame"]),
            "end_frame": int(bout["end_frame"]),
            "start_s": round(bout["start_s"], 1),
            "end_s": round(bout["end_s"], 1),
            "duration_s": dur_s,
            "mean_detection_conf": round(bout["conf_sum"] / frames, 2),
            "nearest_distance_mean_px": round(sum(nn_px) / len(nn_px), 1) if nn_px else 0.0,
            "nearest_distance_min_px": round(min(nn_px), 1) if nn_px else 0.0,
            "nearest_distance_max_px": round(max(nn_px), 1) if nn_px else 0.0,
            "nearest_distance_mean_body_lengths": round(sum(nn_bl) / len(nn_bl), 2) if nn_bl else 0.0,
            "nearest_distance_min_body_lengths": round(min(nn_bl), 2) if nn_bl else 0.0,
            "nearest_distance_max_body_lengths": round(max(nn_bl), 2) if nn_bl else 0.0,
        })

    @staticmethod
    def _calc_euclidean(p1: Tuple[int, int], p2: Tuple[int, int]) -> float:
        return math.hypot(p1[0] - p2[0], p1[1] - p2[1])

    @staticmethod
    def _box_distance(box1: List[int], box2: List[int]) -> float:
        """Minimum edge-to-edge distance between two bounding boxes (0 if intersecting)."""
        x1_min, y1_min, x1_max, y1_max = box1
        x2_min, y2_min, x2_max, y2_max = box2
        dx = max(0, max(x1_min, x2_min) - min(x1_max, x2_max))
        dy = max(0, max(y1_min, y2_min) - min(y1_max, y2_max))
        return math.hypot(dx, dy)

    def process_frame(self, frame_out: TrackerFrameOutput, dt: float):
        """
        Processes single-frame ByteTrack detections, spatial coordinates, and infrastructure interactions.
        dt: Delta time between processed frames in seconds.
        """
        if dt <= 0:
            dt = 1.0 / 15.0

        self.total_frames_in_chunk += 1
        self.current_chunk_elapsed_s += dt
        current_birds = frame_out.birds
        self.bird_frame_counts.append(len(current_birds))

        # -------------------------------------------------------------
        # Step 1: Update Kinematics & States for each Tracked Bird
        # -------------------------------------------------------------
        seen_track_ids = set()
        for bird in current_birds:
            tid = bird.track_id
            if tid is None:
                continue
            seen_track_ids.add(tid)

            if tid not in self.bird_states:
                self.bird_states[tid] = BirdTrackState(
                    track_id=tid,
                    label=bird.bird_label,
                    bird_type="rooster" if bird.class_name == "Rooster" else "hen",
                    last_centroid=bird.centroid,
                    last_timestamp_s=frame_out.timestamp_s
                )

            state = self.bird_states[tid]
            state.label = bird.bird_label

            # Accumulate frame-level observation validity & short-gap occlusion recovery
            if state.unobserved_streak_s > 0.0:
                if state.unobserved_streak_s <= 6.0:
                    state.occluded_s += state.unobserved_streak_s
                state.unobserved_streak_s = 0.0
            state.valid_observation_s += dt

            # Kinematic velocity calculation (displacement / dt)
            velocity = 0.0
            if state.last_centroid is not None:
                dist = self._calc_euclidean(bird.centroid, state.last_centroid)
                velocity = dist / dt
                state.total_displacement_px += dist
                state.recent_velocities.append(velocity)

            state.last_centroid = bird.centroid
            state.last_timestamp_s = frame_out.timestamp_s
            avg_vel = sum(state.recent_velocities) / len(state.recent_velocities) if state.recent_velocities else 0.0
            state.velocity_px_s = avg_vel
            state.instant_velocity_px_s = velocity

            # ---------------------------------------------------------
            # 1 & 2. Feeding & Drinking Zone Check (Mutually Exclusive + Motion/Posture Gated)
            # - Requires close box contact (<= 10px)
            # - Excludes birds walking past or actively leaving the feeder/drinker
            # - Excludes birds resting completely motionless (>= 6s) behind the feeder
            # ---------------------------------------------------------
            best_feeder = min(
                frame_out.feeders,
                key=lambda f: self._box_distance(bird.box, f.box),
                default=None,
            )
            best_drinker = min(
                frame_out.drinkers,
                key=lambda d: self._box_distance(bird.box, d.box),
                default=None,
            )
            feeder_dist = self._box_distance(bird.box, best_feeder.box) if best_feeder else float("inf")
            drinker_dist = self._box_distance(bird.box, best_drinker.box) if best_drinker else float("inf")

            feeder_center_dist = (
                self._calc_euclidean(bird.centroid, best_feeder.centroid) if best_feeder else None
            )
            drinker_center_dist = (
                self._calc_euclidean(bird.centroid, best_drinker.centroid) if best_drinker else None
            )

            # Detect walking past / moving away from feeder or drinker
            moving_away_feeder = (
                feeder_center_dist is not None
                and state.last_feeder_center_dist is not None
                and (feeder_center_dist - state.last_feeder_center_dist) / dt > 12.0
            )
            moving_away_drinker = (
                drinker_center_dist is not None
                and state.last_drinker_center_dist is not None
                and (drinker_center_dist - state.last_drinker_center_dist) / dt > 12.0
            )
            state.last_feeder_center_dist = feeder_center_dist
            state.last_drinker_center_dist = drinker_center_dist

            station_speed_ok = (velocity <= 35.0 and avg_vel <= 22.0)

            near_feeder = (
                feeder_dist <= self.cfg.feeder_zone_proximity_px
                and station_speed_ok
                and not (moving_away_feeder and feeder_dist > 0.0)
            )
            near_drinker = (
                drinker_dist <= self.cfg.waterer_zone_proximity_px
                and station_speed_ok
                and not (moving_away_drinker and drinker_dist > 0.0)
            )
            if near_feeder and near_drinker:
                if feeder_dist <= drinker_dist:
                    near_drinker = False
                else:
                    near_feeder = False

            # Track motionless nesting/resting near the feeder: after >=6s of <1.2 px/s
            # immobility, stop logging active Feeding bouts/HUD (switch live label to Inactive)
            # while keeping is_in_feeder_zone=True for reduced_feeding & isolation exclusion.
            if near_feeder and len(state.recent_velocities) >= 3 and avg_vel < 1.2:
                state.feeder_immobile_s += dt
            else:
                state.feeder_immobile_s = 0.0
            is_actively_feeding_now = near_feeder and state.feeder_immobile_s < 6.0

            if near_feeder:
                state.feeding_time_s += dt
                if not state.is_in_feeder_zone:
                    state.feeding_bouts += 1
                    state.is_in_feeder_zone = True

                # If motion is above threshold, active feeding occurs
                if avg_vel >= getattr(self.cfg, "reduced_feeding_motion_threshold_px_s", 3.5):
                    state.active_feeding_time_s += dt
                    state.feeder_stationary_time_s = 0.0
                else:
                    # Low motion near feeder: lingering idle without active food intake
                    state.feeder_stationary_time_s += dt
                    idle_limit = getattr(self.cfg, "reduced_feeding_idle_seconds", 10.0)
                    if state.feeder_stationary_time_s >= idle_limit:
                        state.reduced_feeding_events += 1
                        state.feeder_stationary_time_s = 0.0
            else:
                state.is_in_feeder_zone = False
                state.feeder_stationary_time_s = 0.0

            if near_drinker:
                state.drinking_time_s += dt
                state.time_since_last_drinking_s = 0.0
                if not state.is_in_waterer_zone:
                    state.drinking_bouts += 1
                    state.is_in_waterer_zone = True

                # Detect active vs idle drinker interaction
                if 1.0 <= avg_vel <= 15.0:
                    state.active_drinking_time_s += dt
                    state.drinker_stationary_time_s = 0.0
                else:
                    # Hovering near drinker without active water consumption
                    state.drinker_stationary_time_s += dt
                    idle_drinker_limit = getattr(self.cfg, "reduced_drinking_idle_seconds", 8.0)
                    if state.drinker_stationary_time_s >= idle_drinker_limit:
                        state.reduced_drinking_events += 1
                        state.drinker_stationary_time_s = 0.0
            else:
                state.is_in_waterer_zone = False
                state.drinker_stationary_time_s = 0.0
                state.time_since_last_drinking_s += dt
                # If bird has had no drinker visit for extended duration (>600s), flag drinking deficit
                deficit_limit = getattr(self.cfg, "drinker_visit_deficit_seconds", 600.0)
                if state.time_since_last_drinking_s >= deficit_limit:
                    state.reduced_drinking_events += 1
                    state.time_since_last_drinking_s = 0.0

            # ---------------------------------------------------------
            # 3. Prolonged Low Activity Tracking
            # Require >=2 velocity samples so a bird's very first frame
            # (before any displacement is measured) doesn't log fake 0.1s inactivity.
            # ---------------------------------------------------------
            low_act_thresh = getattr(self.cfg, "low_activity_velocity_threshold_px_s", 3.0)
            if len(state.recent_velocities) >= 2 and avg_vel < low_act_thresh:
                state.continuous_stationary_s += dt
                state.total_inactivity_s += dt
                sustained_limit = getattr(self.cfg, "prolonged_low_activity_duration_s", 60.0)
                if state.continuous_stationary_s >= sustained_limit:
                    state.prolonged_low_activity_events += 1
                    state.is_lethargic_flag = True
                    state.continuous_stationary_s = 0.0
            else:
                state.continuous_stationary_s = 0.0

        # Track unobserved streaks for previously registered birds absent in the current frame
        for tid_prev, st_prev in self.bird_states.items():
            if tid_prev not in seen_track_ids:
                st_prev.unobserved_streak_s += dt
                # Close any open behavior bouts if the bird disappears for >1.5s
                if st_prev.unobserved_streak_s > 1.5:
                    for beh_name in ("feeding", "drinking", "inactive", "social_isolation"):
                        b = self._active_bouts.pop((tid_prev, beh_name), None)
                        if b is not None:
                            self._finalize_bout(b)

        # -------------------------------------------------------------
        # Step 2: 4. Social Isolation Tracking (Inter-Bird Spatial Dispersion)
        # -------------------------------------------------------------
        n_birds = len(current_birds)
        nn_dist_by_tid: Dict[int, float] = {}
        median_body_px = 55.0
        isolated_tids: set = set()
        if n_birds >= 2:
            isolation_dist_thresh = getattr(self.cfg, "social_isolation_distance_px", 220.0)
            isolation_body_lengths = getattr(self.cfg, "social_isolation_body_lengths", 3.5)
            isolation_ratio = getattr(self.cfg, "social_isolation_relative_ratio", 1.5)
            iso_duration = getattr(self.cfg, "social_isolation_duration_s", 60.0)

            # Scale distance threshold to observed bird size so higher-res videos stay calibrated
            body_sizes = sorted(
                max(abs(b.box[2] - b.box[0]), abs(b.box[3] - b.box[1]))
                for b in current_birds
                if b.track_id is not None and len(b.box) == 4
            )
            median_body_px = body_sizes[len(body_sizes) // 2] if body_sizes else 55.0
            effective_dist_thresh = max(isolation_dist_thresh, median_body_px * isolation_body_lengths)

            # Precompute nearest-neighbor distance for every visible bird
            nn_dists: List[float] = []
            for i, bird_a in enumerate(current_birds):
                nn_d = min(
                    (self._calc_euclidean(bird_a.centroid, bird_b.centroid)
                     for j, bird_b in enumerate(current_birds) if i != j),
                    default=0.0,
                )
                nn_dists.append(nn_d)
                if bird_a.track_id is not None:
                    nn_dist_by_tid[bird_a.track_id] = nn_d
            sorted_nn = sorted(nn_dists)
            median_nn_dist = sorted_nn[len(sorted_nn) // 2] if sorted_nn else 0.0

            for i, bird_a in enumerate(current_birds):
                tid_a = bird_a.track_id
                if tid_a is None or tid_a not in self.bird_states:
                    continue
                state_a = self.bird_states[tid_a]

                # Solo feeding or drinking at a resource station is normal behavior, not social isolation
                if state_a.is_in_feeder_zone or state_a.is_in_waterer_zone:
                    state_a.continuous_isolation_s = 0.0
                    state_a.in_isolation_bout = False
                    continue

                min_neighbor_dist = nn_dists[i]

                # Isolated when far from nearest flock mate AND significantly more distant than the flock's typical spacing
                far_from_nearest = min_neighbor_dist > effective_dist_thresh
                separated_from_cluster = (
                    n_birds < 3
                    or (median_nn_dist > 0 and min_neighbor_dist > isolation_ratio * median_nn_dist)
                    or min_neighbor_dist > 1.35 * effective_dist_thresh
                )

                if far_from_nearest and separated_from_cluster:
                    isolated_tids.add(tid_a)
                    state_a.continuous_isolation_s += dt
                    state_a.total_isolation_s += dt
                    if state_a.continuous_isolation_s >= iso_duration and not state_a.in_isolation_bout:
                        state_a.social_isolation_events += 1
                        state_a.in_isolation_bout = True
                        state_a.is_isolated_flag = True
                else:
                    state_a.continuous_isolation_s = 0.0
                    state_a.in_isolation_bout = False

        # -------------------------------------------------------------
        # Step 2b: Record Exact Frame-by-Frame Bouts & Detection Tracking
        # -------------------------------------------------------------
        low_act_thresh = getattr(self.cfg, "low_activity_velocity_threshold_px_s", 3.0)
        body_scale = max(20.0, float(median_body_px))
        # Record detection_tracking every processed frame up to 3,500 rows (sub-sampled to every 5th frame after 1,500 rows)
        record_det_frame = (
            len(self._detection_tracking_rows) < 1500
            or (len(self._detection_tracking_rows) < 3500 and self.total_frames_in_chunk % 5 == 0)
        )
        for bird in current_birds:
            tid = bird.track_id
            if tid is None or tid not in self.bird_states:
                continue
            st = self.bird_states[tid]
            nn_px = nn_dist_by_tid.get(tid, 0.0)
            nn_bl = nn_px / body_scale if nn_px > 0 else 0.0
            conf = float(getattr(bird, "confidence", 0.0) or 0.0)
            is_actively_feeding = st.is_in_feeder_zone and st.feeder_immobile_s < 6.0
            is_inactive_now = (
                not is_actively_feeding
                and not st.is_in_waterer_zone
                and len(st.recent_velocities) >= 2
                and st.velocity_px_s < low_act_thresh
            )

            # Update live behavior label for video overlay (replaces confidence badge)
            if is_actively_feeding:
                st.current_behavior = "Feeding"
            elif st.is_in_waterer_zone:
                st.current_behavior = "Drinking"
            elif tid in isolated_tids:
                st.current_behavior = "Isolated"
            elif is_inactive_now:
                st.current_behavior = "Inactive"
            else:
                st.current_behavior = "Active"

            self._update_bout(tid, st.label, "feeding", is_actively_feeding, frame_out.frame_idx, self.current_chunk_elapsed_s, dt, conf, nn_px, nn_bl)
            self._update_bout(tid, st.label, "drinking", st.is_in_waterer_zone, frame_out.frame_idx, self.current_chunk_elapsed_s, dt, conf, nn_px, nn_bl)
            self._update_bout(tid, st.label, "inactive", is_inactive_now, frame_out.frame_idx, self.current_chunk_elapsed_s, dt, conf, nn_px, nn_bl)
            self._update_bout(tid, st.label, "social_isolation", tid in isolated_tids, frame_out.frame_idx, self.current_chunk_elapsed_s, dt, conf, nn_px, nn_bl)

            if record_det_frame and len(self._detection_tracking_rows) < 3500:
                x1, y1, x2, y2 = bird.box
                self._detection_tracking_rows.append({
                    "frame_number": int(frame_out.frame_idx),
                    "elapsed_s": round(self.current_chunk_elapsed_s, 2),
                    "track_id": int(tid),
                    "bird_label": st.label,
                    "x_center_px": round((x1 + x2) / 2.0, 1),
                    "y_center_px": round((y1 + y2) / 2.0, 1),
                    "bbox_width_px": int(max(1, x2 - x1)),
                    "bbox_height_px": int(max(1, y2 - y1)),
                    "detection_confidence": round(conf, 2),
                    "visibility_status": "visible",
                    "in_feeder_zone": bool(st.is_in_feeder_zone),
                    "in_waterer_zone": bool(st.is_in_waterer_zone),
                    "nearest_neighbor_distance_px": round(nn_px, 1),
                    "nearest_neighbor_distance_body_lengths": round(nn_bl, 2),
                    "visible_chicken_count": int(n_birds),
                })

        if n_birds >= 2:

            # ---------------------------------------------------------
            # Step 3: Feather Pecking Interaction Check (Legacy Compatibility)
            # ---------------------------------------------------------
            for i in range(n_birds):
                bird_a = current_birds[i]
                tid_a = bird_a.track_id
                if tid_a is None or tid_a not in self.bird_states:
                    continue
                state_a = self.bird_states[tid_a]

                if state_a.instant_velocity_px_s >= self.cfg.feather_pecking_approach_speed_px_s:
                    for j in range(n_birds):
                        if i == j:
                            continue
                        bird_b = current_birds[j]
                        tid_b = bird_b.track_id
                        if tid_b is None or tid_b not in self.bird_states:
                            continue
                        state_b = self.bird_states[tid_b]

                        pair_key = (min(tid_a, tid_b), max(tid_a, tid_b))
                        last_peck_time = self.pecking_cooldowns.get(pair_key, -999.0)
                        if self.current_chunk_elapsed_s - last_peck_time < 2.5:
                            continue

                        dist = self._calc_euclidean(bird_a.centroid, bird_b.centroid)
                        if dist <= self.cfg.feather_pecking_proximity_px:
                            if state_b.instant_velocity_px_s >= self.cfg.feather_pecking_escape_speed_px_s:
                                self.feather_pecking_events += 1
                                state_a.pecking_aggressor_count += 1
                                state_b.pecking_victim_count += 1
                                self.pecking_cooldowns[pair_key] = self.current_chunk_elapsed_s

    def compute_chunk_summary(self) -> BehaviorChunkSummary:
        """
        Synthesizes all tracking states into the 30-minute behavior metrics record.
        """
        unique_birds = len(self.bird_states)
        avg_present = sum(self.bird_frame_counts) / max(1, len(self.bird_frame_counts))

        # Overall flock mobility
        all_velocities = [
            s.velocity_px_s for s in self.bird_states.values() if s.velocity_px_s > 0
        ]
        flock_mobility = sum(all_velocities) / max(1, len(all_velocities))

        # 1. Reduced Feeding Behavior
        feeding_time_total = sum(s.feeding_time_s for s in self.bird_states.values())
        feeding_bouts = sum(s.feeding_bouts for s in self.bird_states.values())
        total_reduced_feeding = sum(s.reduced_feeding_events for s in self.bird_states.values())
        reduced_eating_index = (
            total_reduced_feeding / max(1, feeding_bouts) if feeding_bouts > 0 else 0.0
        )
        reduced_eating_index = min(1.0, round(reduced_eating_index, 3))

        # 2. Reduced Drinking Behavior
        drinking_time_total = sum(s.drinking_time_s for s in self.bird_states.values())
        drinking_bouts = sum(s.drinking_bouts for s in self.bird_states.values())
        drinker_freq = drinking_bouts / max(1, unique_birds)
        total_reduced_drinking = sum(s.reduced_drinking_events for s in self.bird_states.values())

        # 3. Prolonged Low Activity
        inactivity_total = sum(s.total_inactivity_s for s in self.bird_states.values())
        total_monitored_bird_time = max(1.0, self.current_chunk_elapsed_s * max(1, unique_birds))
        inactivity_pct = min(100.0, (inactivity_total / total_monitored_bird_time) * 100.0)
        total_prolonged_low_activity = sum(s.prolonged_low_activity_events for s in self.bird_states.values())
        lethargic_count = sum(1 for s in self.bird_states.values() if s.is_lethargic_flag or s.prolonged_low_activity_events > 0)

        # 4. Social Isolation
        total_social_isolation = sum(s.social_isolation_events for s in self.bird_states.values())
        agitation_score = round(self.feather_pecking_events / max(1, unique_birds), 2)

        # Per-bird breakdown records with the 4 exact behaviors and ethology thresholds
        monitored_s = max(1.0, self.current_chunk_elapsed_s)
        feed_thresh = getattr(self.cfg, "feeding_activity_threshold_pct", 0.3)
        drink_thresh = getattr(self.cfg, "drinking_activity_threshold_pct", 0.2)
        iso_thresh = getattr(self.cfg, "social_isolation_threshold_pct", 29.5)
        loco_thresh = getattr(self.cfg, "reduced_locomotor_threshold_pct", 78.0)

        bird_records = []
        window_dur_s = max(1, round(monitored_s))
        for s in self.bird_states.values():
            bird_obs_s = s.valid_observation_s if s.valid_observation_s > 0.0 else monitored_s
            feeding_pct = round(min(100.0, (s.feeding_time_s / bird_obs_s) * 100.0), 2)
            drinking_pct = round(min(100.0, (s.drinking_time_s / bird_obs_s) * 100.0), 2)
            isolation_pct = round(min(100.0, (s.total_isolation_s / bird_obs_s) * 100.0), 2)
            locomotor_inactivity_pct = round(min(100.0, (s.total_inactivity_s / bird_obs_s) * 100.0), 2)

            valid_obs_s = min(window_dur_s, max(0, round(s.valid_observation_s)))
            occl_s = min(max(0, window_dur_s - valid_obs_s), max(0, round(s.occluded_s)))
            lost_s = max(0, window_dur_s - valid_obs_s - occl_s)
            valid_obs_pct = round((valid_obs_s / window_dur_s) * 100.0, 1)

            flag_reduced_feeding = 1 if (s.reduced_feeding_events > 0 or feeding_pct <= feed_thresh) else 0
            flag_reduced_drinking = 1 if (s.reduced_drinking_events > 0 or drinking_pct <= drink_thresh) else 0
            flag_social_isolation = 1 if isolation_pct > iso_thresh else 0
            flag_reduced_locomotor = 1 if (s.is_lethargic_flag or s.prolonged_low_activity_events > 0 or locomotor_inactivity_pct > loco_thresh) else 0

            bird_records.append({
                "track_id": s.track_id,
                "bird_label": s.label,
                "bird_type": s.bird_type,
                "window_duration_s": window_dur_s,
                "valid_observation_duration_s": valid_obs_s,
                "occluded_duration_s": occl_s,
                "lost_duration_s": lost_s,
                "valid_observation_pct": valid_obs_pct,
                # 1. Feeding Activity (Threshold: At or below 0.3%)
                "feeding_activity_pct": feeding_pct,
                "reduced_feeding_events": s.reduced_feeding_events,
                "reduced_feeding_flag": flag_reduced_feeding,
                "feeding_s": round(s.feeding_time_s, 1),
                "feeding_bouts": s.feeding_bouts,
                # 2. Drinking Activity (Threshold: At or below 0.2%)
                "drinking_activity_pct": drinking_pct,
                "reduced_drinking_events": s.reduced_drinking_events,
                "reduced_drinking_flag": flag_reduced_drinking,
                "drinking_s": round(s.drinking_time_s, 1),
                "drinking_bouts": s.drinking_bouts,
                # 3. Social Isolation (Threshold: Above 29.5%)
                "social_isolation_pct": isolation_pct,
                "social_isolation_events": s.social_isolation_events,
                "is_socially_isolated": flag_social_isolation,
                "isolation_s": round(s.total_isolation_s, 1),
                # 4. Reduced Locomotor Activity (Threshold: Above 78%)
                "reduced_locomotor_pct": locomotor_inactivity_pct,
                "reduced_locomotor_events": s.prolonged_low_activity_events,
                "is_reduced_locomotor": flag_reduced_locomotor,
                "prolonged_low_activity_events": s.prolonged_low_activity_events,
                "is_prolonged_low_activity": flag_reduced_locomotor,
                "inactivity_s": round(s.total_inactivity_s, 1),
                "is_lethargic": flag_reduced_locomotor,
                # Legacy DB column carries pure social_isolation_events (no legacy pecking fallback)
                "reduced_eating_flag": flag_reduced_feeding,
                "pecking_aggressor_count": s.social_isolation_events,
                "pecking_victim_count": 0,
                "avg_velocity_px_s": round(s.velocity_px_s, 2),
            })

        # Flush any still-open behavior bouts at chunk end
        for bout in list(self._active_bouts.values()):
            self._finalize_bout(bout)
        self._active_bouts.clear()

        return BehaviorChunkSummary(
            unique_birds=unique_birds,
            avg_birds_present=round(avg_present, 1),
            flock_mobility_px_s=round(flock_mobility, 2),
            # 1. Reduced Feeding Behavior
            feeding_time_total_s=round(feeding_time_total, 1),
            feeding_bouts=feeding_bouts,
            reduced_feeding_events=total_reduced_feeding,
            reduced_eating_events=total_reduced_feeding,
            reduced_eating_index=reduced_eating_index,
            # 2. Reduced Drinking Behavior
            drinking_time_total_s=round(drinking_time_total, 1),
            drinking_bouts=drinking_bouts,
            drinking_frequency_per_bird=round(drinker_freq, 2),
            reduced_drinking_events=total_reduced_drinking,
            # 3. Prolonged Low Activity
            inactivity_time_total_s=round(inactivity_total, 1),
            inactivity_pct=round(inactivity_pct, 1),
            prolonged_low_activity_events=total_prolonged_low_activity,
            lethargic_birds_flagged=lethargic_count,
            # 4. Social Isolation
            social_isolation_events=total_social_isolation,
            feather_pecking_events=self.feather_pecking_events,
            agitation_score=agitation_score,
            bird_records=bird_records,
            behavior_events=sorted(self._completed_bouts, key=lambda e: (e["start_frame"], e["track_id"])),
            detection_tracking=list(self._detection_tracking_rows),
        )