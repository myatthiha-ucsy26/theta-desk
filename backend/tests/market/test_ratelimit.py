import threading

from theta.market import ratelimit


class FakeClock:
    def __init__(self):
        self.now = 1000.0
        self.slept = []

    def clock(self):
        return self.now

    def sleep(self, seconds):
        self.slept.append(round(seconds, 6))
        self.now += seconds


def limiter(max_calls=3, window=30.0):
    fc = FakeClock()
    return ratelimit.RateLimiter(max_calls, window, clock=fc.clock, sleep=fc.sleep), fc


def test_calls_under_the_limit_never_wait():
    rl, fc = limiter()
    for _ in range(3):
        assert rl.acquire() == 0.0
    assert fc.slept == []


def test_call_over_the_limit_waits_until_the_oldest_leaves_the_window():
    rl, fc = limiter()
    rl.acquire()                 # t=1000
    fc.now += 10; rl.acquire()   # t=1010
    fc.now += 5;  rl.acquire()   # t=1015
    waited = rl.acquire()        # t=1015: must wait until 1030
    assert waited == 15.0
    assert fc.now == 1030.0


def test_window_is_rolling_not_fixed():
    rl, fc = limiter(max_calls=2, window=30.0)
    rl.acquire()                 # t=1000
    fc.now += 29; rl.acquire()   # t=1029
    fc.now += 2                  # t=1031: first call has left the window
    assert rl.acquire() == 0.0
    assert rl.acquire() == 28.0  # second call (1029) leaves at 1059


def test_threads_never_exceed_the_limit():
    """The engine thread and Flask requests share one OpenD connection."""
    import time
    rl = ratelimit.RateLimiter(5, 0.3)
    stamps, lock = [], threading.Lock()

    def worker():
        for _ in range(4):
            rl.acquire()
            with lock:
                stamps.append(time.monotonic())

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    stamps.sort()
    assert len(stamps) == 16
    for i in range(len(stamps) - 5):
        assert stamps[i + 5] - stamps[i] >= 0.3 - 0.02
