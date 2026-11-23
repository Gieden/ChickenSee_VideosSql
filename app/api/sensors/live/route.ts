import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SENSOR_URL, SUPABASE_SENSOR_ANON_KEY } from '@/lib/supabase-sensor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RETENTION_HOURS = 24;
const PRUNE_INTERVAL_MS = 10 * 60 * 1000; // Check & prune previous-day data every 10 minutes
let lastPruneTimestamp = 0;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(250, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));

    // Prefer dedicated sensor service role key if explicitly provided,
    // otherwise use the publishable/anon key. Do NOT use the default
    // SUPABASE_SERVICE_ROLE_KEY as that belongs to the video storage project.
    const serviceRoleKey = process.env.SUPABASE_SENSOR_SERVICE_ROLE_KEY?.trim();
    const activeKey = serviceRoleKey || SUPABASE_SENSOR_ANON_KEY;
    const isServiceRole = Boolean(serviceRoleKey);

    const client = createClient(SUPABASE_SENSOR_URL, activeKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const cutoff24hIso = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000).toISOString();

    // Automatically prune previous-day records (>24h old) periodically to prevent full storage
    if (Date.now() - lastPruneTimestamp > PRUNE_INTERVAL_MS) {
      lastPruneTimestamp = Date.now();
      void client
        .from('sensor_logs')
        .delete()
        .lt('recorded_at', cutoff24hIso)
        .then(() => {}, () => {});
    }

    // Query current day / last 24h live readings first (matching Supabase sensor_logs schema)
    const SENSOR_COLS = 'id, recorded_at, temperature, humidity, ammonia_ppm, sound_db';
    let { data, error } = await client
      .from('sensor_logs')
      .select(SENSOR_COLS)
      .gte('recorded_at', cutoff24hIso)
      .order('id', { ascending: false })
      .limit(limit);

    // If no readings were streamed in the last 24h, fall back to the most recent rows as-is
    if (!error && (!data || data.length === 0)) {
      const fallback = await client
        .from('sensor_logs')
        .select(SENSOR_COLS)
        .order('id', { ascending: false })
        .limit(limit);
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      return NextResponse.json({
        success: false,
        error: error.message,
        table: 'sensor_logs',
        isServiceRole,
      }, { status: 500 });
    }

    return NextResponse.json(
      {
        success: true,
        data: data || [],
        totalCount: data?.length ?? 0,
        retentionHours: RETENTION_HOURS,
        isServiceRole,
        table: 'sensor_logs',
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
        },
      },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const serviceRoleKey = process.env.SUPABASE_SENSOR_SERVICE_ROLE_KEY?.trim();
    const activeKey = serviceRoleKey || SUPABASE_SENSOR_ANON_KEY;
    const client = createClient(SUPABASE_SENSOR_URL, activeKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const cutoff24hIso = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000).toISOString();
    const { error, count } = await client
      .from('sensor_logs')
      .delete({ count: 'exact' })
      .lt('recorded_at', cutoff24hIso);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      success: true,
      prunedBefore: cutoff24hIso,
      deletedCount: count ?? 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
