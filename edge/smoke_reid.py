"""
edge/smoke_reid.py - Manual smoke test for the Re-ID + ByteTrack engine.

Runs the real weights on the sample clip and prints per-frame identity diagnostics
(ByteTrack ID vs identity ID, label source) so you can see ID switches and re-acquisitions.

    python -m edge.smoke_reid --frames 120
"""

import argparse
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import cv2  # noqa: E402

from edge.config import CONFIG  # noqa: E402
from edge.detector import PoultryInferenceEngine  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=None)
    parser.add_argument("--frames", type=int, default=90)
    args = parser.parse_args()

    source = args.source or CONFIG.vision.video_source
    cap = cv2.VideoCapture(source if not str(source).isdigit() else int(source))
    if not cap.isOpened():
        print(f"[FAIL] cannot open {source}")
        return 1

    engine = PoultryInferenceEngine()
    source_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    if source_fps > 0:
        engine.set_source_fps(source_fps)
    sources = Counter()
    identity_ids = set()
    raw_ids = set()
    raws_per_identity = Counter()
    labels = Counter()
    processed = 0
    started = time.perf_counter()

    while processed < args.frames:
        ok, frame = cap.read()
        if not ok:
            break
        result = engine.process_frame(frame)
        for bird in result.birds:
            identity_ids.add(bird.track_id)
            raw_ids.add(bird.raw_track_id)
            if processed and bird.identity_source == "new_track":
                raws_per_identity[bird.track_id] += 1
            sources[bird.identity_source or "tracked"] += 1
            labels[bird.label] += 1
        if processed % 15 == 0:
            print(
                f"frame {result.frame_idx:4d} | birds {result.total_birds:2d} | "
                f"hens {result.hens_identified} | roosters {result.roosters} | "
                f"{result.inference_time_ms:6.1f} ms | "
                + ", ".join(f"id{b.track_id}/{b.raw_track_id}:{b.label}" for b in result.birds[:8])
            )
        processed += 1

    cap.release()
    elapsed = time.perf_counter() - started
    print("\n--- summary ---")
    print(f"frames           : {processed} ({processed / max(elapsed, 1e-6):.1f} FPS end-to-end)")
    print(f"identity IDs     : {len(identity_ids)}")
    print(f"ByteTrack IDs    : {len(raw_ids)}")
    print(f"churn            : {sum(raws_per_identity.values())} new identity spawns after frame 0")
    print(f"re-acquired      : {sources.get('reid_band', 0) + sources.get('reid_appearance', 0)} detections")
    print(f"identity sources : {dict(sources)}")
    print(f"labels           : {dict(labels)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
