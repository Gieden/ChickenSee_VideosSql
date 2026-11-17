import tempfile
import unittest
from pathlib import Path

from train import oversample_weak_saddle_images


class TestSaddleTrainingSampling(unittest.TestCase):
    def test_oversampling_is_limited_to_low_ap_saddle_classes_and_is_idempotent(self):
        class_names = {
            0: "Chicken",
            4: "Saddle_Color_Blue",
            5: "Saddle_Color_Red",
            6: "Saddle_Color_White",
            7: "Saddle_Color_Yellow",
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            image_dir = Path(temp_dir) / "images"
            label_dir = Path(temp_dir) / "labels"
            image_dir.mkdir()
            label_dir.mkdir()

            for index, class_id in enumerate((4, 5, 6, 7)):
                image_name = f"bird_{index}.jpg"
                (image_dir / image_name).write_bytes(b"image")
                (label_dir / f"bird_{index}.txt").write_text(
                    f"{class_id} 0.5 0.5 0.2 0.2\n",
                    encoding="utf-8",
                )

            self.assertEqual(
                oversample_weak_saddle_images(str(image_dir), str(label_dir), class_names),
                3,
            )
            self.assertEqual(
                oversample_weak_saddle_images(str(image_dir), str(label_dir), class_names),
                3,
            )
            self.assertEqual(len(list(image_dir.glob("*.jpg"))), 7)
            self.assertEqual(len(list(label_dir.glob("*.txt"))), 7)
            self.assertTrue((image_dir / "bird_3.jpg").is_file())


if __name__ == "__main__":
    unittest.main()
