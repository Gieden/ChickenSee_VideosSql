import sqlite3

conn = sqlite3.connect("analytics/zampen_analytics.db")
c = conn.cursor()
cols = [r[1] for r in c.execute("PRAGMA table_info(bird_track_metrics)").fetchall()]
print("Cols:", cols)

rows = c.execute("SELECT bird_label, track_id, COUNT(*) FROM bird_track_metrics GROUP BY bird_label, track_id").fetchall()
print("Labels and counts:")
for r in rows:
    print(" ", r)

conn.close()
