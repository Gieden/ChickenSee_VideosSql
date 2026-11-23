import { BIRD_DEFINITIONS, BirdDef, mapBirdToDef, ORDERED_BIRDS } from '@/lib/research-datasets';

const DESIGNATED_SHORT_IDS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'R1']);

export const SHORT_ID_TO_CANONICAL_LABEL: Record<string, string> = {
  H1: 'Hen1 (Yellow)',
  H2: 'Hen2 (Blue)',
  H3: 'Hen3 (Red)',
  H4: 'Hen4 (White)',
  H5: 'Hen5 (YellowGreen)',
  R1: 'Rooster',
};

export function isDesignatedBird(rawLabel?: string, trackId?: number): boolean {
  const lbl = (rawLabel || '').trim();
  if (!lbl || lbl.toLowerCase() === 'chicken' || lbl.toLowerCase().includes('unidentified')) {
    return false;
  }
  const def = mapBirdToDef(lbl, trackId);
  return DESIGNATED_SHORT_IDS.has(def.shortId);
}

export interface FrameLogLike {
  total_frames?: number;
  behavior_events?: Array<Record<string, any>>;
  detection_tracking?: Array<Record<string, any>>;
  bird_records?: Array<Record<string, any>>;
}

export interface StrictTransferResult {
  /** Maps an unidentified track_id (e.g. 7, 8, 9) to the designated bird shortId ('H1'..'R1') */
  trackToDesignated: Map<number, BirdDef>;
  /** Number of unidentified tracks strictly transferred to designated birds */
  transferredTrackCount: number;
}

/**
 * Strict Identity Distribution & Retroactive Data Transfer:
 * When a bird is temporarily unidentified ("Chicken", track_id >= 7) and the system
 * subsequently (or previously) labels that physical bird as a designated Hen (H1–H5)
 * or Rooster (R1), this resolver maps the unidentified track to its designated bird using:
 *   1. Same-track promotion (track_id carries a confirmed label on any frame)
 *   2. Spatial-temporal handoff (unidentified track appears/disappears within <= 85px and
 *      <= 60 frames of a designated bird's position in detection_tracking)
 *   3. Strict 6-bird capacity attribution (any remaining unidentified track with no sampled
 *      coordinates is assigned to the designated bird with the largest unobserved time gap
 *      in that window, preventing data from being stranded under "Chicken (Unidentified)")
 */
export function buildStrictIdentityTransferMap(fl: FrameLogLike): StrictTransferResult {
  const trackToDesignated = new Map<number, BirdDef>();
  const dtRows = Array.isArray(fl.detection_tracking) ? fl.detection_tracking : [];
  const birdRecords = Array.isArray(fl.bird_records) ? fl.bird_records : [];
  const behaviorEvents = Array.isArray(fl.behavior_events) ? fl.behavior_events : [];

  // Collect all unidentified track_ids across detection_tracking, behavior_events, and bird_records
  const unidTrackIds = new Set<number>();
  const designatedTrackObs = new Map<string, { validS: number; winS: number }>();
  for (const b of ORDERED_BIRDS) {
    designatedTrackObs.set(b.shortId, { validS: 0, winS: 0 });
  }

  for (const br of birdRecords) {
    const tid = Number(br.track_id) || 0;
    const lbl = String(br.bird_label || '');
    if (isDesignatedBird(lbl, tid)) {
      const def = mapBirdToDef(lbl, tid);
      const cur = designatedTrackObs.get(def.shortId);
      if (cur) {
        cur.validS += Math.max(0, Number(br.valid_observation_duration_s) || 0);
        cur.winS += Math.max(0, Number(br.window_duration_s) || 0);
      }
      if (tid > 0) trackToDesignated.set(tid, def);
    } else if (tid > 0) {
      unidTrackIds.add(tid);
    }
  }

  // Rule 1: Same-track promotion from detection_tracking & behavior_events
  const unidTrackEndpoints = new Map<
    number,
    { firstFrame: number; firstX: number; firstY: number; lastFrame: number; lastX: number; lastY: number }
  >();
  const designatedSightings: Array<{ frame: number; x: number; y: number; def: BirdDef }> = [];

  const sortedDt = [...dtRows].sort(
    (a, b) => (Number(a.frame_number) || 0) - (Number(b.frame_number) || 0),
  );

  for (const row of sortedDt) {
    const tid = Number(row.track_id) || 0;
    const lbl = String(row.bird_label || '');
    const frame = Number(row.frame_number) || 0;
    const x = Number(row.x_center_px) || 0;
    const y = Number(row.y_center_px) || 0;

    if (isDesignatedBird(lbl, tid)) {
      const def = mapBirdToDef(lbl, tid);
      if (tid > 0) trackToDesignated.set(tid, def);
      if (x > 0 || y > 0) {
        designatedSightings.push({ frame, x, y, def });
      }
    } else if (tid > 0) {
      unidTrackIds.add(tid);
      if (x > 0 || y > 0) {
        const prev = unidTrackEndpoints.get(tid);
        if (!prev) {
          unidTrackEndpoints.set(tid, {
            firstFrame: frame,
            firstX: x,
            firstY: y,
            lastFrame: frame,
            lastX: x,
            lastY: y,
          });
        } else {
          prev.lastFrame = frame;
          prev.lastX = x;
          prev.lastY = y;
        }
      }
    }
  }

  for (const ev of behaviorEvents) {
    const tid = Number(ev.track_id) || 0;
    const lbl = String(ev.bird_label || '');
    if (isDesignatedBird(lbl, tid)) {
      if (tid > 0) trackToDesignated.set(tid, mapBirdToDef(lbl, tid));
    } else if (tid > 0) {
      unidTrackIds.add(tid);
    }
  }

  // Rule 2: Spatial-temporal handoff for unidentified tracks with known (x, y) endpoints
  const MAX_FRAME_GAP = 60;
  const MAX_DIST_PX = 85;
  for (const tid of Array.from(unidTrackIds)) {
    if (trackToDesignated.has(tid)) continue;
    const ep = unidTrackEndpoints.get(tid);
    if (!ep || designatedSightings.length === 0) continue;

    let bestDef: BirdDef | null = null;
    let bestScore = Infinity;

    for (const s of designatedSightings) {
      // Check forward handoff (designated bird appears right after unidentified track ends)
      const fwdGap = Math.abs(s.frame - ep.lastFrame);
      if (fwdGap <= MAX_FRAME_GAP) {
        const dist = Math.hypot(s.x - ep.lastX, s.y - ep.lastY);
        if (dist <= MAX_DIST_PX) {
          const score = dist + fwdGap * 0.5;
          if (score < bestScore) {
            bestScore = score;
            bestDef = s.def;
          }
        }
      }
      // Check backward handoff (designated bird disappeared right before unidentified track started)
      const bwdGap = Math.abs(ep.firstFrame - s.frame);
      if (bwdGap <= MAX_FRAME_GAP) {
        const dist = Math.hypot(s.x - ep.firstX, s.y - ep.firstY);
        if (dist <= MAX_DIST_PX) {
          const score = dist + bwdGap * 0.5;
          if (score < bestScore) {
            bestScore = score;
            bestDef = s.def;
          }
        }
      }
    }

    if (bestDef) {
      trackToDesignated.set(tid, bestDef);
    }
  }

  // Rule 3: Strict 6-bird capacity distribution for any remaining unidentified tracks
  // Assigns remaining unidentified tracks (sorted largest-first) to whichever of the 6 designated
  // pen birds has the largest unobserved time gap in this video, so zero data is stranded.
  const remainingGap = new Map<string, number>();
  for (const b of ORDERED_BIRDS) {
    const obs = designatedTrackObs.get(b.shortId) || { validS: 0, winS: 0 };
    const expectedWin = obs.winS > 0 ? obs.winS : 2700;
    remainingGap.set(b.shortId, Math.max(0, expectedWin - obs.validS));
  }

  const unidValidByTid = new Map<number, number>();
  for (const br of birdRecords) {
    const tid = Number(br.track_id) || 0;
    if (tid > 0 && unidTrackIds.has(tid) && !trackToDesignated.has(tid)) {
      unidValidByTid.set(
        tid,
        (unidValidByTid.get(tid) || 0) + Math.max(0, Number(br.valid_observation_duration_s) || 0),
      );
    }
  }

  const unresolvedTids = Array.from(unidTrackIds)
    .filter((tid) => !trackToDesignated.has(tid))
    .sort((a, b) => (unidValidByTid.get(b) || 0) - (unidValidByTid.get(a) || 0));

  for (const tid of unresolvedTids) {
    let bestShortId: keyof typeof BIRD_DEFINITIONS = 'H1';
    let maxGap = -1;
    for (const b of ORDERED_BIRDS) {
      const gap = remainingGap.get(b.shortId) ?? 0;
      if (gap > maxGap) {
        maxGap = gap;
        bestShortId = b.shortId as keyof typeof BIRD_DEFINITIONS;
      }
    }
    const def = BIRD_DEFINITIONS[bestShortId];
    trackToDesignated.set(tid, def);
    const consumed = unidValidByTid.get(tid) || 30;
    remainingGap.set(bestShortId, Math.max(0, (remainingGap.get(bestShortId) || 0) - consumed));
  }

  let transferredTrackCount = 0;
  for (const tid of Array.from(unidTrackIds)) {
    if (trackToDesignated.has(tid)) transferredTrackCount += 1;
  }

  return { trackToDesignated, transferredTrackCount };
}

/**
 * Resolves a row's bird definition strictly using the transfer map when the row is unidentified.
 */
export function resolveStrictBirdDef(
  rawLabel: string | undefined,
  trackId: number | undefined,
  transferMap: Map<number, BirdDef>,
): { def: BirdDef; wasTransferred: boolean } {
  const tid = Number(trackId) || 0;
  if (isDesignatedBird(rawLabel, tid)) {
    return { def: mapBirdToDef(rawLabel, tid), wasTransferred: false };
  }
  const transferred = tid > 0 ? transferMap.get(tid) : undefined;
  if (transferred) {
    return { def: transferred, wasTransferred: true };
  }
  return { def: mapBirdToDef(rawLabel, tid), wasTransferred: false };
}
