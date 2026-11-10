import cv2
from analytics.tracker import ZampenYOLOTracker

tracker = ZampenYOLOTracker()
tracker.imgsz = 1088
tracker.MIN_DETECTION_CONFIDENCE = 0.30
tracker.MIN_SADDLE_CONFIDENCE = 0.15

cap = cv2.VideoCapture(r'C:\Users\Kairi\Documents\chicks\test\cam01\video.mp4')
ret, frame = cap.read()
cap.release()

output = tracker.process_frame(frame, 0, 15.0)
print(f"Total birds detected: {len(output.birds)}")
for b in output.birds:
    print(f"  Box={b.box}, Track={b.track_id}, Label={b.bird_label}, Conf={b.confidence:.2f}")

print(f"Feeders: {len(output.feeders)}, Drinkers: {len(output.drinkers)}")
