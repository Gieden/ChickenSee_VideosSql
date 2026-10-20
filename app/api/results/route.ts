import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, verifySessionToken } from '@/lib/auth';
import { downloadStorageFile, listStorageFiles } from '@/lib/supabase-storage';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface AnalysisChunk {
  chunk_index: number;
  chunk_start: string;
  chunk_end: string;
  unique_birds_tracked: number;
  avg_birds_in_frame: number;
  feeding_bouts: number;
  feeding_time_total_s: number;
  reduced_eating_events: number;
  reduced_eating_index: number;
  drinking_bouts: number;
  drinking_time_total_s: number;
  inactivity_pct: number;
  inactivity_time_total_s: number;
  lethargic_birds_flagged: number;
  feather_pecking_events: number;
  agitation_score: number;
  flock_mobility_px_s: number;
  temp_min_c: number | null;
  temp_avg_c: number | null;
  temp_max_c: number | null;
  humidity_min_pct: number | null;
  humidity_avg_pct: number | null;
  humidity_max_pct: number | null;
  ammonia_ppm_avg: number | null;
  ammonia_ppm_max: number | null;
  lux_avg: number | null;
  thi_avg: number | null;
  heat_stress_level: string | null;
  sensor_data_available: boolean;
  sound_avg_db?: number | null;
  sound_db_avg?: number | null;
  bird_records?: BirdRecord[];
}

interface BirdRecord {
  track_id: number;
  bird_label: string;
  bird_type: string;
  feeding_s: number;
  feeding_bouts: number;
  reduced_eating_flag: number;
  drinking_s: number;
  drinking_bouts: number;
  inactivity_s: number;
  is_lethargic: number;
  pecking_aggressor_count: number;
  pecking_victim_count: number;
  avg_velocity_px_s: number;
}

interface AnalysisFile {
  job_id: number;
  source_video: string;
  processed_at: string;
  detected_video: string | null;
  chunks: AnalysisChunk[];
  bird_records?: BirdRecord[][];
}

function parseAnalysisChunks(analysis: AnalysisFile, fileName: string, detectedVideoName: string | null = null) {
  return (analysis.chunks || []).map((chunk, index) => {
    const sensorsAvailable = chunk.sensor_data_available === true;

    return {
      result_id: `${fileName}:${chunk.chunk_index}`,
      job_id: analysis.job_id,
      video_file: analysis.source_video,
      interval_label: `${new Date(chunk.chunk_start).toLocaleString()} – ${new Date(chunk.chunk_end).toLocaleTimeString()}`,
      chunk_start: chunk.chunk_start,
      chunk_end: chunk.chunk_end,
      processed_at: analysis.processed_at,
      bird_count: chunk.unique_birds_tracked,
      avg_birds_in_frame: chunk.avg_birds_in_frame,
      eating_count: chunk.feeding_bouts,
      feeding_time_s: chunk.feeding_time_total_s,
      reduced_eating_events: chunk.reduced_eating_events,
      reduced_eating_index_pct: chunk.reduced_eating_index == null
        ? null
        : Number((chunk.reduced_eating_index * 100).toFixed(1)),
      drinking_count: chunk.drinking_bouts,
      drinking_time_s: chunk.drinking_time_total_s,
      inactive_count: chunk.lethargic_birds_flagged,
      inactivity_pct: chunk.inactivity_pct,
      inactivity_time_s: chunk.inactivity_time_total_s,
      feather_pecking_count: chunk.feather_pecking_events,
      agitation_score: chunk.agitation_score,
      avg_velocity: chunk.flock_mobility_px_s,
      temp_avg: sensorsAvailable ? chunk.temp_avg_c : null,
      temp_min: sensorsAvailable ? chunk.temp_min_c : null,
      temp_max: sensorsAvailable ? chunk.temp_max_c : null,
      humidity_avg: sensorsAvailable ? chunk.humidity_avg_pct : null,
      humidity_min: sensorsAvailable ? chunk.humidity_min_pct : null,
      humidity_max: sensorsAvailable ? chunk.humidity_max_pct : null,
      ammonia_avg: sensorsAvailable ? chunk.ammonia_ppm_avg : null,
      ammonia_max: sensorsAvailable ? chunk.ammonia_ppm_max : null,
      lux_avg: sensorsAvailable ? chunk.lux_avg : null,
      thi_avg: sensorsAvailable ? chunk.thi_avg : null,
      sound_avg_db: sensorsAvailable
        ? chunk.sound_avg_db ?? chunk.sound_db_avg ?? null
        : null,
      heat_stress_level: sensorsAvailable
        ? chunk.heat_stress_level
        : 'Unavailable',
      sensor_data_available: sensorsAvailable,
      bird_records: chunk.bird_records ?? analysis.bird_records?.[index] ?? [],
      result_file: fileName,
      detected_video: detectedVideoName,
    };
  });
}

function loadLocalResults(): any[] {
  const candidateDirs = [
    '/tmp/results',
    path.join(process.cwd(), 'data', 'results'),
    path.join(process.env.CHICKENSEE_LOCAL_STORAGE || 'C:/Users/Kairi/Documents/ChickenSee_Local_Storage', 'results'),
  ];

  const filesFound = new Map<string, string>(); // filename -> fullPath
  for (const dir of candidateDirs) {
    try {
      if (fs.existsSync(dir)) {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          if (entry.toLowerCase().endsWith('.json') && !entry.includes('queue_status')) {
            if (!filesFound.has(entry)) {
              filesFound.set(entry, path.join(dir, entry));
            }
          }
        }
      }
    } catch {
      // Continue to next directory
    }
  }

  const allChunks: any[] = [];
  filesFound.forEach((fullPath, filename) => {
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const analysis = JSON.parse(raw) as AnalysisFile;
      const expectedVideoName = analysis.source_video?.replace(/\.[^.]+$/, '') + '_detected.mp4';
      const chunks = parseAnalysisChunks(analysis, filename, expectedVideoName);
      allChunks.push(...chunks);
    } catch (parseErr) {
      console.warn(`Failed to parse local result file ${filename}:`, parseErr);
    }
  });

  return allChunks;
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 1. Try Supabase Storage first
  try {
    const resultFiles = await listStorageFiles('results');
    const resultObjects = resultFiles
      .filter((file) => file.pathname.toLowerCase().endsWith('.json') && file.pathname !== 'queue_status.json')
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
      .slice(0, 50);

    if (resultObjects.length > 0) {
      const results = await Promise.all(resultObjects.map(async (file) => {
        const content = await downloadStorageFile(file.storagePath);
        const analysis = JSON.parse(await content.text()) as AnalysisFile;
        const fileName = file.pathname;
        return parseAnalysisChunks(analysis, fileName);
      }));

      const flattenedResults = results.flat().sort(
        (first, second) =>
          new Date(second.chunk_start).getTime() - new Date(first.chunk_start).getTime(),
      );

      return NextResponse.json({ results: flattenedResults });
    }
  } catch (error) {
    console.error('Supabase Storage results check failed:', error);
    return NextResponse.json(
      { error: 'Failed to load analysis results from Supabase Storage' },
      { status: 503 },
    );
  }

  if (process.env.VERCEL) {
    return NextResponse.json({ results: [] });
  }

  // 2. Fallback to bundled / local results
  try {
    const localResults = loadLocalResults();
    localResults.sort(
      (first, second) =>
        new Date(second.chunk_start).getTime() - new Date(first.chunk_start).getTime(),
    );

    return NextResponse.json({ results: localResults });
  } catch (fallbackError) {
    console.error('Failed to load fallback analysis results:', fallbackError);
    return NextResponse.json({ results: [] });
  }
}
