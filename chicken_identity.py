"""Stable, bounded display IDs for tracked chickens in a video."""

import math
from typing import Dict, List, Optional, Sequence, Tuple


class ChickenIdentityAssigner:
    MAX_IDS = 7

    def __init__(
        self,
        max_gap_frames: int = 30,
        distance_ratio: float = 0.08,
        min_distance_px: float = 50.0,
    ) -> None:
        self.max_gap_frames = max_gap_frames
        self.distance_ratio = distance_ratio
        self.min_distance_px = min_distance_px
        self.raw_to_display: Dict[int, int] = {}
        self.last_positions: Dict[int, Tuple[Tuple[float, float], int]] = {}

    def reset(self) -> None:
        self.raw_to_display.clear()
        self.last_positions.clear()

    def assign(
        self,
        tracks: Sequence[Tuple[Optional[int], Tuple[float, float]]],
        frame_shape: Tuple[int, ...],
        frame_number: int,
    ) -> List[Optional[int]]:
        frame_diagonal = math.hypot(frame_shape[0], frame_shape[1])
        max_distance = max(self.min_distance_px, frame_diagonal * self.distance_ratio)
        display_ids: List[Optional[int]] = [None] * len(tracks)
        assigned_ids = set()
        seen_raw_ids = set()
        pending = []

        expired_ids = {
            display_id
            for display_id, (_, last_seen) in self.last_positions.items()
            if frame_number - last_seen > self.max_gap_frames
        }
        for display_id in expired_ids:
            self.last_positions.pop(display_id, None)
        if expired_ids:
            self.raw_to_display = {
                raw_id: display_id
                for raw_id, display_id in self.raw_to_display.items()
                if display_id not in expired_ids
            }

        for index, (raw_id, center) in enumerate(tracks):
            if raw_id is None or raw_id in seen_raw_ids:
                continue
            seen_raw_ids.add(raw_id)
            display_id = self.raw_to_display.get(raw_id)
            position = self.last_positions.get(display_id) if display_id is not None else None
            if display_id is not None and display_id not in assigned_ids:
                display_ids[index] = display_id
                assigned_ids.add(display_id)
            else:
                pending.append((index, raw_id, center))

        candidate_pairs = []
        for index, raw_id, center in pending:
            for display_id, (last_center, last_seen) in self.last_positions.items():
                gap = frame_number - last_seen
                if display_id in assigned_ids or not 1 <= gap <= self.max_gap_frames:
                    continue
                distance = math.dist(center, last_center)
                if distance <= max_distance:
                    candidate_pairs.append((distance, display_id, raw_id, index))

        matched_indices = set()
        for _, display_id, raw_id, index in sorted(candidate_pairs):
            if display_id in assigned_ids or index in matched_indices:
                continue
            for previous_raw_id, previous_display_id in list(self.raw_to_display.items()):
                if previous_display_id == display_id:
                    self.raw_to_display.pop(previous_raw_id)
            self.raw_to_display[raw_id] = display_id
            display_ids[index] = display_id
            assigned_ids.add(display_id)
            matched_indices.add(index)

        for index, raw_id, _ in pending:
            if index in matched_indices:
                continue
            display_id = next(
                (candidate for candidate in range(1, self.MAX_IDS + 1)
                 if candidate not in assigned_ids and candidate not in self.last_positions),
                None,
            )
            if display_id is None:
                continue
            for previous_raw_id, previous_display_id in list(self.raw_to_display.items()):
                if previous_display_id == display_id:
                    self.raw_to_display.pop(previous_raw_id)
            self.raw_to_display[raw_id] = display_id
            display_ids[index] = display_id
            assigned_ids.add(display_id)

        for display_id, (_, center) in zip(display_ids, tracks):
            if display_id is not None:
                self.last_positions[display_id] = (center, frame_number)

        return display_ids
