import { NextRequest, NextResponse } from 'next/server';
import { list } from '@vercel/blob';
import { AUTH_COOKIE_NAME, verifySessionToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface AnalysisChunk {
  chunk_index: number;
  chunk_start: string;
  chunk_end: string;
  unique_birds_tracked: number;
  feeding_bouts: number;
  drinking_bouts: number;
  inactivity_pct: number;
  lethargic_birds_flagged: number;
  feather_pecking_events: number;
  flock_mobility_px_s: number;
  temp_avg_c: number | null;
  humidity_avg_pct: number | null;
}

interface AnalysisFile {
  job_id: number;
  source_video: string;
  processed_at: string;
  detected_video: string | null;
  chunks: AnalysisChunk[];
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [{ blobs: resultFiles }, { blobs: videoFiles }] = await Promise.all([
      list({ prefix: 'results/' }),
      list({ prefix: 'videos/' }),
    ]);
    const resultBlobs = resultFiles
      .filter((blob) => blob.pathname.toLowerCase().endsWith('.json'))
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
      .slice(0, 50);
    const videoByPath = new Map(videoFiles.map((blob) => [blob.pathname, blob]));

    const results = await Promise.all(resultBlobs.map(async (blob) => {
      const response = await fetch(blob.url);
      if (!response.ok) {
        throw new Error(`Failed to download ${blob.pathname}: HTTP ${response.status}`);
      }
      const analysis = await response.json() as AnalysisFile;
      const expectedVideoName = analysis.source_video.replace(/\.[^.]+$/, '') + '_detected.mp4';
      const detectedVideo = videoByPath.get(`videos/${expectedVideoName}`);

      return (analysis.chunks || []).map((chunk) => ({
        result_id: `${blob.pathname}:${chunk.chunk_index}`,
        job_id: analysis.job_id,
        video_file: expectedVideoName,
        interval_label: `${new Date(chunk.chunk_start).toLocaleString()} – ${new Date(chunk.chunk_end).toLocaleTimeString()}`,
        processed_at: analysis.processed_at,
        bird_count: chunk.unique_birds_tracked,
        eating_count: chunk.feeding_bouts,
        drinking_count: chunk.drinking_bouts,
        inactive_count: chunk.lethargic_birds_flagged,
        inactivity_pct: chunk.inactivity_pct,
        feather_pecking_count: chunk.feather_pecking_events,
        avg_velocity: chunk.flock_mobility_px_s,
        temp_avg: chunk.temp_avg_c,
        humidity_avg: chunk.humidity_avg_pct,
        result_file: blob.pathname.replace(/^results\//, ''),
        detected_video: detectedVideo?.pathname.replace(/^videos\//, '') ?? null,
      }));
    }));

    return NextResponse.json({ results: results.flat() });
  } catch (error) {
    console.error('Failed to load analysis results:', error);
    return NextResponse.json({ error: 'Failed to load analysis results' }, { status: 500 });
  }
}
