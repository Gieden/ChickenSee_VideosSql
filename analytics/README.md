# ZAMPEN Native Layer Chicken Behavior & Sensor Analytics Pipeline

Automated edge behavior-analysis and sensor-aggregation pipeline for the **"Vision-Based Identification and Behavior Monitoring of ZAMPEN Native Layer Chickens"** capstone project.

Designed and optimized for local edge deployment on a **Dell OptiPlex server**, using strictly **Ultralytics YOLO26 Nano (`yolo26n.pt`)** paired with the **ByteTrack** multi-object tracking algorithm (`bytetrack.yaml`).

---

## Architecture Overview

```
                      PRODUCER LAYER (Existing / Hardware)
  ┌────────────────────────────────────────────────────────────────────────┐
  │  • Video Recorder: Writes 1-hour .mp4 segments (e.g. 06:00 to 07:00)   │
  │  • Sensor Hub: Logs environment readings to SQLite (chicken_telemetry) │
  └──────────────────────────────────┬─────────────────────────────────────┘
                                     │ (1-Hour Rolling Delay)
                                     ▼
                   ANALYSIS & AGGREGATION LAYER (Worker Daemon)
  ┌────────────────────────────────────────────────────────────────────────┐
  │  • Ingests completed 1-hour MP4 & matching SQL range with 1-hr lag     │
  │  • Splits 1-hour block into two 30-Minute Chunks:                      │
  │      Chunk 1: 06:00:00 - 06:30:00  |  Chunk 2: 06:30:00 - 07:00:00     │
  │  • Computes 30-min rolling sensor averages (Temp, RH, NH3, Lux, THI)   │
  │  • Runs YOLO26 Nano (yolo26n.pt) + ByteTrack persistent inference      │
  │  • Quantifies Behaviors:                                               │
  │      1. Reduce Eating  |  2. Drinking  |  3. Inactivity  |  4. Pecking │
  │  • Persists to SQLite / SQLAlchemy (zampen_analytics.db)               │
  └──────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
                    API CONSUMER LAYER (FastAPI Wrapper)
  ┌────────────────────────────────────────────────────────────────────────┐
  │  • GET /health         → Worker status, CPU/RAM, model availability    │
  │  • GET /results/latest → Most recent hourly block & two 30-min chunks  │
  │  • GET /results/range  → Historical 30-min metrics by timestamp query  │
  │  • GET /jobs           → Queue states (QUEUED, PROCESSING, COMPLETED)  │
  └────────────────────────────────────────────────────────────────────────┘
```

---

## Specific Behavior Detection Logic

Using persistent ByteTrack IDs (`track_id`) and spatial bounding boxes:

### 1. Reduce Eating
* **Spatial Condition**: Chicken bounding box coordinates intersect or lie within designated feeder zones ($d_{\text{feeder}} \le 95\text{ px}$).
* **Kinematic Condition**: Localized pecking motion / head displacement jitter is monitored:
  $$\Delta(x, y) = \frac{\sqrt{(x_t - x_{t-1})^2 + (y_t - y_{t-1})^2}}{\Delta t} < 4.0\text{ px/s}$$
* **Detection Metric**: When a bird stays in the feeder zone without active pecking motion for prolonged durations, a **Reduce Eating** event is recorded. The **Reduced Eating Index** represents the percentage of feeding bouts exhibiting abnormal low intake.

### 2. Drinking
* **Spatial Condition**: Chicken bounding box enters within designated drinker / waterer zones ($d_{\text{waterer}} \le 95\text{ px}$).
* **Detection Metric**: Measures total accumulated duration ($s$) and discrete bout counts per bird, calculating the flock drinking frequency per bird.

### 3. Inactivity / Lethargy
* **Kinematic Condition**: Centroid displacement velocity below resting threshold ($\Delta(x, y) < 3.5\text{ px/s}$).
* **Detection Metric**: Tracks sustained continuous inactivity:
  $$T_{\text{stationary}} \ge 180.0\text{ seconds}$$
* Computes flock inactivity percentage ($T_{\text{inactive}} / T_{\text{monitored}} \times 100$) and triggers individual lethargy alerts for birds exceeding inactivity thresholds.

### 4. Feather Pecking
* **Interaction Condition**: Detects sudden aggressive interactions between tracked chicken pairs:
  1. Aggressor bird initiates high-velocity approach ($\ge 48.0\text{ px/s}$).
  2. Bounding box distance drops rapidly into close proximity ($d_{\text{inter-bird}} \le 45\text{ px}$ or IoU overlap spike).
  3. Victim bird exhibits sudden escape acceleration burst ($\ge 40.0\text{ px/s}$).
* **Detection Metric**: Counts discrete feather pecking conflict events and logs aggressor vs. victim ID tags.

---

## Folder Layout

```
analytics/
├── README.md                 # Complete system documentation
├── config.py                 # Thresholds, paths, and pipeline parameters
├── database.py               # SQLAlchemy ORM models & job state manager
├── tracker.py                # YOLO26 Nano + ByteTrack inference engine
├── behavior_engine.py        # Spatial behavior quantification engine
├── worker.py                 # 1-hour lag polling loop & 30-min chunk daemon
├── api.py                    # FastAPI REST endpoints
├── requirements.txt          # Pinned dependencies
├── bootstrap.ps1             # 1-Click Windows PowerShell launcher
├── bootstrap.sh              # 1-Click Linux / WSL launcher
├── Dockerfile                # Containerized OptiPlex deployment
├── docker-compose.yml        # Docker Compose service definition
└── tests/
    └── test_analytics.py     # Automated unit & integration tests
```

---

## 1-Click Quickstart on Dell OptiPlex

### Method 1: Windows PowerShell (Native)

Open PowerShell inside the repository folder and execute:

```powershell
cd c:\Users\Kairi\Documents\ChickenSee_Videos(sql)\analytics
.\bootstrap.ps1
```

The bootstrap script will automatically:
1. Verify Python 3.10+ installation.
2. Install / verify dependencies (`ultralytics`, `fastapi`, `sqlalchemy`, `opencv-python`, etc.).
3. Verify `yolo26n.pt` weights and `bytetrack.yaml` tracker configuration.
4. Initialize the SQLite database schema (`zampen_analytics.db`).
5. Launch both the FastAPI API server and the Background Worker Daemon.

---

### Method 2: Docker Compose

For isolated containerized execution:

```bash
cd analytics
docker compose up -d --build
```

---

## REST API Documentation

Once started, the interactive OpenAPI documentation is available at:
👉 **`http://localhost:8000/docs`**

### 1. System Health
```http
GET /health
```
**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-10-14T18:30:00Z",
  "uptime_s": 124.5,
  "system": {
    "cpu_percent": 14.2,
    "ram_used_mb": 2180.4,
    "ram_total_mb": 16384.0,
    "active_processing_job": null
  },
  "model": {
    "detector": "yolo26n.pt",
    "tracker": "bytetrack_poultry.yaml",
    "device": "cpu"
  }
}
```

### 2. Fetch Latest 30-Minute Chunks
```http
GET /results/latest
```
**Response:**
```json
{
  "job_id": 1,
  "video_filename": "detection_2026-10-14_0600.mp4",
  "date": "2026-10-14",
  "hour_slot": "06:00",
  "chunks_30m": [
    {
      "chunk_index": 1,
      "start_time": "2026-10-14T06:00:00",
      "end_time": "2026-10-14T06:30:00",
      "sensors": {
        "temp_avg_c": 28.4,
        "humidity_avg_pct": 68.2,
        "ammonia_ppm_avg": 7.8,
        "lux_avg": 350.0,
        "thi_avg": 77.8,
        "heat_stress_level": "Moderate"
      },
      "behaviors": {
        "unique_birds": 6,
        "avg_birds_present": 5.8,
        "feeding_time_total_s": 420.5,
        "feeding_bouts": 18,
        "reduced_eating_events": 2,
        "reduced_eating_index_pct": 11.1,
        "drinking_time_total_s": 145.2,
        "drinking_bouts": 12,
        "inactivity_pct": 32.4,
        "lethargic_birds_flagged": 0,
        "feather_pecking_events": 3,
        "agitation_score": 0.5,
        "flock_mobility_px_s": 18.6
      }
    },
    {
      "chunk_index": 2,
      "start_time": "2026-10-14T06:30:00",
      "end_time": "2026-10-14T07:00:00",
      "sensors": { ... },
      "behaviors": { ... }
    }
  ]
}
```

### 3. Historical Range Query
```http
GET /results/range?start=2026-10-14T06:00:00&end=2026-10-14T18:00:00
```
Returns a chronological list of 30-minute interval blocks across the selected day or date range.

---

## Running Verification Tests

Run the included automated self-test suite:

```powershell
python -m unittest analytics/tests/test_analytics.py
```
Validates database leasing, behavior kinematics, reduce eating, drinking, inactivity, feather pecking, and FastAPI endpoints.
