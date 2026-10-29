import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SENSOR_URL, SUPABASE_SENSOR_ANON_KEY } from '@/lib/supabase-sensor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

    const { data, error, count } = await client
      .from('sensor_logs')
      .select('id, recorded_at, temperature, humidity, ammonia_ppm, ammonia_raw, sound_db, sound_raw, temp_status, hum_status, ammonia_status, sound_status', { count: 'exact' })
      .order('id', { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({
        success: false,
        error: error.message,
        table: 'sensor_logs',
        isServiceRole,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: data || [],
      totalCount: count ?? data?.length ?? 0,
      isServiceRole,
      table: 'sensor_logs',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
