# Paper and live accounts

## The problem

Before this, "paper trading" meant a notebook. You recorded a trade by hand from
the Size drawer, it went into `positions`, and nothing automated ever touched
it. Separately, `mode: auto` handed engine decisions to the monitor, which
placed **real orders** on OpenD and wrote them to `live_trades`.

Those two things never met. The consequence: the bot could only ever be
exercised with real money. Entry, repricing, the exit rules, the 60-second
monitor loop and reconciliation had unit tests and nothing else.

## The model

A new `account_mode` setting selects which broker the bot trades through. The
existing `mode` setting still means "is the bot running at all", so the two
compose:

| | `mode: manual` | `mode: auto` |
|---|---|---|
| `account_mode: paper` | notebook only | **the bot runs against simulated fills** |
| `account_mode: live` | real account visible, nothing trades | real money |

Typing `LIVE` and passing pre-flight is required only to reach **live + auto**.

### Naming

Three separate things were already called "mode", so the new one takes a
distinct name rather than deepening the collision:

| Name | Values | Means |
|---|---|---|
| `account_mode` | `paper` \| `live` | Which broker the bot trades through |
| `mode` | `manual` \| `auto` | Whether the bot is running |
| a trade row's `mode` | `ivrich` \| `meanrev` \| `trend` | Which strategy fired |

## PaperBroker

`theta/broker/paper.py` implements the same interface as `theta/broker/client.py`:
`place_spread`, `reprice`, `cancel`, `order`, `open_bot_orders`, `positions`,
`buying_power`, `fees`, `unlock`. Nothing in `engine/` changes —
`services.bot_services()` simply hands the monitor a different broker depending
on `account_mode`.

### Fills are limit-aware

A simulated order does not fill on request. `place_spread` records it as
pending; each `order()` poll reads live quotes and fills only when the market
supports the limit:

- **opening** (selling the spread) fills when the net **bid** ≥ the limit price
- **closing** (buying it back) fills when the net **ask** ≤ the limit price

Otherwise it stays pending, and the bot's existing reprice, timeout and cancel
logic has to earn the fill. This is the point: those paths are the ones most
likely to be wrong in production, and a broker that always fills would never
exercise them. It also keeps paper P&L honest, because no fill happens at a
price the market was not showing.

Quotes come from `theta.market.data.quotes`, injected rather than imported, so
the tests drive the fill model directly.

### Fees

`paper_fee_per_contract` is charged per leg per contract, on entry and again on
exit. Without it a 50%-take-profit rule on $0.30 credits looks far better on
paper than it can be live, because fees are a large fraction of a small credit.

### State

Simulated orders live in a `paper_orders` table rather than in memory: the
monitor polls across ticks and the process restarts.

`buying_power()` reports `paper_starting_cash` minus the risk currently
deployed in the paper account.

## Storage

`live_trades` and `positions` each carry an `account` column. Every query that
could otherwise total simulated and real money together takes `account` as a
**required keyword argument** — forgetting it is a `TypeError`, not a silently
wrong number.

The column defaults (`'live'` on `live_trades`, `'paper'` on `positions`) exist
for migration only: rows written before this change are exactly what those
defaults say they are.

### Migration

`init()` was `CREATE TABLE IF NOT EXISTS` only, which does nothing to a table
that already exists. `_migrate(conn)` reads `PRAGMA table_info` and adds
whatever columns are missing, so an existing `engine.db` keeps its history.

## Switching accounts

Switching **live → paper while any live trade is open is refused**, and the
error names the open positions. The monitor is the only thing that closes a
position; letting the switch strand a funded position with nothing watching it
would be the single most dangerous thing this program could do.

Switching paper → live is governed by the existing `LIVE` confirmation and
pre-flight check.

In paper mode the pre-flight's OpenD and trading-unlock checks are reported as
not required, so paper mode works with OpenD down for everything except live
quotes.

## API

| Endpoint | Change |
|---|---|
| `/api/settings` | Validates `account_mode`; refuses live→paper with open positions |
| `/api/account` | Returns the simulated account in paper mode instead of querying OpenD |
| `/api/bot` | Scoped to the active account |
| `/api/paper` | Scoped to the active account |
| `/api/bot/preflight` | OpenD checks reported as not required in paper mode |

## Frontend

The account is shown as a **persistent badge in the Shell header**, not only in
Settings: which account you are in is the most consequential piece of state on
screen, and it should never take a click to find out. Paper reads neutral, live
reads as a warning.

`AutomationPanel` carries the switch and surfaces the refusal when positions are
open. `Manage` labels the book with its account and shows simulated cash in
paper mode.

## Testing

- `PaperBroker` unit tests: no fill when the quote does not support the limit, a
  fill when it does, repricing, cancel, fees, buying power.
- A contract test parametrised over `PaperBroker` and the test `FakeBroker`, so
  the two cannot drift from the interface `Broker` defines.
- Monitor tests driven end to end through `PaperBroker`.
- Settings tests: the switch is refused with open live positions; `LIVE`
  confirmation is required only for live + auto.
- Frontend: the badge reflects the account, the switch works, the refusal shows.
