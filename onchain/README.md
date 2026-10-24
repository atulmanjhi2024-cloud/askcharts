# onchain: XRPL On chain

The data behind the On chain indicators (Indicators, On chain): a collector follows the XRP Ledger and keeps
one row per validated ledger. Turn it on in Settings, Market data. AskCharts' runner (`run.mjs`) starts and
stops it.

## What each ledger row holds

- **Transactions by family,** successful ones only: money (Payment, Escrow, Check, PaymentChannel), markets
  (Offer, AMM), NFTs (NFToken), accounts (TrustSet, AccountSet, TicketCreate and the like), and other.
- **Batch bundles,** counted apart: in October 2026 about half of all transactions, mostly bots' bundles
  that don't go through. A bundle's inner transactions that did go through count by their own type.
- **Failed:** applied with a `tec` result (the fee is taken, nothing else happens).
- **XRP moved:** XRP delivered by successful Payments between two different accounts.
- **Into and out of exchanges:** the part of that XRP sent to or from known exchange wallets (a partial
  list, in `xrpl-ledger.mjs`, so these are floors).
- **Fees burned, new accounts,** and payments of 100,000 XRP and up one by one.

## Time on the chart

The network rounds each ledger's close time to 10 seconds, so three ledgers can read :30, :31 and :32 and
the next :41. Each row keeps that time and a placement time: the ledgers of one 10 second window spread
evenly across it. On 1 and 5 second charts that puts about one ledger per bar.

## Which server

A public server (Ripple's `wss://s1.ripple.com` by default) sends about 600 KB per ledger, about 15 GB a day.
xrplcluster.com's free allowance is less than that, so it can't keep up with every ledger. If you run your
own XRP Ledger node, point Market data at its WebSocket address instead. The collector fills
in the last day, then keeps 90 days.

## Files and commands

- `xrpl-ledger.mjs`: one ledger summed up, the families, the exchange list.
- `db.mjs`: the store, one SQLite file. `xrpl.mjs`: the collector.
- `test/xrpl.test.mjs`: offline tests. `node --test onchain/test/xrpl.test.mjs`

```bash
node onchain/xrpl.mjs run              # follow the ledger (the runner does this)
node onchain/xrpl.mjs status           # what's stored
node onchain/xrpl.mjs ledger IDX       # one ledger, summed up, nothing saved
```

Settings: `XRPL_SERVER`, `XRPL_BACKFILL_DAYS` (1), `XRPL_KEEP_DAYS` (90), `XRPL_PACE` (5 a second while
filling in), `ONCHAIN_DATA` (where the store goes).
