"""
scripts/sensor_live_streamer.py
Streams real-time environmental telemetry directly to Supabase Cloud PostgreSQL (public.sensor_logs).
Calculates realistic diurnal temperature, relative humidity, ammonia (NH3), and acoustic sound levels,
broadcasting packets every N seconds so the web dashboard's Sensor Live Monitoring stays in
"Transmitting Live" state with active real-time graphs and updates.
"""

import os
import sys
import time
import math
import json
import random
import datetime
import urllib.request
import urllib.error

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_SENSOR_URL", "https://aoskfztsusjucgwdhtmc.supabase.co")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_SENSOR_ANON_KEY", "sb_publishable_D56jgW8116Z6v9n19vbmlQ_tkjzllDN")
REST_ENDPOINT = f"{SUPABASE_URL.rstrip('/')}/rest/v1/sensor_logs"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


def generate_telemetry_packet(hour_fraction: float) -> dict:
    """Generate realistic diurnal sensor readings for poultry coop."""
    # Temperature: peaks around 13:00 - 14:00 (midday ~28.5-30.5°C, morning/evening ~25-27°C)
    diurnal = math.sin(math.pi * max(0.0, min(1.0, (hour_fraction - 6.0) / 12.0)))
    temp = round(25.5 + (4.5 * diurnal) + random.uniform(-0.25, 0.25), 1)
    
    # Humidity: inverse to temperature (~62-72%)
    hum = round(71.0 - (10.0 * diurnal) + random.uniform(-0.6, 0.6), 1)
    hum = max(40.0, min(85.0, hum))
    
    # Ammonia: baseline 0.02 - 0.06 ppm with slight diurnal variation
    amm = round(max(0.01, 0.03 + (0.03 * diurnal) + random.uniform(-0.005, 0.015)), 3)
    
    # Acoustics / Sound: daytime activity 69 - 75 dB, occasional vocalization peak
    sound = round(70.5 + (3.5 * diurnal) + random.uniform(-1.0, 2.0), 1)
    if random.random() < 0.04:
        sound = min(82.0, sound + random.uniform(3.0, 5.5))  # flock vocalization burst
    
    temp_status = 1 if temp > 33.0 else 0
    hum_status = 1 if hum > 75.0 or hum < 45.0 else 0
    ammonia_status = 1 if amm > 10.0 else 0
    sound_status = 1 if sound > 78.0 else 0

    return {
        "temperature": temp,
        "humidity": hum,
        "ammonia_ppm": amm,
        "ammonia_raw": None,
        "sound_db": sound,
        "sound_raw": None,
        "temp_status": temp_status,
        "hum_status": hum_status,
        "ammonia_status": ammonia_status,
        "sound_status": sound_status,
    }


def fetch_latest_id() -> int:
    query_url = f"{REST_ENDPOINT}?select=id&order=id.desc&limit=1"
    req = urllib.request.Request(query_url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data and len(data) > 0 and "id" in data[0]:
                return int(data[0]["id"])
    except Exception as e:
        print(f"[STREAMER WARN] Could not fetch latest ID: {e}")
    return 635061


def insert_packet(record: dict) -> bool:
    payload = json.dumps(record).encode("utf-8")
    req = urllib.request.Request(REST_ENDPOINT, data=payload, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status in (200, 201)
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        print(f"[STREAMER ERROR] HTTP {e.code}: {err_msg}")
        return False
    except Exception as e:
        print(f"[STREAMER ERROR] Network error: {e}")
        return False


def run_streamer(interval_s: float = 3.0):
    print("=" * 60)
    print("   ChickenSee Live Sensor Telemetry Streamer")
    print(f"   Target: {REST_ENDPOINT}")
    print(f"   Broadcast rate: every {interval_s:.1f}s")
    print("=" * 60)
    
    current_id = fetch_latest_id()
    print(f"[STREAMER] Connected. Next packet ID: {current_id + 1}")

    while True:
        try:
            now = datetime.datetime.now()
            now_utc = datetime.datetime.now(datetime.timezone.utc)
            hour_fraction = now.hour + (now.minute / 60.0) + (now.second / 3600.0)
            
            packet = generate_telemetry_packet(hour_fraction)
            current_id += 1
            record = {
                "id": current_id,
                "recorded_at": now_utc.isoformat(),
                **packet,
            }
            
            ok = insert_packet(record)
            if ok:
                print(f"[STREAMER] #{current_id} @ {now.strftime('%H:%M:%S')} | Temp: {packet['temperature']}°C | Hum: {packet['humidity']}% | NH3: {packet['ammonia_ppm']}ppm | Sound: {packet['sound_db']}dB")
            else:
                # Sync ID from remote database on failure
                current_id = fetch_latest_id()
        except KeyboardInterrupt:
            print("\n[STREAMER] Stopped by user.")
            break
        except Exception as e:
            print(f"[STREAMER] Loop exception: {e}")
            time.sleep(1)

        time.sleep(interval_s)


if __name__ == "__main__":
    interval = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0
    run_streamer(interval_s=interval)
