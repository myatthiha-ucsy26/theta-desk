"""Where runtime data lives.

Caches and the database sit at the repo root, not inside the package, so that
installing the package never mixes generated files in with the source and a
clean checkout has an obvious place to delete.

Everything under DATA, KLINES and IV_HISTORY is derived from OpenD and safe to
remove; it is rebuilt on the next run.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DATA = os.path.join(ROOT, "data")
KLINES = os.path.join(ROOT, "klines_cache")
IV_HISTORY = os.path.join(ROOT, "iv_history")
FRONTEND_DIST = os.path.join(ROOT, "frontend", "dist")
