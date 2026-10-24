# history: years of Kraken's own bars

Kraken's free API gives a chart only its last 720 bars. This folder keeps a store of Kraken's own bars on
your computer, from each coin's first trade to now, so KRAKEN charts and the strategy report's backtests
reach back years.

Nothing downloads until you ask: Settings (the gear), Crypto data, Download Kraken history. The first
download is Kraken's archive, about 10 GB in five parts, each checked against Kraken's own checksum. It
needs about 34 GB free while it comes in and is checked, and 20 GB after. If it stops partway, it carries
on from there next time. Then each coin catches up from the end of the archive at Kraken's pace: minutes for
a quiet coin, an hour or more for a busy one. After that, an update every hour keeps
the coins current. Add or remove coins on the same page.

## Where the bars come from

1. **Kraken's bulk archives** of 1 minute to 1 day bars, from each pair's first trade, and the quarterly
   files after them.
2. **Kraken's public trades** for the time since the last archive, built into bars. Built this way they
   matched Kraken's own candles exactly.
3. **Kraken's newest 720 bars** of each interval, every hour, which also picks up late trades.

Kraken's data is for your own use: each install downloads its own copy, and none of it ships with
AskCharts.

## Files

- `kraken.mjs`: the importer. AskCharts' runner (`run.mjs`) starts it when Crypto data asks for something,
  and every hour for the update.
- `db.mjs`: the store, one SQLite file. Its layout has a version and updates itself.
- `config.json`: the coins a new store starts with (Kraken's names: XBT is BTC, XDG is DOGE).
- `test/history.test.mjs`: offline tests. `node --test history/test/history.test.mjs`

Everything it writes goes in your data folder, `history/`: the store, `status.json` (what Crypto data
shows), `settings.json` (the coins, Automatic) and `jobs/` (requests from the page).

## Commands

```bash
node history/kraken.mjs update [PAIR...]   # from each coin's last bar to now
node history/kraken.mjs add PAIR           # a coin in: its archive bars, then trades to now
node history/kraken.mjs remove PAIR        # a coin out, with its bars
node history/kraken.mjs status             # what's stored
```

Set `HISTORY_DATA` to the folder it should use (the runner does).
