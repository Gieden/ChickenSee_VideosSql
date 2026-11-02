# ChickenSee — Detection + Re-ID + ByteTrack algorithm

This document describes **how the system detected and tracked birds before** (what was wrong),
**what changed**, and the **algorithm that now runs**, as a flowchart.

Files involved:

| File | Role |
| --- | --- |
| `edge/detector.py` | YOLO inference, ByteTrack/PurpleTracker association, band voting, Re-ID identity bank |
| `edge/reid.py` | Geometry gate, leg-band signature, appearance descriptor, vote bank (NumPy/OpenCV only) |
| `edge/tracker.py` | `AgriByteTracker` — ByteTrack + apex-anchored association (registered in Ultralytics `TRACKER_MAP`) |
| `bytetrack_poultry.yaml` | Thresholds for both association paths |
| `analytics/tracker.py` | Recorded-video tracker used by the analytics worker — display-ID re-ID + hen colour labels |
| `legband.py` | HSV table and the single-frame band detector (unchanged) |
| `run_tests.py` | `python run_tests.py` → 74 tests |
| `edge/smoke_reid.py` | `python -m edge.smoke_reid --frames 122` → run the real model and print per-frame identity diagnostics |

---

## 1. What the previous pipeline actually did

```
frame ─► model.track(conf=0.15, tracker=bytetrack_poultry.yaml)
           │
           ├─ tracker thresholds: high 0.10 / low 0.04 / new 0.10 / match 0.75
           ├─ (label says "lowered to 25%" — the numbers were never 25%)
           ▼
         ByteTrack gives raw IDs
           ▼
         leg band (YOLO box) → track_states[raw_id] = colour   ← permanent, first match wins
         HSV crop fallback    → same, one frame is enough
           ▼
         label = track_states.get(raw_id, "Chicken")
         duplicate colour in one frame → "Chicken"
           ▼
         track_id = short ID of the RAW ByteTrack id  (identity dies with the track)
```

Specific defects found by reading the code and running it against
`agent/data/48f95267-…mp4` (2880×1620 @ 15 FPS, 122 frames):

1. **ByteTrack's second stage never ran.** The detector emitted `conf >= 0.15`, while the YAML
   set `track_high_thresh: 0.10`. Every box was "high confidence", so
   `track_low_thresh` (0.04) was dead code — the entire reason ByteTrack exists was disabled.
2. **`new_track_thresh` (0.10) sat *below* the detector confidence**, so every weak, partially
   occluded box created a brand-new ID. That is the main source of the ID explosion
   (`b000 / b001 / b002` in the UI) under feeder/drinker occlusion.
3. **`match_thresh: 0.75`** accepts a pair of boxes with only 25 % IoU. In a pen where necks,
   backs and tails overlap constantly, the Hungarian assignment routinely attached a detection
   to the wrong neighbour.
4. **One frame of a leg band permanently named a bird.** `track_states[raw_id] = colour` had no
   temporal evidence, no ambiguity check, and no way to be corrected. A single white-feather
   highlight froze a bird as "Hen2 (White)" forever — exactly the persistent wrong colour seen in
   the dashboard.
5. **White band vs white feathers was not distinguished.** The HSV "white" range
   (`S<45, V>195`) matches plumage highlights on white birds, and `detect_leg_band_color` runs on
   a *box* by considering the bottom 30 %, so the only veto available is dominance of the
   saturated-white feather pixels — which was never used.
6. **Identity = ByteTrack ID.** No identity survived a ByteTrack drop, so a bird hidden for more
   than `track_buffer` came back as a new bird. The only "Re-ID" was a hop between raw ids in
   `_assign_display_ids` — it existed only in `analytics/tracker.py`, and its gate
   (`diagonal × 0.02` = ~650 px on a 2880-px frame) accepted **any** nearby bird as "the same".
   `edge/detector.py`, the live engine, had no Re-ID at all.
7. **Two-bird colour swap.** `analytics/tracker.py` applied labels in priority order with a
   "last one wins" duplicate check: two overlapping birds could trade `Hen1`/`Hen3` for a frame.
8. **Identities were never reclaimed.** `track_last_label` was never cleaned, so once five
   colours were held by dead tracks, no live bird could ever be labelled again (`Coward 1 Bird`
   in the dashboard froze `hens_identified`).
9. Minor: the FPS used to size identity buffers was a constant `20`, while the clip runs at 15;
   `max_inactive_frames` ignored when the track was actually last seen; the colour assignment ran
   even on birds whose label was `Chicken` and consumed all five colours.

---

## 2. The new algorithm (flowchart)

```
                 ┌──────────────────────────────────────────────────────────────┐
                 │ frame (BGR, any resolution)                                  │
                 └───────────────────────────┬──────────────────────────────────┘
                                             ▼
                     downscale to TARGET_WIDTH (scale_w, scale_h remembered)
                                             ▼
        ┌────────────────────────────────────────────────────────────────────────┐
        │ A. ASSOCIATION  (Two options, one ID space)                            │
        │                                                                        │
        │  A1. PurpleTracker  (default, USE_ULTRALYTICS_TRACKER=0)              │
        │      model.track(persist=True) → YOLO detections D                     │
        │      D_sorted = D ordered by x1  ("alphabetically", left → right)      │
        │      pass 1 : tracker.purple_update(D_sorted)                          │
        │               └─ ByteTrack: high-conf Kalman match, then low-conf      │
        │               └─ unmatched high (≥ new_track_thresh) → new track id    │
        │      pass 2 : tracker.purple_reverse_update(reverse(D_sorted))         │
        │               └─ same track pool, right → left, centroid-distance      │
        │      → each detection keeps the ID that both directions agree on      │
        │                                                                        │
        │  A2. Ultralytics model.track() + bytetrack_poultry.yaml                │
        │      (USE_ULTRALYTICS_TRACKER=1, tracker_type: agribytetrack)          │
        │      ByteTrack + apex penalty:                                         │
        │        cost = IoU_distance(track, det)                                 │
        │               − 0.20 if apex(track_pred) ∩ apex(det) ≥ 0.35            │
        │                        and |h_track − h_det| / h_track ≤ 0.35          │
        │        (apex = lower 60 % of the box = feet / leg-band zone)           │
        │                                                                        │
        │  YAML (both paths):                                                    │
        │    track_high_thresh 0.45 · track_low_thresh 0.15                      │
        │    new_track_thresh  0.55 · match_thresh 0.60 · track_buffer 60        │
        └───────────────────────────┬────────────────────────────────────────────┘
                                    ▼
        ┌────────────────────────────────────────────────────────────────────────┐
        │ B. PER-DETECTION EVIDENCE                                              │
        │                                                                        │
        │  B1. Rooster → colour identity forced to "Rooster", never band-scanned │
        │                                                                        │
        │  B2. Band signature (odd frames only — colour cannot change in 1/15 s) │
        │        leg_band_signature(frame, box)                                  │
        │          • only the bottom 30 % of a standing bird (skip if w/h > 1.35)│
        │          • per colour: compact connected component (10..350 px²)       │
        │          • winner must beat the runner-up by ≥ 40 %                    │
        │        → (colour, dominance, band box) or None                         │
        │        if colour == White and white feathers dominate the band patch   │
        │            → veto (a veto is remembered 8 frames for that track)       │
        │                                                                        │
        │  B3. Appearance fingerprint                                            │
        │        appearance_descriptor(frame, box, anchor=band box or lower body)│
        │        4 × HSV histogram cells around the band location (L2-normalised)│
        └───────────────────────────┬────────────────────────────────────────────┘
                                    ▼
        ┌────────────────────────────────────────────────────────────────────────┐
        │ C. IDENTITY RESOLUTION  (identity id ≠ ByteTrack id)                   │
        │                                                                        │
        │  C1. track_identities[raw_id] still alive → keep that identity         │
        │                                                                        │
        │  C2. otherwise RE-ID SCORE against parked identities                   │
        │      for each identity not shown this frame:                           │
        │        Gate 1 spatial : IoU(box, last box) ≥ 0.05  OR                 │
        │                         centre ≤ 2 × body size                        │
        │        Gate 2 size    : |Δ body size| / size ≤ 45 % (if raw track)    │
        │        Gate 3 time    : age ≤ REID_MAX_GAP_S (3 s)                    │
        │        Gate 4 colour  :                                                │
        │          • observed == identity colour  → +0.35   (reid_band)          │
        │          • observed ≠ confirmed / pending colour → REJECT              │
        │          • identity coloured, band invisible → require appearance ≥ 0.55│
        │          • identity uncoloured, band invisible → appearance ≥ 0.40     │
        │        bonus : +0.20 newly spawned ByteTrack id + known colour         │
        │        bonus : +0.25 × appearance cosine                               │
        │        bonus : +0.15 × freshness (1 − age/buffer)                      │
        │        accept best if score ≥ 0.45 and identity not already claimed    │
        │                                                                        │
        │  C3. no match → new identity id                                        │
        │                                                                        │
        │  C4. YOLO Leg_Band_* neighbour of a chicken → +3 votes to its identity │
        └───────────────────────────┬────────────────────────────────────────────┘
                                    ▼
        ┌────────────────────────────────────────────────────────────────────────┐
        │ D. TEMPORAL COLOUR VOTE  (BandVoteBank, one per identity)              │
        │                                                                        │
        │   HSV observation            → +1.0 vote                               │
        │   YOLO Leg_Band_* box        → +3.0 votes                              │
        │   every frame                → all votes × 0.92                        │
        │                                                                        │
        │   lock when  votes[winner] ≥ 3  AND  share[winner] ≥ 0.70               │
        │   switch when votes[challenger] ≥ votes[locked] + 2                    │
        │   otherwise                              → "Chicken" (generic)          │
        └───────────────────────────┬────────────────────────────────────────────┘
                                    ▼
        ┌────────────────────────────────────────────────────────────────────────┐
        │ E. OUTPUT (1-to-1 colour per frame)                                    │
        │   • label = locked colour | "Rooster" | "Chicken"                      │
        │   • a colour already printed by another identity → "Chicken"           │
        │   • Detection(track_id=IDENTITY id, raw_track_id=ByteTrack id,          │
        │               identity_source = tracked | reid_band |                 │
        │                                  reid_appearance | new_track,        │
        │               reid_score=…)                                           │
        │   • box smoothing per identity (0.4 new + 0.6 previous)                │
        └───────────────────────────┬────────────────────────────────────────────┘
                                    ▼
        ┌────────────────────────────────────────────────────────────────────────┐
        │ F. MEMORY                                                              │
        │   identity_last_seen / centroid / descriptor (EMA 0.7/0.3)              │
        │   band_last_box (appearance anchor when the band is hidden)             │
        │   LRU prune: identity ≥ 20 s unseen, ByteTrack mapping ≥ 20 s unseen    │
        │   hard cap 5 000 identities (12 h shift safety valve)                  │
        └────────────────────────────────────────────────────────────────────────┘
```

### Sequence view

```
frame f                           frame f+1 … f+45 (occluded)        frame f+46 (reappears)
─────────────────────────────     ─────────────────────────────       ───────────────────────────────
ByteTrack id 42 ─ identity 7       no detection                        ByteTrack id 51 (new!)
logic 44      ─ identity 7                                             C1 fails (51 unknown)
                                                                       C2: identity 7 parked,
                                                                           colour Green == observed,
                                                                           gate OK → identity 7
\___________________________ behaviour/aggregator see one ID ____________________________/
```

The behaviour analyser (`edge/behavior.py`) and the hourly aggregator (`edge/aggregator.py`)
key their profiles on `Detection.track_id`; because that field now carries the identity id, a
bird that is briefly lost no longer fragments into two profiles or two "unique birds".

---

## 3. Thresholds and why

| Parameter | Value | Reason |
| --- | --- | --- |
| `track_high_thresh` | 0.45 | Must exceed the detector's 0.15 so the low-score stage exists |
| `track_low_thresh` | 0.15 | Low-confidence boxes may refresh an ID but never spawn one |
| `new_track_thresh` | 0.55 | Stops occlusion fragments from becoming new birds |
| `match_thresh` | 0.60 | Max cost (1 − fused IoU); 0.75 let near-touching boxes swap |
| `track_buffer` | 60 (~4 s @ 15 FPS) | Parked identity lifetime before ByteTrack removes it |
| Band lock | 3 votes, 70 % share | 1 YOLO box or ~3 HSV frames; disputes stay "Chicken" |
| Band switch margin | +2 votes | Same idea as `CLASS_SWITCH_MARGIN` in analytics |
| White veto | feather pixels ≥ 55 % of the band patch | White bands on white birds stay undecided |
| Re-ID window | 3 s | `REID_MAX_GAP_S`; converts with the real stream FPS |
| Re-ID accept | 0.45 | Spatial gate + colour/appearance agreement |
| Appearance min | 0.55 (coloured) / 0.40 (uncoloured) | Fingerprint is a tie-breaker, not a biometric |

All of these are environment-overridable in `edge/config.py`
(`REID_MAX_GAP_S`, `REID_APPEARANCE_MIN`, `REID_IOU_GATE`, `SOURCE_FPS_HINT`,
`USE_ULTRALYTICS_TRACKER`, plus the existing `CONF_THRESHOLD`, `IOU_THRESHOLD`, …).

---

## 4. Analytics tracker (`analytics/tracker.py`) changes

Same identity philosophy, applied to the recorded-video path:

* Re-ID gate 0.06 × diagonal (~44 px on a 640×360 analysis frame) for the first 2 s, 0.03 after
  that, plus a body-size tolerance — instead of “anywhere on the frame”.
* Stage A/B/C label resolution: a track keeps the colour it already showed, a new colour is only
  applied when no other live track owns it (no more Hen1 ↔ Hen3 swaps).
* `track_last_label` / `label_owner` are reclaimed after 90 unseen frames, so colours free up.
* Detector confidence for tracking is `min(conf, MIN_LEG_BAND_CONFIDENCE)`; bird detections are
  still re-gated at 70 % per class, as documented.
* Lazy initialisation of display-id dictionaries (the module is unit-tested via `object.__new__`).

---

## 5. Verifying it

```powershell
python run_tests.py                      # 74 unit tests (analytics + edge Re-ID)
python -m edge.smoke_reid --frames 122   # real weights on the sample clip, per-frame diagnostics
python -m edge.pipeline --view --force-start
```

`edge.smoke_reid` prints, per sampled frame,
`id<identity>/<bytetrack>:<label>`, then a summary with identity count, ByteTrack count,
identity spawns after frame 0 and re-acquisitions.

Measured on the sample flyover clip (122 frames, 2880×1620, ~5–11 birds, 2.5–10.6 FPS
end-to-end on this CPU depending on the association path):

| Metric | Before | After |
| --- | --- | --- |
| What `track_id` means | ByteTrack id (identity dies with the track) | identity id, survives ByteTrack drops for 3 s |
| Re-acquisitions in 122 frames | 0 (no Re-ID in `edge/`) | 4 (`identity_source = reid_band`) |
| Sticky wrong colour | 1 HSV frame was enough | needs 3 votes / 70 % share, white-feather veto |
| Two-bird colour swap | possible (last-wins in analytics) | impossible (1-to-1 per frame) |
| Rooster identity | could hop to a hen | kept as one identity across two camera re-entries |

> Note on the sample clip: it is a panning flyover where the whole flock re-enters from the
> other edge every ~45 frames. A panning camera makes **every** bird look new to any IoU tracker
> (its own “ground truth” changes), so raw spawn counts remain high; the identity bank is what
> keeps `id1` and `id13` (Rooster) alive across two full re-entries.

---

## 6. Known limits / next steps

* HSV band detection still needs a visible leg. Feeding / crouching birds stay `Chicken` until
  the band is seen again; their identity and appearance fingerprint are kept, so the label comes
  back as soon as they stand up.
* `appearance_descriptor` is a colour-histogram fingerprint, not a learned embedding. If two
  birds share a band colour and sit close together, the spatial gate and freshness term decide.
  A trained Re-ID head (e.g. a small OSNet) can be slotted in at `appearance_descriptor()` without
  touching the rest of the algorithm.
* The apex penalty in `AgriByteTracker` assumes the camera looks down / at an angle where feet
  occupy the lower part of the box. For side-on views, set `apex_height_ratio` lower.
