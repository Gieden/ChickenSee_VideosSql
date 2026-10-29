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

    # Legacy interaction counts (preserved for backward compatibility)
    pecking_aggressor_count: int = 0
    pecking_victim_count: int = 0


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

    def reset_chunk(self):
        """Resets tracking accumulators for a new 30-minute interval."""
        self.bird_states.clear()
        self.feather_pecking_events = 0
        self.total_frames_in_chunk = 0
        self.bird_frame_counts.clear()
        self.pecking_cooldowns.clear()
        self.current_chunk_elapsed_s = 0.0

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
        for bird in current_birds:
            tid = bird.track_id
            if tid is None:
                continue

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
            # 1. Reduced Feeding Behavior Tracking
            # ---------------------------------------------------------
            near_feeder = False
            for feeder in frame_out.feeders:
                d = self._box_distance(bird.box, feeder.box)
                if d <= self.cfg.feeder_zone_proximity_px:
                    near_feeder = True
                    break

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

            # ---------------------------------------------------------
            # 2. Reduced Drinking Behavior Tracking
            # ---------------------------------------------------------
            near_drinker = False
            for drinker in frame_out.drinkers:
                d = self._box_distance(bird.box, drinker.box)
                if d <= self.cfg.waterer_zone_proximity_px:
                    near_drinker = True
                    break

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
            # ---------------------------------------------------------
            low_act_thresh = getattr(self.cfg, "low_activity_velocity_threshold_px_s", 3.0)
            if avg_vel < low_act_thresh:
                state.continuous_stationary_s += dt
                state.total_inactivity_s += dt
                sustained_limit = getattr(self.cfg, "prolonged_low_activity_duration_s", 60.0)
                if state.continuous_stationary_s >= sustained_limit:
                    state.prolonged_low_activity_events += 1
                    state.is_lethargic_flag = True
                    state.continuous_stationary_s = 0.0
            else:
                state.continuous_stationary_s = 0.0

        # -------------------------------------------------------------
        # Step 2: 4. Social Isolation Tracking (Inter-Bird Spatial Dispersion)
        # -------------------------------------------------------------
        n_birds = len(current_birds)
        if n_birds >= 2:
            centroids = [b.centroid for b in current_birds if b.track_id is not None]
            pair_dists = []
            for i in range(len(centroids)):
                for j in range(i + 1, len(centroids)):
                    pair_dists.append(self._calc_euclidean(centroids[i], centroids[j]))
            median_dist = sorted(pair_dists)[len(pair_dists) // 2] if pair_dists else 100.0

            isolation_dist_thresh = getattr(self.cfg, "social_isolation_distance_px", 180.0)
            isolation_ratio = getattr(self.cfg, "social_isolation_relative_ratio", 2.2)

            for i, bird_a in enumerate(current_birds):
                tid_a = bird_a.track_id
                if tid_a is None or tid_a not in self.bird_states:
                    continue
                state_a = self.bird_states[tid_a]

                # Find nearest neighbor distance
                min_neighbor_dist = min(
                    (self._calc_euclidean(bird_a.centroid, bird_b.centroid)
                     for j, bird_b in enumerate(current_birds) if i != j),
                    default=0.0
                )

                # Isolated if nearest flock mate is beyond threshold or relative ratio
                if min_neighbor_dist > isolation_dist_thresh or (median_dist > 0 and min_neighbor_dist > isolation_ratio * median_dist):
                    state_a.continuous_isolation_s += dt
                    state_a.total_isolation_s += dt
                    iso_duration = getattr(self.cfg, "social_isolation_duration_s", 10.0)
                    if state_a.continuous_isolation_s >= iso_duration:
                        state_a.social_isolation_events += 1
                        state_a.is_isolated_flag = True
                        state_a.continuous_isolation_s = 0.0
                else:
                    state_a.continuous_isolation_s = 0.0

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
        total_monitored_bird_time = max(1.0, self.total_frames_in_chunk * (1.0 / 15.0) * unique_birds)
        inactivity_pct = min(100.0, (inactivity_total / total_monitored_bird_time) * 100.0)
        total_prolonged_low_activity = sum(s.prolonged_low_activity_events for s in self.bird_states.values())
        lethargic_count = sum(1 for s in self.bird_states.values() if s.is_lethargic_flag or s.prolonged_low_activity_events > 0)

        # 4. Social Isolation
        total_social_isolation = sum(s.social_isolation_events for s in self.bird_states.values())
        agitation_score = round(self.feather_pecking_events / max(1, unique_birds), 2)

        # Per-bird breakdown records with the 4 exact behaviors
        bird_records = []
        for s in self.bird_states.values():
            bird_records.append({
                "track_id": s.track_id,
                "bird_label": s.label,
                "bird_type": s.bird_type,
                # 1. Reduced feeding behavior
                "reduced_feeding_events": s.reduced_feeding_events,
                "reduced_feeding_flag": 1 if s.reduced_feeding_events > 0 else 0,
                "feeding_s": round(s.feeding_time_s, 1),
                "feeding_bouts": s.feeding_bouts,
                # 2. Reduced drinking behavior
                "reduced_drinking_events": s.reduced_drinking_events,
                "reduced_drinking_flag": 1 if s.reduced_drinking_events > 0 else 0,
                "drinking_s": round(s.drinking_time_s, 1),
                "drinking_bouts": s.drinking_bouts,
                # 3. Prolonged low activity
                "prolonged_low_activity_events": s.prolonged_low_activity_events,
                "is_prolonged_low_activity": 1 if s.prolonged_low_activity_events > 0 else 0,
                "inactivity_s": round(s.total_inactivity_s, 1),
                "is_lethargic": 1 if (s.is_lethargic_flag or s.prolonged_low_activity_events > 0) else 0,
                # 4. Social isolation
                "social_isolation_events": s.social_isolation_events,
                "is_socially_isolated": 1 if (s.is_isolated_flag or s.social_isolation_events > 0) else 0,
                "isolation_s": round(s.total_isolation_s, 1),
                # Legacy compatibility aliases
                "reduced_eating_flag": 1 if s.reduced_feeding_events > 0 else 0,
                "pecking_aggressor_count": s.social_isolation_events if s.social_isolation_events > 0 else s.pecking_aggressor_count,
                "pecking_victim_count": s.pecking_victim_count,
                "avg_velocity_px_s": round(s.velocity_px_s, 2),
            })

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
            bird_records=bird_records
        )