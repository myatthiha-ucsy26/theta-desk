"""Expiry settlement for paper positions. Pure selection logic, no IO."""
import datetime as dt


def due_for_settlement(trades, today: dt.date):
    """Open trades whose expiry is strictly in the past.

    Expiry day itself is excluded: the position is live until that session closes.
    """
    out = []
    for t in trades:
        if t.get("status") != "open":
            continue
        if dt.date.fromisoformat(t["expiry"]) < today:
            out.append(t)
    return out


def settlement_close(df, expiry: str, max_gap_days: int = 5):
    """Official settlement price: the last daily close on or before `expiry`.

    Uses the price history, never a live quote. Settling at "whatever the price
    is when someone next opens the panel" drifts further from the truth every day
    the panel stays closed.

    Returns None when there is no close within `max_gap_days` before expiry --
    missing data must leave the trade open, not settle it at a stale price.
    """
    if df is None or len(df) == 0:
        return None
    exp = dt.date.fromisoformat(expiry)
    dates = [d.date() for d in df["date"]]
    closes = df["close"].tolist()
    best = None
    for d, c in zip(dates, closes):
        if d <= exp and (best is None or d > best[0]):
            best = (d, c)
    if best is None or (exp - best[0]).days > max_gap_days:
        return None
    return float(best[1])