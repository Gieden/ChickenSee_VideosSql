"""Run the ChickenSee Python test suite (analytics pipeline + edge Re-ID)."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from analytics.tests import test_analytics, test_legband  # noqa: E402
from edge.tests import test_reid  # noqa: E402

if __name__ == "__main__":
    loader = unittest.defaultTestLoader
    suite = unittest.TestSuite(
        [
            loader.loadTestsFromModule(test_analytics),
            loader.loadTestsFromModule(test_legband),
            loader.loadTestsFromModule(test_reid),
        ]
    )
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
