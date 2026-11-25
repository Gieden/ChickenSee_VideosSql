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
    head_feeder_grace_s: float = 0.0
    head_drinker_grace_s: float = 0.0
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
    identity_transfers: List[Dict[str, Any]] = field(default_factory=list)


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
        # Per-episode live spatial handoff tracking (prevents reusable ID7+ slots from mixing birds)
        self._last_designated_pos: Dict[int, Tuple[float, float, int, str]] = {}
        self._unid_episode_meta: Dict[int, Dict[str, Any]] = {}
        self._identity_transfers: List[Dict[str, Any]] = []

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
        self._last_designated_pos.clear()
        self._unid_episode_meta.clear()
        self._identity_transfers.clear()

    @staticmethod
    def _is_designated_label(label: Optional[str]) -> bool:
        lbl = (label or "").strip().lower()
        return bool(lbl) and lbl != "chicken" and "unidentified" not in lbl

    def _transfer_unid_episode(
        self,
        unid_tid: int,
        target_tid: int,
        target_label: str,
        start_frame: int,
        end_frame: Optional[int] = None,
        reason: str = "spatial_handoff",
    ) -> None:
        """
        Transfers ONLY the current live episode of an unidentified track slot (ID7+)
        into the exact designated bird (H1–H5 / R1), records an explicit audit entry
        in self._identity_transfers, and clears the unidentified slot.
        """
        u_state = self.bird_states.pop(unid_tid, None)
        meta = self._unid_episode_meta.pop(unid_tid, None)
        if u_state is None:
            return

        ep_start = int(meta["start_frame"]) if (meta and meta.get("start_frame") is not None) else int(start_frame)
        if end_frame is not None:
            ep_end = max(ep_start, int(end_frame))
        elif meta and meta.get("last_frame") is not None:
            ep_end = max(ep_start, int(meta["last_frame"]))
        else:
            ep_end = ep_start

        if target_tid not in self.bird_states:
            self.bird_states[target_tid] = BirdTrackState(
                track_id=target_tid,
                label=target_label,
                bird_type="rooster" if "rooster" in target_label.lower() else "hen",
                last_centroid=u_state.last_centroid,
                last_timestamp_s=u_state.last_timestamp_s,
            )
        tgt = self.bird_states[target_tid]
        monitored_s = max(1.0, self.current_chunk_elapsed_s)
        tgt.valid_observation_s = min(monitored_s, tgt.valid_observation_s + u_state.valid_observation_s)
        tgt.feeding_time_s += u_state.feeding_time_s
        tgt.feeding_bouts += u_state.feeding_bouts
        tgt.reduced_feeding_events += u_state.reduced_feeding_events
        tgt.drinking_time_s += u_state.drinking_time_s
        tgt.drinking_bouts += u_state.drinking_bouts
        tgt.reduced_drinking_events += u_state.reduced_drinking_events
        tgt.total_inactivity_s += u_state.total_inactivity_s
        tgt.prolonged_low_activity_events += u_state.prolonged_low_activity_events
        tgt.total_isolation_s += u_state.total_isolation_s
        tgt.social_isolation_events += u_state.social_isolation_events
        if u_state.is_lethargic_flag:
            tgt.is_lethargic_flag = True

        transferred_bouts: List[Dict[str, Any]] = []

        # Flush or hand over any active bouts of this unidentified episode under the designated bird
        for key in list(self._active_bouts.keys()):
            if key[0] == unid_tid:
                beh = key[1]
                bout = self._active_bouts.pop(key)
                bout["track_id"] = target_tid
                bout["bird_label"] = target_label
                dur_s = round(max(0.0, bout["end_s"] - bout["start_s"]), 1)
                if dur_s >= 1.0:
                    before_len = len(self._completed_bouts)
                    self._finalize_bout(bout)
                    if len(self._completed_bouts) > before_len:
                        cb = self._completed_bouts[-1]
                        transferred_bouts.append({
                            "behavior": cb["behavior"],
                            "start_frame": cb["start_frame"],
                            "end_frame": cb["end_frame"],
                            "start_s": cb["start_s"],
                            "end_s": cb["end_s"],
                            "duration_s": cb["duration_s"],
                        })
                elif (target_tid, beh) not in self._active_bouts:
                    # Preserve short in-progress bout across promotion so it isn't silently dropped
                    self._active_bouts[(target_tid, beh)] = bout

        # Retroactively re-label ONLY this episode's completed bouts & detection_tracking rows (frame >= ep_start)
        for bout in self._completed_bouts:
            if int(bout.get("track_id") or 0) == unid_tid and int(bout.get("end_frame") or 0) >= ep_start:
                bout["track_id"] = target_tid
                bout["bird_label"] = target_label
                transferred_bouts.append({
                    "behavior": bout["behavior"],
                    "start_frame": int(bout["start_frame"]),
                    "end_frame": int(bout["end_frame"]),
                    "start_s": bout["start_s"],
                    "end_s": bout["end_s"],
                    "duration_s": bout["duration_s"],
                })

        for row in self._detection_tracking_rows:
            if int(row.get("track_id") or 0) == unid_tid and int(row.get("frame_number") or 0) >= ep_start:
                row["track_id"] = target_tid
                row["bird_label"] = target_label

        self._identity_transfers.append({
            "old_track_id": int(unid_tid),
            "old_label": f"ID{unid_tid}",
            "transferred_to_track_id": int(target_tid),
            "transferred_to_label": str(target_label),
            "reason": reason,
            "start_frame": int(ep_start),
            "end_frame": int(ep_end),
            "valid_s": round(float(u_state.valid_observation_s), 1),
            "feeding_s": round(float(u_state.feeding_time_s), 1),
            "drinking_s": round(float(u_state.drinking_time_s), 1),
            "inactive_s": round(float(u_state.total_inactivity_s), 1),
            "bouts": transferred_bouts,
            "behavior_segments": [
                {
                    "behavior": seg["behavior"],
                    "start_frame": int(seg["start_frame"]),
                    "end_frame": int(seg["end_frame"]),
                    "duration_s": round(float(seg["duration_s"]), 1),
                }
                for seg in (meta.get("segments", []) if meta else [])
            ],
        })

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
    def _point_to_box_distance(pt: Tuple[float, float], box: List[int]) -> float:
        """Minimum Euclidean distance from a point (cx, cy) to a bounding box (0 if inside)."""
        px, py = pt
        x1, y1, x2, y2 = box
        dx = max(0.0, max(x1 - px, px - x2))
        dy = max(0.0, max(y1 - py, py - y2))
        return math.hypot(dx, dy)

    @staticmethod
    def _boxes_strictly_overlap(box_a: List[int], box_b: List[int], min_overlap_px: int = 2) -> bool:
        """Returns True only when box_a genuinely enters box_b by at least min_overlap_px in both X and Y."""
        ov_x = min(box_a[2], box_b[2]) - max(box_a[0], box_b[0])
        ov_y = min(box_a[3], box_b[3]) - max(box_a[1], box_b[1])
        return ov_x >= min_overlap_px and ov_y >= min_overlap_px

    @classmethod
    def _head_overlaps_circular_station(
        cls,
        head_box: List[int],
        station_box: List[int],
        station_centroid: Tuple[int, int],
        margin_px: float = 0.0,
        min_overlap_px: int = 3,
    ) -> Tuple[bool, float]:
        """
        Strict head/beak-to-station entry check: the Head bounding box must genuinely
        enter the Feeder/Drinker bounding box (by at least min_overlap_px in X and Y)
        AND reach its circular rim (margin_px=0.0, no exterior halo).
        Returns (is_overlapping, rim_gap_px).
        """
        sx1, sy1, sx2, sy2 = station_box
        sw = max(1.0, float(sx2 - sx1))
        sh = max(1.0, float(sy2 - sy1))
        station_radius = 0.50 * min(sw, sh)
        dist_to_center = cls._point_to_box_distance(station_centroid, head_box)
        rim_gap = max(0.0, dist_to_center - station_radius)
        if not cls._boxes_strictly_overlap(head_box, station_box, min_overlap_px=min_overlap_px):
            return False, max(rim_gap, 1.0)
        return (rim_gap <= margin_px), rim_gap

    @classmethod
    def _is_reaching_circular_station(
        cls,
        bird_box: List[int],
        bird_centroid: Tuple[int, int],
        station_box: List[int],
        station_centroid: Tuple[int, int],
        reach_margin_px: float,
    ) -> Tuple[bool, float]:
        """
        Checks if a bird is genuinely reaching a circular Feeder/Drinker rim rather than:
          - standing outside the station bounding box (no box overlap),
          - grazing an empty corner of the equipment's square bounding box (tail tip), or
          - walking/standing parallel alongside the feeder facing perpendicular to it.
        Returns (is_reaching, dist_to_rim_px).
        """
        sx1, sy1, sx2, sy2 = station_box
        sw = max(1.0, float(sx2 - sx1))
        sh = max(1.0, float(sy2 - sy1))
        station_radius = 0.44 * min(sw, sh)

        # Closest distance from the circular station's center to the bird's box
        dist_to_center = cls._point_to_box_distance(station_centroid, bird_box)
        rim_gap = max(0.0, dist_to_center - station_radius)
        # Require actual entry into the station bounding box (no exterior proximity halo)
        if not cls._boxes_strictly_overlap(bird_box, station_box, min_overlap_px=3):
            return False, max(rim_gap, 1.0)
        if rim_gap > min(reach_margin_px, 2.0):
            return False, rim_gap

        # Bird's centroid must be within realistic neck-reach of the circular rim
        bx1, by1, bx2, by2 = bird_box
        bw = max(1.0, float(bx2 - bx1))
        bh = max(1.0, float(by2 - by1))
        bird_len = max(bw, bh)
        centroid_dist = math.hypot(
            bird_centroid[0] - station_centroid[0],
            bird_centroid[1] - station_centroid[1],
        )
        if centroid_dist > station_radius + 0.58 * bird_len:
            return False, rim_gap

        # Perpendicular-passing veto: a bird walking vertically alongside the left/right
        # edge of the feeder (or horizontally past the top/bottom) is passing by, not eating.
        dx = abs(bird_centroid[0] - station_centroid[0])
        dy = abs(bird_centroid[1] - station_centroid[1])
        if dx > 1.35 * dy and bh > 1.30 * bw:
            return False, rim_gap
        if dy > 1.35 * dx and bw > 1.30 * bh:
            return False, rim_gap

        return True, rim_gap

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
        # Step 0: Exact ByteTrack Identity Promotion + Live Spatial Handoff
        # 0.0 First, honor exact ByteTrack promotions emitted by tracker.py when a unique
        #     unidentified track (ID7, ID8, ...) is confirmed as H1–H5 or Rooster on the
        #     same raw_track_id (100% deterministic, zero guessing).
        # -------------------------------------------------------------
        cur_frame_idx = int(getattr(frame_out, "frame_idx", self.total_frames_in_chunk))
        for old_unid_id, new_canonical_id, new_label in getattr(frame_out, "promoted_tracks", []) or []:
            if old_unid_id in self.bird_states:
                meta_p = self._unid_episode_meta.get(old_unid_id)
                ep_start_p = int(meta_p["start_frame"]) if (meta_p and meta_p.get("start_frame") is not None) else 0
                self._transfer_unid_episode(
                    old_unid_id,
                    new_canonical_id,
                    new_label,
                    start_frame=ep_start_p,
                    end_frame=cur_frame_idx,
                    reason="bytetrack_promotion",
                )
        cur_designated_tids = {
            b.track_id for b in current_birds
            if b.track_id is not None and self._is_designated_label(b.bird_label)
        }
        cur_unid_tids = {
            b.track_id for b in current_birds
            if b.track_id is not None and not self._is_designated_label(b.bird_label)
        }

        # 0a. Check if any active unidentified episode just ended & a NON-CO-OCCURRING designated bird appeared at its (x, y)
        for unid_tid, meta in list(self._unid_episode_meta.items()):
            if unid_tid in cur_unid_tids:
                continue
            gap_frames = cur_frame_idx - meta["last_frame"]
            ep_frames = max(1, int(meta.get("frame_count", 1)))
            co_counts: Dict[int, int] = meta.get("co_seen_counts", {})

            def _is_disqualified(d_tid: int) -> bool:
                c = co_counts.get(d_tid, 0)
                return c >= 3 and (c / ep_frames) > 0.15

            # Try matching a designated bird currently at the unidentified episode's last (x, y) within 60 px
            best_target: Optional[Tuple[int, str]] = None
            best_dist = 60.0
            for b in current_birds:
                if b.track_id is None or not self._is_designated_label(b.bird_label):
                    continue
                if _is_disqualified(b.track_id):
                    continue  # Physically impossible: this bird was simultaneously visible alongside ID7+
                d = math.hypot(b.centroid[0] - meta["last_x"], b.centroid[1] - meta["last_y"])
                if d <= best_dist:
                    best_dist = d
                    best_target = (b.track_id, b.bird_label)
            if best_target is not None:
                self._transfer_unid_episode(
                    unid_tid,
                    best_target[0],
                    best_target[1],
                    meta["start_frame"],
                    end_frame=meta["last_frame"],
                    reason="spatial_handoff",
                )
            elif gap_frames > 25 and meta.get("origin_tid") is not None and not _is_disqualified(meta["origin_tid"]):
                # Episode ended and stayed gone > 25 frames: transfer to its non-co-occurring spatial origin bird
                self._transfer_unid_episode(
                    unid_tid,
                    meta["origin_tid"],
                    meta["origin_label"],
                    meta["start_frame"],
                    end_frame=meta["last_frame"],
                    reason="spatial_origin_handoff",
                )

        # 0b. Register new unidentified episodes & record co-occurring designated birds for mutual exclusion
        for b in current_birds:
            if b.track_id is None:
                continue
            if self._is_designated_label(b.bird_label):
                self._last_designated_pos[b.track_id] = (
                    float(b.centroid[0]),
                    float(b.centroid[1]),
                    cur_frame_idx,
                    b.bird_label,
                )
            else:
                meta = self._unid_episode_meta.get(b.track_id)
                if meta is None or (cur_frame_idx - meta["last_frame"]) > 25:
                    # Brand-new episode for this reusable ID7+ slot
                    origin_tid = None
                    origin_label = None
                    best_d = 60.0
                    for d_tid, (dx, dy, df, dlbl) in self._last_designated_pos.items():
                        if d_tid in cur_designated_tids:
                            continue  # That designated bird is still visible elsewhere in this frame
                        if (cur_frame_idx - df) <= 25:
                            dist = math.hypot(b.centroid[0] - dx, b.centroid[1] - dy)
                            if dist <= best_d:
                                best_d = dist
                                origin_tid = d_tid
                                origin_label = dlbl
                    co_init = {dtid: 1 for dtid in cur_designated_tids}
                    self._unid_episode_meta[b.track_id] = {
                        "start_frame": cur_frame_idx,
                        "last_frame": cur_frame_idx,
                        "last_x": float(b.centroid[0]),
                        "last_y": float(b.centroid[1]),
                        "origin_tid": origin_tid,
                        "origin_label": origin_label,
                        "frame_count": 1,
                        "co_seen_counts": co_init,
                    }
                else:
                    meta["last_frame"] = cur_frame_idx
                    meta["last_x"] = float(b.centroid[0])
                    meta["last_y"] = float(b.centroid[1])
                    meta["frame_count"] = int(meta.get("frame_count", 0)) + 1
                    co_counts = meta.setdefault("co_seen_counts", {})
                    for dtid in cur_designated_tids:
                        co_counts[dtid] = co_counts.get(dtid, 0) + 1

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
            # 1 & 2. Feeding & Drinking Zone Check (Hybrid Head Overlap + Circular Rim Fallback)
            # - Primary: when Head is detected, require head_box to touch/overlap the circular
            #   Feeder/Drinker rim (vetoes false positives when the head points away while body/tail
            #   touches the station) and arm a 0.6s grace timer for brief head-dip occlusions.
            # - Fallback: when Head is absent on a frame, honor the 0.6s grace timer if still near
            #   the station, otherwise fall back to circular rim + perpendicular-passing geometry.
            # - Mutually exclusive: assigns only to whichever station is closer.
            # ---------------------------------------------------------
            state.head_feeder_grace_s = max(0.0, state.head_feeder_grace_s - dt)
            state.head_drinker_grace_s = max(0.0, state.head_drinker_grace_s - dt)

            head_box = getattr(bird, "head_box", None)
            if head_box is not None and len(head_box) == 4:
                best_feeder = min(
                    frame_out.feeders,
                    key=lambda f: self._point_to_box_distance(f.centroid, head_box),
                    default=None,
                )
                best_drinker = min(
                    frame_out.drinkers,
                    key=lambda d: self._point_to_box_distance(d.centroid, head_box),
                    default=None,
                )
                feeder_ok, feeder_dist = (
                    self._head_overlaps_circular_station(
                        head_box, best_feeder.box, best_feeder.centroid, margin_px=0.0, min_overlap_px=1
                    )
                    if best_feeder
                    else (False, float("inf"))
                )
                drinker_ok, drinker_dist = (
                    self._head_overlaps_circular_station(
                        head_box, best_drinker.box, best_drinker.centroid, margin_px=0.0, min_overlap_px=1
                    )
                    if best_drinker
                    else (False, float("inf"))
                )
                if feeder_ok:
                    state.head_feeder_grace_s = 0.25
                if drinker_ok:
                    state.head_drinker_grace_s = 0.25
            else:
                best_feeder = min(
                    frame_out.feeders,
                    key=lambda f: self._point_to_box_distance(f.centroid, bird.box),
                    default=None,
                )
                best_drinker = min(
                    frame_out.drinkers,
                    key=lambda d: self._point_to_box_distance(d.centroid, bird.box),
                    default=None,
                )
                feeder_ok, feeder_dist = (
                    self._is_reaching_circular_station(
                        bird.box, bird.centroid, best_feeder.box, best_feeder.centroid,
                        0.0,
                    )
                    if best_feeder
                    else (False, float("inf"))
                )
                drinker_ok, drinker_dist = (
                    self._is_reaching_circular_station(
                        bird.box, bird.centroid, best_drinker.box, best_drinker.centroid,
                        0.0,
                    )
                    if best_drinker
                    else (False, float("inf"))
                )
                bx1, by1, bx2, by2 = bird.box
                bird_len = max(1.0, float(max(bx2 - bx1, by2 - by1)))
                if (
                    not feeder_ok
                    and state.head_feeder_grace_s > 0.0
                    and best_feeder is not None
                    and self._boxes_strictly_overlap(bird.box, best_feeder.box, min_overlap_px=3)
                ):
                    fsx1, fsy1, fsx2, fsy2 = best_feeder.box
                    f_rad = 0.48 * min(max(1.0, float(fsx2 - fsx1)), max(1.0, float(fsy2 - fsy1)))
                    if self._calc_euclidean(bird.centroid, best_feeder.centroid) <= f_rad + 0.58 * bird_len:
                        feeder_ok, feeder_dist = True, 0.0
                if (
                    not drinker_ok
                    and state.head_drinker_grace_s > 0.0
                    and best_drinker is not None
                    and self._boxes_strictly_overlap(bird.box, best_drinker.box, min_overlap_px=3)
                ):
                    dsx1, dsy1, dsx2, dsy2 = best_drinker.box
                    d_rad = 0.48 * min(max(1.0, float(dsx2 - dsx1)), max(1.0, float(dsy2 - dsy1)))
                    if self._calc_euclidean(bird.centroid, best_drinker.centroid) <= d_rad + 0.58 * bird_len:
                        drinker_ok, drinker_dist = True, 0.0

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
                feeder_ok
                and station_speed_ok
                and not (moving_away_feeder and feeder_dist > 0.0)
            )
            near_drinker = (
                drinker_ok
                and station_speed_ok
                and not (moving_away_drinker and drinker_dist > 0.0)
            )
            if near_feeder and near_drinker:
                if feeder_dist <= drinker_dist:
                    near_drinker = False
                else:
                    near_feeder = False

            # A bird actively within the feeder/drinker zone stays Feeding/Drinking even when
            # standing still to eat or drink — never misclassify stationary eating as Inactive.
            state.feeder_immobile_s = 0.0

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
            # Exclude birds currently Feeding or Drinking (standing still to eat/drink is
            # normal intake behavior, not inactivity/lethargy).
            # Require >=2 velocity samples so a bird's very first frame
            # (before any displacement is measured) doesn't log fake 0.1s inactivity.
            # ---------------------------------------------------------
            low_act_thresh = getattr(self.cfg, "low_activity_velocity_threshold_px_s", 3.0)
            if (
                not near_feeder
                and not near_drinker
                and len(state.recent_velocities) >= 2
                and avg_vel < low_act_thresh
            ):
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
            is_actively_feeding = st.is_in_feeder_zone
            is_inactive_now = (
                not is_actively_feeding
                and not st.is_in_waterer_zone
                and len(st.recent_velocities) >= 2
                and st.velocity_px_s < low_act_thresh
            )

            # Update live behavior label for video overlay (replaces confidence badge)
            # Note: social_isolation is still tracked internally in BirdTrackState & logs,
            # but hidden from the live overlay while thresholds are being calibrated.
            if is_actively_feeding:
                st.current_behavior = "Feeding"
            elif st.is_in_waterer_zone:
                st.current_behavior = "Drinking"
            elif is_inactive_now:
                st.current_behavior = "Inactive"
            else:
                st.current_behavior = "Active"

            # Record exact frame-by-frame behavior segments for unidentified episodes so Table 4 is 100% frame-accurate
            if tid in self._unid_episode_meta:
                ep_segs = self._unid_episode_meta[tid].setdefault("segments", [])
                beh_lower = st.current_behavior.lower()
                f_num = int(frame_out.frame_idx)
                if ep_segs and ep_segs[-1]["behavior"] == beh_lower:
                    ep_segs[-1]["end_frame"] = f_num
                    ep_segs[-1]["duration_s"] += dt
                else:
                    ep_segs.append({
                        "behavior": beh_lower,
                        "start_frame": f_num,
                        "end_frame": f_num,
                        "duration_s": dt,
                    })

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

    def _apply_strict_identity_transfer(self, monitored_s: float) -> None:
        """
        Strict Identity Distribution & Retroactive Data Transfer:
        Transfers all accumulated metrics, completed behavior bouts, and detection_tracking
        rows from temporarily unidentified 'Chicken' tracks to their designated Hen/Rooster
        based on (1) spatial proximity (<= 85 px) and (2) largest unobserved time gap among
        the designated birds present in the chunk.
        """
        designated_states = [
            s for s in self.bird_states.values()
            if s.label and s.label.lower() != "chicken" and "unidentified" not in s.label.lower()
        ]
        if not designated_states:
            return

        unid_ids = [
            tid for tid, s in self.bird_states.items()
            if not s.label or s.label.lower() == "chicken" or "unidentified" in s.label.lower()
        ]
        if not unid_ids:
            return

        # Sort unidentified tracks largest-first so major segments claim their best match first
        unid_ids.sort(key=lambda tid: self.bird_states[tid].valid_observation_s, reverse=True)
        transfer_map: Dict[int, BirdTrackState] = {}
        transferred_meta: Dict[int, Dict[str, Any]] = {}

        for tid in unid_ids:
            u_state = self.bird_states[tid]
            target: Optional[BirdTrackState] = None

            # Only transfer if we have a verified non-co-occurring spatial origin or spatial handoff within 60 px.
            # NEVER blindly force-transfer an extra/7th bird that co-occurred with all 6 designated birds!
            meta = self._unid_episode_meta.get(tid)
            ep_frames = max(1, int(meta.get("frame_count", 1))) if meta else 1
            co_counts: Dict[int, int] = meta.get("co_seen_counts", {}) if meta else {}

            def _disq(d_tid: int) -> bool:
                c = co_counts.get(d_tid, 0)
                return c >= 3 and (c / ep_frames) > 0.15

            if meta and meta.get("origin_tid") in self.bird_states and not _disq(meta["origin_tid"]):
                target = self.bird_states[meta["origin_tid"]]
            elif u_state.last_centroid is not None:
                best_dist = 60.0
                for d_state in designated_states:
                    if d_state.last_centroid is None or _disq(d_state.track_id):
                        continue
                    dist = math.hypot(
                        u_state.last_centroid[0] - d_state.last_centroid[0],
                        u_state.last_centroid[1] - d_state.last_centroid[1],
                    )
                    if dist <= best_dist:
                        best_dist = dist
                        target = d_state

            if target is None:
                continue  # Keep as genuine unidentified bird (e.g. 7th unsaddled chicken)

            transfer_map[tid] = target
            ep_start = int(meta["start_frame"]) if (meta and meta.get("start_frame") is not None) else 0
            ep_end = int(meta["last_frame"]) if (meta and meta.get("last_frame") is not None) else ep_start
            transferred_meta[tid] = {
                "old_track_id": int(tid),
                "old_label": f"ID{tid}",
                "transferred_to_track_id": int(target.track_id),
                "transferred_to_label": str(target.label),
                "reason": "chunk_end_handoff",
                "start_frame": ep_start,
                "end_frame": max(ep_start, ep_end),
                "valid_s": round(float(u_state.valid_observation_s), 1),
                "feeding_s": round(float(u_state.feeding_time_s), 1),
                "drinking_s": round(float(u_state.drinking_time_s), 1),
                "inactive_s": round(float(u_state.total_inactivity_s), 1),
                "bouts": [],
                "behavior_segments": [
                    {
                        "behavior": seg["behavior"],
                        "start_frame": int(seg["start_frame"]),
                        "end_frame": int(seg["end_frame"]),
                        "duration_s": round(float(seg["duration_s"]), 1),
                    }
                    for seg in (meta.get("segments", []) if meta else [])
                ],
            }

            # Transfer accumulated behavioral & observation metrics
            target.valid_observation_s = min(monitored_s, target.valid_observation_s + u_state.valid_observation_s)
            target.feeding_time_s += u_state.feeding_time_s
            target.feeding_bouts += u_state.feeding_bouts
            target.reduced_feeding_events += u_state.reduced_feeding_events
            target.drinking_time_s += u_state.drinking_time_s
            target.drinking_bouts += u_state.drinking_bouts
            target.reduced_drinking_events += u_state.reduced_drinking_events
            target.total_inactivity_s += u_state.total_inactivity_s
            target.prolonged_low_activity_events += u_state.prolonged_low_activity_events
            target.total_isolation_s += u_state.total_isolation_s
            target.social_isolation_events += u_state.social_isolation_events
            if u_state.is_lethargic_flag:
                target.is_lethargic_flag = True

            del self.bird_states[tid]

        # Retroactively re-label completed behavior bouts & detection_tracking rows
        for bout in self._completed_bouts:
            tid = int(bout.get("track_id") or 0)
            if tid in transfer_map:
                tgt = transfer_map[tid]
                bout["track_id"] = tgt.track_id
                bout["bird_label"] = tgt.label
                transferred_meta[tid]["bouts"].append({
                    "behavior": bout["behavior"],
                    "start_frame": int(bout["start_frame"]),
                    "end_frame": int(bout["end_frame"]),
                    "start_s": bout["start_s"],
                    "end_s": bout["end_s"],
                    "duration_s": bout["duration_s"],
                })

        for row in self._detection_tracking_rows:
            tid = int(row.get("track_id") or 0)
            if tid in transfer_map:
                tgt = transfer_map[tid]
                row["track_id"] = tgt.track_id
                row["bird_label"] = tgt.label

        for entry in transferred_meta.values():
            self._identity_transfers.append(entry)

    def compute_chunk_summary(self) -> BehaviorChunkSummary:
        """
        Synthesizes all tracking states into the 30-minute behavior metrics record.
        """
        # Flush any still-open behavior bouts first so they are included in strict identity transfer
        for bout in list(self._active_bouts.values()):
            self._finalize_bout(bout)
        self._active_bouts.clear()

        # Strictly transfer any temporarily unidentified 'Chicken' track data to its designated Hen/Rooster
        self._apply_strict_identity_transfer(max(1.0, self.current_chunk_elapsed_s))

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
            identity_transfers=sorted(self._identity_transfers, key=lambda t: (t["start_frame"], t["old_track_id"])),
        )