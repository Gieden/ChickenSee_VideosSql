"""
edge/behavior.py - Poultry Behavior Tracking & Spatial Analysis Engine.
Accurately detects and tracks the 4 primary poultry stress behaviors:
  1. Reduced feeding behavior
  2. Reduced drinking behavior
  3. Prolonged low activity
  4. Social isolation
"""

import math
import time
from typing import List, Dict, Optional, Tuple, Any
from dataclasses import dataclass, field
from collections import deque

from .config import CONFIG, BehaviorConfig
from .detector import Detection, FrameInferenceResult


@dataclass
class BirdBehaviorState:
    track_id: int
    label: str
    bird_type: str                   # "hen" | "rooster"
    current_behavior: str = "Prolonged low activity" # "Reduced feeding behavior", "Reduced drinking behavior", "Prolonged low activity", "Social isolation", "Normal active"
    behavior_confidence: float = 0.8
    
    # Cumulative time in seconds
    feeding_sec: float = 0.0
    drinking_sec: float = 0.0
    active_sec: float = 0.0
    resting_sec: float = 0.0
    agitated_sec: float = 0.0
    isolation_sec: float = 0.0
    
    # 4 Primary Behaviors Counts & Timers
    reduced_feeding_events: int = 0
    reduced_drinking_events: int = 0
    prolonged_low_activity_events: int = 0
    social_isolation_events: int = 0

    # Discrete bouts (visits)
    feeding_bouts: int = 0
    drinking_bouts: int = 0
    
    # Kinematics
    velocity_px_s: float = 0.0
    total_distance_px: float = 0.0
    last_centroid: Optional[Tuple[int, int]] = None
    last_timestamp: float = 0.0
    first_seen_timestamp: float = 0.0
    recent_velocities: deque = field(default_factory=lambda: deque(maxlen=15))
    
    # Inactivity / Continuous tracking timers
    continuous_inactivity_sec: float = 0.0
    feeder_idle_sec: float = 0.0
    drinker_idle_sec: float = 0.0
    time_since_drinking_sec: float = 0.0
    continuous_isolation_sec: float = 0.0
    is_lethargic_alert: bool = False


@dataclass
class FrameBehaviorSummary:
    timestamp: float
    birds_count: int
    # 4 Primary behaviors count in frame
    reduced_feeding_count: int = 0
    reduced_drinking_count: int = 0
    prolonged_low_activity_count: int = 0
    social_isolation_count: int = 0
    # Legacy counts
    feeding_count: int = 0
    drinking_count: int = 0
    active_count: int = 0
    resting_count: int = 0
    agitated_count: int = 0
    flock_clustering_index: float = 0.0  # Normalized flock spatial density
    per_bird_behaviors: Dict[int, str] = field(default_factory=dict) # track_id -> behavior name


class BehaviorAnalyzer:
    """
    Real-time spatial proximity & kinematic behavior analyzer.
    Tracks individual bird activity budgets across video streams with precise detection of:
      1. Reduced feeding behavior
      2. Reduced drinking behavior
      3. Prolonged low activity
      4. Social isolation
    """

    def __init__(self, behavior_config: Optional[BehaviorConfig] = None):
        self.cfg = behavior_config or CONFIG.behavior
        self.bird_states: Dict[int, BirdBehaviorState] = {}
        self._last_frame_time: Optional[float] = None
        self.max_inactive_duration_s = 600.0  # 10 minutes without sight before state prune

    def _calc_distance(self, p1: Tuple[int, int], p2: Tuple[int, int]) -> float:
        return math.hypot(p1[0] - p2[0], p1[1] - p2[1])

    def _box_distance(self, box1: List[int], box2: List[int]) -> float:
        """Calculate minimum Euclidean distance between two 2D bounding boxes."""
        x1_min, y1_min, x1_max, y1_max = box1
        x2_min, y2_min, x2_max, y2_max = box2
        dx = max(0, max(x1_min, x2_min) - min(x1_max, x2_max))
        dy = max(0, max(y1_min, y2_min) - min(y1_max, y2_max))
        return math.hypot(dx, dy)

    def analyze_frame(
        self, 
        inference_result: FrameInferenceResult, 
        current_time: Optional[float] = None
    ) -> FrameBehaviorSummary:
        """
        Analyzes bird detections against infrastructure, flock dispersion, and kinematics.
        """
        t_now = current_time or inference_result.timestamp
        dt = (t_now - self._last_frame_time) if self._last_frame_time is not None else (1.0 / 15.0)
        dt = max(0.001, min(1.0, dt))
        self._last_frame_time = t_now

        feeders = [d for d in inference_result.infrastructure if d.label == "Feeder"]
        drinkers = [d for d in inference_result.infrastructure if d.label == "Drinker"]

        frame_summary = FrameBehaviorSummary(
            timestamp=t_now,
            birds_count=len(inference_result.birds)
        )

        active_track_ids = set()

        # Precompute inter-bird distances for Social Isolation
        centroids = [b.centroid for b in inference_result.birds if b.track_id is not None]
        median_dist = 100.0
        if len(centroids) >= 2:
            pair_dists = []
            for i in range(len(centroids)):
                for j in range(i + 1, len(centroids)):
                    pair_dists.append(self._calc_distance(centroids[i], centroids[j]))
            if pair_dists:
                median_dist = sorted(pair_dists)[len(pair_dists) // 2]
                mean_dist = sum(pair_dists) / len(pair_dists)
                frame_summary.flock_clustering_index = round(1000.0 / (mean_dist + 10.0), 2)

        for i, bird in enumerate(inference_result.birds):
            tid = bird.track_id
            if tid is None:
                continue

            active_track_ids.add(tid)

            if tid not in self.bird_states:
                self.bird_states[tid] = BirdBehaviorState(
                    track_id=tid,
                    label=bird.label,
                    bird_type=bird.type,
                    first_seen_timestamp=t_now,
                    last_timestamp=t_now,
                    last_centroid=bird.centroid
                )

            state = self.bird_states[tid]
            state.label = bird.label
            state.bird_type = bird.type

            # -------------------------------------------------------------
            # Kinematics
            # -------------------------------------------------------------
            velocity = 0.0
            if state.last_centroid is not None:
                dist = self._calc_distance(bird.centroid, state.last_centroid)
                velocity = dist / dt
                state.total_distance_px += dist
                state.recent_velocities.append(velocity)

            state.last_centroid = bird.centroid
            state.last_timestamp = t_now
            avg_velocity = sum(state.recent_velocities) / len(state.recent_velocities) if state.recent_velocities else 0.0
            state.velocity_px_s = avg_velocity

            # -------------------------------------------------------------
            # 1. Reduced Feeding Behavior Analysis
            # -------------------------------------------------------------
            near_feeder = False
            for f in feeders:
                d_feeder = self._box_distance(bird.box, f.box)
                if d_feeder <= self.cfg.feeder_proximity_px:
                    near_feeder = True
                    break

            is_reduced_feeding = False
            if near_feeder:
                state.feeding_sec += dt
                if avg_velocity < 3.5:
                    state.feeder_idle_sec += dt
                    if state.feeder_idle_sec >= 10.0:
                        is_reduced_feeding = True
                        state.reduced_feeding_events += 1
                        state.feeder_idle_sec = 0.0
                else:
                    state.feeder_idle_sec = 0.0
                    state.feeding_bouts += 1
            else:
                state.feeder_idle_sec = 0.0

            # -------------------------------------------------------------
            # 2. Reduced Drinking Behavior Analysis
            # -------------------------------------------------------------
            near_drinker = False
            for d in drinkers:
                d_drinker = self._box_distance(bird.box, d.box)
                if d_drinker <= self.cfg.drinker_proximity_px:
                    near_drinker = True
                    break

            is_reduced_drinking = False
            if near_drinker:
                state.drinking_sec += dt
                state.time_since_drinking_sec = 0.0
                if avg_velocity < 2.0:
                    state.drinker_idle_sec += dt
                    if state.drinker_idle_sec >= 8.0:
                        is_reduced_drinking = True
                        state.reduced_drinking_events += 1
                        state.drinker_idle_sec = 0.0
                else:
                    state.drinker_idle_sec = 0.0
                    state.drinking_bouts += 1
            else:
                state.drinker_idle_sec = 0.0
                state.time_since_drinking_sec += dt
                if state.time_since_drinking_sec >= 600.0:
                    is_reduced_drinking = True
                    state.reduced_drinking_events += 1
                    state.time_since_drinking_sec = 0.0

            # -------------------------------------------------------------
            # 3. Prolonged Low Activity Analysis
            # -------------------------------------------------------------
            is_prolonged_low_activity = False
            if avg_velocity < self.cfg.resting_velocity_px_s:
                state.resting_sec += dt
                state.continuous_inactivity_sec += dt
                if state.continuous_inactivity_sec >= 60.0:
                    is_prolonged_low_activity = True
                    state.prolonged_low_activity_events += 1
                    state.continuous_inactivity_sec = 0.0
                if state.continuous_inactivity_sec > 600.0:
                    state.is_lethargic_alert = True
            else:
                state.active_sec += dt
                state.continuous_inactivity_sec = 0.0

            # -------------------------------------------------------------
            # 4. Social Isolation Analysis
            # -------------------------------------------------------------
            is_social_isolation = False
            if len(inference_result.birds) >= 2:
                nearest_dist = min(
                    (self._calc_distance(bird.centroid, ob.centroid)
                     for j, ob in enumerate(inference_result.birds) if i != j),
                    default=0.0
                )
                if nearest_dist > 180.0 or (median_dist > 0 and nearest_dist > 2.2 * median_dist):
                    state.continuous_isolation_sec += dt
                    state.isolation_sec += dt
                    if state.continuous_isolation_sec >= 10.0:
                        is_social_isolation = True
                        state.social_isolation_events += 1
                        state.continuous_isolation_sec = 0.0
                else:
                    state.continuous_isolation_sec = 0.0

            # -------------------------------------------------------------
            # Determine Dominant Active Behavior for this frame
            # -------------------------------------------------------------
            if is_reduced_feeding:
                behavior_label = "Reduced feeding behavior"
                frame_summary.reduced_feeding_count += 1
            elif is_reduced_drinking:
                behavior_label = "Reduced drinking behavior"
                frame_summary.reduced_drinking_count += 1
            elif is_social_isolation:
                behavior_label = "Social isolation"
                frame_summary.social_isolation_count += 1
            elif is_prolonged_low_activity or state.continuous_inactivity_sec >= 30.0:
                behavior_label = "Prolonged low activity"
                frame_summary.prolonged_low_activity_count += 1
            elif near_feeder:
                behavior_label = "Feeding"
                frame_summary.feeding_count += 1
            elif near_drinker:
                behavior_label = "Drinking"
                frame_summary.drinking_count += 1
            elif avg_velocity >= self.cfg.agitated_velocity_px_s:
                behavior_label = "Agitated"
                frame_summary.agitated_count += 1
            else:
                behavior_label = "Active"
                frame_summary.active_count += 1

            state.current_behavior = behavior_label
            frame_summary.per_bird_behaviors[tid] = behavior_label

        # Prune stale bird states
        self._prune_stale_tracks(t_now)

        return frame_summary

    def _prune_stale_tracks(self, current_time: float):
        cutoff = current_time - self.max_inactive_duration_s
        stale_tids = [tid for tid, s in self.bird_states.items() if s.last_timestamp < cutoff]
        for tid in stale_tids:
            self.bird_states.pop(tid, None)

    def get_all_bird_profiles(self) -> List[BirdBehaviorState]:
        return list(self.bird_states.values())
