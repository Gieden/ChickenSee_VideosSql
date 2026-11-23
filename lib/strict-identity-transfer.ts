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

export interface UnidEpisodeMatch {
  startFrame: number;
  endFrame: number;
  def: BirdDef;
}

export interface StrictTransferResult {
  /** Fallback track-level map for rows without frame numbers (e.g. aggregate bird_records) */
  trackToDesignated: Map<number, BirdDef>;
  /** Per-episode spatial matches keyed by unidentified track_id (handles reusable ID7+ slots accurately!) */
  episodesByTrack: Map<number, UnidEpisodeMatch[]>;
  /** Number of unidentified tracks with at least one resolved transfer */
  transferredTrackCount: number;
}

/**
 * Per-Episode Strict Identity Distribution & Retroactive Data Transfer:
 * Because reusable unidentified slots (ID7, ID8, ...) are shared by different birds
 * across a 1-hour video (e.g. H5 Yellow-Green flips to ID7 at 07:03, then H2 Blue
 * flips to ID7 at 07:14), we split each unidentified track into contiguous temporal
 * episodes (gap > 30 frames = new episode) and match EACH episode independently to
 * the designated bird (H1–H5 / R1) at its exact (x, y) start/end bounding box
 * (within <= 65 px and <= 25 frames).
 */
export function buildStrictIdentityTransferMap(fl: FrameLogLike): StrictTransferResult {
  const trackToDesignated = new Map<number, BirdDef>();
  const episodesByTrack = new Map<number, UnidEpisodeMatch[]>();
  const dtRows = Array.isArray(fl.detection_tracking) ? fl.detection_tracking : [];
  const birdRecords = Array.isArray(fl.bird_records) ? fl.bird_records : [];
  const behaviorEvents = Array.isArray(fl.behavior_events) ? fl.behavior_events : [];

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

  // Group detection_tracking by frame so we can split each ID7+ into contiguous spatial episodes
  const byFrame = new Map<number, Array<{ tid: number; lbl: string; x: number; y: number }>>();
  for (const row of dtRows) {
    const tid = Number(row.track_id) || 0;
    const lbl = String(row.bird_label || '');
    const frame = Number(row.frame_number) || 0;
    const x = Number(row.x_center_px) || 0;
    const y = Number(row.y_center_px) || 0;

    if (isDesignatedBird(lbl, tid)) {
      if (tid > 0) trackToDesignated.set(tid, mapBirdToDef(lbl, tid));
    } else if (tid > 0) {
      unidTrackIds.add(tid);
    }

    if (x > 0 || y > 0) {
      if (!byFrame.has(frame)) byFrame.set(frame, []);
      byFrame.get(frame)!.push({ tid, lbl, x, y });
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

  const sortedFrames = Array.from(byFrame.keys()).sort((a, b) => a - b);

  // Build contiguous episodes for every unidentified track_id
  const EPISODE_GAP_FRAMES = 30;
  const HANDOFF_FRAME_WINDOW = 25;
  const HANDOFF_MAX_DIST_PX = 65;

  for (const tid of Array.from(unidTrackIds)) {
    if (trackToDesignated.has(tid)) continue;

    const rawEpisodes: Array<{
      startFrame: number;
      endFrame: number;
      sx: number;
      sy: number;
      ex: number;
      ey: number;
    }> = [];

    let curEp: { startFrame: number; endFrame: number; sx: number; sy: number; ex: number; ey: number } | null = null;
    for (const f of sortedFrames) {
      const hit = (byFrame.get(f) || []).find((r) => r.tid === tid && !isDesignatedBird(r.lbl, r.tid));
      if (!hit) continue;
      if (!curEp || f - curEp.endFrame > EPISODE_GAP_FRAMES) {
        curEp = { startFrame: f, endFrame: f, sx: hit.x, sy: hit.y, ex: hit.x, ey: hit.y };
        rawEpisodes.push(curEp);
      } else {
        curEp.endFrame = f;
        curEp.ex = hit.x;
        curEp.ey = hit.y;
      }
    }

    const matchedEpisodes: UnidEpisodeMatch[] = [];
    const voteCounts = new Map<string, number>();

    for (const ep of rawEpisodes) {
      let bestDef: BirdDef | null = null;
      let bestScore = Infinity;

      // Search frames right before ep.startFrame and right after ep.endFrame
      for (const f of sortedFrames) {
        if (f >= ep.startFrame - HANDOFF_FRAME_WINDOW && f < ep.startFrame) {
          const gap = ep.startFrame - f;
          for (const r of byFrame.get(f) || []) {
            if (!isDesignatedBird(r.lbl, r.tid)) continue;
            const dist = Math.hypot(r.x - ep.sx, r.y - ep.sy);
            if (dist <= HANDOFF_MAX_DIST_PX) {
              const score = dist + gap * 0.5;
              if (score < bestScore) {
                bestScore = score;
                bestDef = mapBirdToDef(r.lbl, r.tid);
              }
            }
          }
        } else if (f > ep.endFrame && f <= ep.endFrame + HANDOFF_FRAME_WINDOW) {
          const gap = f - ep.endFrame;
          for (const r of byFrame.get(f) || []) {
            if (!isDesignatedBird(r.lbl, r.tid)) continue;
            const dist = Math.hypot(r.x - ep.ex, r.y - ep.ey);
            if (dist <= HANDOFF_MAX_DIST_PX) {
              const score = dist + gap * 0.5;
              if (score < bestScore) {
                bestScore = score;
                bestDef = mapBirdToDef(r.lbl, r.tid);
              }
            }
          }
        }
      }

      if (bestDef) {
        matchedEpisodes.push({ startFrame: ep.startFrame, endFrame: ep.endFrame, def: bestDef });
        voteCounts.set(bestDef.shortId, (voteCounts.get(bestDef.shortId) || 0) + 1);
      }
    }

    if (matchedEpisodes.length > 0) {
      episodesByTrack.set(tid, matchedEpisodes);
      // Set majority-vote designated bird as track-level fallback for unsampled frames
      let topShortId = matchedEpisodes[0].def.shortId;
      let topVotes = 0;
      for (const [sid, cnt] of Array.from(voteCounts.entries())) {
        if (cnt > topVotes) {
          topVotes = cnt;
          topShortId = sid;
        }
      }
      trackToDesignated.set(tid, BIRD_DEFINITIONS[topShortId as keyof typeof BIRD_DEFINITIONS]);
    }
  }

  // Fallback for any unidentified track with zero sampled spatial coordinates:
  // assign to whichever designated pen bird has the largest unobserved time gap.
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

  return { trackToDesignated, episodesByTrack, transferredTrackCount };
}

/**
 * Resolves a row's bird definition strictly using per-episode spatial handoff first
 * (when a frame number is provided), falling back to the track-level transfer map.
 */
export function resolveStrictBirdDef(
  rawLabel: string | undefined,
  trackId: number | undefined,
  transfer: StrictTransferResult | Map<number, BirdDef>,
  frameNumber?: number,
): { def: BirdDef; wasTransferred: boolean } {
  const tid = Number(trackId) || 0;
  if (isDesignatedBird(rawLabel, tid)) {
    return { def: mapBirdToDef(rawLabel, tid), wasTransferred: false };
  }

  const trackMap = transfer instanceof Map ? transfer : transfer.trackToDesignated;
  const episodesMap = transfer instanceof Map ? null : transfer.episodesByTrack;

  if (episodesMap && tid > 0 && frameNumber !== undefined && Number.isFinite(frameNumber)) {
    const eps = episodesMap.get(tid);
    if (eps && eps.length > 0) {
      // Exact overlapping episode or closest episode within +/- 150 frames (~10s)
      let bestEp: UnidEpisodeMatch | null = null;
      let bestDist = Infinity;
      for (const ep of eps) {
        if (frameNumber >= ep.startFrame - 30 && frameNumber <= ep.endFrame + 30) {
          return { def: ep.def, wasTransferred: true };
        }
        const d = Math.min(Math.abs(frameNumber - ep.startFrame), Math.abs(frameNumber - ep.endFrame));
        if (d < bestDist && d <= 150) {
          bestDist = d;
          bestEp = ep;
        }
      }
      if (bestEp) {
        return { def: bestEp.def, wasTransferred: true };
      }
    }
  }

  const transferred = tid > 0 ? trackMap.get(tid) : undefined;
  if (transferred) {
    return { def: transferred, wasTransferred: true };
  }
  return { def: mapBirdToDef(rawLabel, tid), wasTransferred: false };
}
