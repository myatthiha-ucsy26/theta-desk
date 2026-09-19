"""Real moomoo account balances via OpenD. READ-ONLY: queries only, never unlocks or orders.

The real account lives under one broker entity (moomoo Malaysia here); override with
MOOMOO_SECURITY_FIRM if it moves.
"""
import os
from futu import OpenSecTradeContext, TrdMarket, TrdEnv, SecurityFirm, Currency, RET_OK

from theta.market import data as market_data

SECURITY_FIRM = getattr(SecurityFirm, os.environ.get("MOOMOO_SECURITY_FIRM", "FUTUMY"))

_ctx = None


def ctx():
    global _ctx
    if _ctx is None:
        _ctx = OpenSecTradeContext(filter_trdmarket=TrdMarket.US, host=market_data.HOST,
                                   port=market_data.PORT, security_firm=SECURITY_FIRM)
    return _ctx


def summarize(acc, positions):
    """Headline figures from OpenD's accinfo and position frames.

    The account-level unrealized_pl is often "N/A", so sum each position's P&L instead.
    """
    row = acc.iloc[0]
    valid = positions[positions["pl_val_valid"].astype(bool)] if len(positions) else positions
    return {
        "net_value": float(row["total_assets"]),
        "cash": float(row["cash"]),
        "buying_power": float(row["power"]),
        "unrealized_pl": round(float(valid["pl_val"].sum()), 2) if len(valid) else 0,
        "open_count": len(positions),
        "currency": str(row["currency"]),
    }


def fetch():
    ret, acc = ctx().accinfo_query(trd_env=TrdEnv.REAL, currency=Currency.USD)
    if ret != RET_OK:
        raise RuntimeError(f"accinfo_query failed: {acc}")
    ret, positions = ctx().position_list_query(trd_env=TrdEnv.REAL)
    if ret != RET_OK:
        raise RuntimeError(f"position_list_query failed: {positions}")
    return summarize(acc, positions)
