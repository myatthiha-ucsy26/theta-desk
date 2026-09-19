"""A thread-safe rolling-window rate limiter. stdlib only, no IO."""
import threading
import time
from collections import deque


class RateLimiter:
    """At most `max_calls` in any rolling `window` seconds.

    acquire() blocks until a slot is free and returns how long it waited. Waiting
    instead of failing means a burst of scans slows down rather than erroring.
    """

    def __init__(self, max_calls, window, clock=time.monotonic, sleep=time.sleep):
        self.max_calls = max_calls
        self.window = float(window)
        self._clock = clock
        self._sleep = sleep
        self._stamps = deque()
        self._lock = threading.Lock()

    def acquire(self):
        waited = 0.0
        while True:
            with self._lock:
                now = self._clock()
                while self._stamps and now - self._stamps[0] >= self.window:
                    self._stamps.popleft()
                if len(self._stamps) < self.max_calls:
                    self._stamps.append(now)
                    return waited
                pause = self.window - (now - self._stamps[0])
            self._sleep(pause)
            waited += pause
