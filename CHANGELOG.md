# Changelog

## 0.1.16 (2026-10-24)

Download Kraken history works on a fresh install now, and XRPL On chain copes with a public server that says to slow down.

- Download Kraken history in Settings, Market data downloads Kraken's archive. Until now it only switched on the
  hourly update, which had nothing to start from, so every update failed with "nothing stored yet". The archive
  is about 10 GB in five parts, and each part is checked against Kraken's own checksum. If it stops partway it
  carries on from there next time, and every file in it is tested before it's used. If your computer's unzip
  can't read it, Market data says so and nothing is downloaded twice. It needs about 34 GB free
  while it comes in and 20 GB after. Then each coin catches up at Kraken's pace, which takes minutes for a quiet
  coin and an hour or more for a busy one.
- XRPL On chain on xrplcluster.com kept getting cut off for asking too much at once. Its free allowance turned
  out smaller than one ledger with its transactions every few seconds, so even a well behaved collector falls
  behind there. The default server is now Ripple's wss://s1.ripple.com, which kept up in testing, and an
  install on xrplcluster.com moves to it by itself. A server you picked yourself stays. If it can't keep up,
  Market data now says it's falling behind and suggests s1.ripple.com or your own node.
- When a server says to slow down, the collector waits as long as it asks, fills in older ledgers more slowly
  and stays connected, instead of reconnecting straight into the same limit. On a public server it fills in at
  2 ledgers a second; on your own node it stays at 5.
- The XRP Ledger line in Market data says why it can't connect, for example that the server is rate limiting
  your network, and says when it's filling in more slowly. After Save server it shows "Switching to" the new
  server until the collector is on it.
- A server you've typed but not saved no longer gets lost when the page refreshes underneath, which sometimes
  swallowed the Save click.

## 0.1.15 (2026-10-24)

The Kraken history updates every hour again, and Market data can add coins in any currency, download a coin as CSV and shrink the store after a Remove.

- The Kraken history updates every hour again, and Market data's requests (Update now, Add, Remove) run when you
  ask. When AskCharts started the importer it stayed running after its work was done, so after the first run
  following a restart nothing else could start. If your Market data has said "Waiting to start" for a while,
  that's why, and it runs once you update.
- Add coin offers every pair Kraken lists, in whatever currency it's quoted in (EUR, USDT, BTC, GBP and the rest),
  not only USD. The coin list shows them by their usual names, like XRP/EUR or ETH/BTC.
- Each stored coin has a download link that gives its bars as a CSV file, at the finest interval kept (1 minute
  for Kraken). The columns are the ones the app's own CSV import reads, so a file can go straight back in.
- Removing a coin gives its space back when it frees 100 MB or more. Before, the bars were deleted but the store
  file kept its size. Market data says how much it shrank, and if the disk doesn't have room for the rewrite it
  says so and leaves the file alone.
- If you run a second copy of AskCharts that reads the first one's history store, `QT_HISTORY_JOBS=off` on that
  copy makes its Market data read only, so its buttons can't start jobs on the other copy's store.

## 0.1.14 (2026-10-23)

The chart's right edge stays tight after you pick a date range, and images and tables now resize by their corners.

- A date range under the chart (1D to All) now sets your zoom as well, so the next interval keeps it, the same way
  TradingView does. Pick 1D and then 5m and you get several days of 5 minute bars with the last one next to the
  price scale. Before, the chart went back to the zoom you had earlier and left a wide gap on the right.
- Kraken's live feed fills a minute without trades with a flat bar and no volume, and the stored Kraken history has
  none of those, so one chart mixed both. The live bars now leave them out too. On ATOM/USD at 1 minute that was
  about a third of the bars when I checked. A pair with no trades at all in that window says so instead of
  drawing a flat line.
- Drag a corner of an image or a table to resize it, and the opposite corner stays where it is. A picture keeps
  its shape and a table's cells grow or shrink with it. Dragging the middle still moves them.
- When drawings are locked, pressing the one you've selected now tells you so and where to unlock it. Before,
  the press just dragged the chart, so a locked drawing looked like it was broken.

## 0.1.13 (2026-10-23)

XRPL DEX: trading on the XRP Ledger's own exchange.

- XRPL DEX, a fifth On chain indicator: XRP traded on the ledger's own order book and its AMM pools in each bar,
  seen from the taker. Show picks Buys and sells (Bought above zero, Sold below, Net as a line), Order book and
  AMM (volume by venue) or Bridged (XRP that only passed through between two other tokens, which isn't counted as
  bought or sold). The ? beside its name explains what counts. Alerts work on it like on the other four.
- The XRPL collector counts it from this version on, from what each transaction did, so each trade counts once.
  Bars from before counting began say "No DEX data before ..." rather than showing zero. With the shared history
  on, the numbers fill in from when they were first published.
- The shared XRPL history carries the new numbers in a second format beside the first, so installs that haven't
  updated keep filling in as before.

## 0.1.12 (2026-10-23)

Alerts on the XRPL On chain indicators.

- Create alert now offers XRPL Activity, XRPL Payments, XRPL Exchange flows and XRPL Network, next to price and
  your other indicators: for example, XRP paid into exchanges above 5M in an hour, or new accounts crossing 300.
  The alert reads the same XRP Ledger data the chart draws and keeps watching while your browser is closed. For
  XRPL Network it watches the value its Show setting picks, and the dialog names it.
- When an indicator has no data for the alert's bars, the alert says so in plain words.
- The Trigger menu in Create alert is readable again: each trigger's description sits under its name instead of
  running into the next one.

## 0.1.11 (2026-10-23)

A server guide without Docker, and your own indicators load without a warning.

- The server guide (`docs/server.md`) has a Without Docker section: the install line, a small settings file for
  systemd, HTTPS through a Cloudflare tunnel or your own web server, your first passkey, and Update now from
  Settings, Updates.
- Your own indicators get a small `package.json` beside them in the data folder, so Node loads them as the ES
  modules they are, with no warning, even when there's another `package.json` further up (in your home folder,
  say).

## 0.1.10 (2026-10-22)

XRPL Network, and an economic calendar that keeps its last good copy.

- XRPL Network, a fourth On chain indicator. Show picks one: New accounts (accounts created in each bar), Fees
  burned (the XRP paid as fees, which is destroyed) or Average fee (fees over transactions, in drops; it climbs
  when the ledger is busy). The ? beside its name explains each. The collector already stored these numbers, so
  it works on all the XRPL history you have.
- The economic calendar keeps its last good copy and shows it while the calendar's feed turns requests away, and
  it waits 15 minutes after that before asking again, instead of asking on every view.

## 0.1.9 (2026-10-22)

Settings, Updates remembers its last check.

- After an update or a restart, the page shows the last check's answer instead of "Not checked yet". A new install
  that hasn't checked yet says it will within the hour.
- A release's notes start with their summary line, then the list of changes.

## 0.1.8 (2026-10-22)

Settings, Updates makes the next step plain.

- When a new version is out, Update comes first, in the accent colour, with a line that says to press it.
- Check now always shows that it ran ("Checked just now"), even when nothing changed.
- An install that updates from its own address instead of GitHub says so under the switch.

## 0.1.7 (2026-10-22)

On a server, the app stays on its own port when the sign in is on.

- AskCharts used to move the app to the next free port when its own was taken, and with the sign in on, that
  could be the sign in's own port, where your proxy or tunnel sends people. Now it doesn't start and says which
  port is taken, so nothing reaches the app without signing in. On your own computer nothing changes.

## 0.1.6 (2026-10-22)

AskCharts can run on a server without Docker.

- The passkey sign in comes with AskCharts now (its two packages are in the release), so an install made with
  the install line can run it in front of AskCharts on a server, and update itself from Settings, Updates.
  Docker installs are unchanged.

## 0.1.5 (2026-10-22)

AskCharts can update itself now: Settings, Updates.

- Settings, Updates: the version you have, the newest one with its notes, Check now and Update now. On a
  computer AskCharts updates itself: it checks the release's signature and every file before anything stops,
  keeps your charts, settings and keys, and goes back to the old version by itself if the new one doesn't
  start. On a server (Docker) the page shows the update commands. A dot on the Settings gear says a newer
  version is out (checked once a day; a switch turns that off).
- Releases are signed with a key that never touches GitHub, so a stolen GitHub login can't push an update.
- The Mac and Linux installer keeps the old version until the new one answers, and puts it back if an update
  fails partway. On Windows, update by pasting the install line again for now: Update now comes to Windows once
  it has been tested there.

## 0.1.4 (2026-10-22)

XRPL On chain starts with up to 90 days of history, and there's a new Exchange flows indicator.

- XRPL Exchange flows, a new On chain indicator: XRP paid into and out of known exchange wallets in each bar,
  and the net. The wallet list is partial, so the numbers are floors, and its ? says so.
- XRPL lines break where the collector wasn't running (a laptop that was off, say) instead of drawing a straight
  line across, and the legend says so there.
- XRPL On chain starts with history. When the collector starts, it fills in up to 90 days of ledgers from
  data.askcharts.pro, published hourly by the AskCharts collector that runs around the clock. Every file is
  signed and checked before a row goes in, and only the last hour is fetched ledger by ledger. Settings,
  Market data has a switch to turn it off. It only downloads.

## 0.1.3 (2026-10-22)

AskCharts gets its own colour, and XRPL Activity gets easier to read.

- AskCharts has its own accent colour, the purple from its mark, on buttons, toggles, the BUY box and the
  sign-in page. Line and drawing colours are unchanged.
- XRPL Activity draws fine lines in each kind's colour instead of dots, its values in the legend are split
  by a faint |, and a small ? after its name explains what it counts and how.
- AskCharts AI's panel shows the same robot as its toolbar button, where it had a spark.
- XRPL Activity says where its history starts, in the empty part of the pane before it, and fades the
  newest bar while it's still adding up. Its ? explains the edges of the chart and how the collector is doing.
- An indicator's ? opens when the mouse is over it, and stays open after a click. On a touch screen a tap opens it.

## 0.1.2 (2026-10-22)

The sign-in gateway sends no email any more, plus credits, notices and the look of the About page.

- The sign-in page no longer offers "New device? Email me a link", and the gateway has no route that
  sends one. AskCharts has one owner, so nothing a stranger does should make it send mail. A new device
  gets its passkey from a one-time link made on the server: `docker compose exec askcharts node
  gateway/link.mjs`, the same way as the first one. The `MAIL_MODE`, `RESEND_API_KEY` and `MAIL_FROM`
  settings are gone; you can delete them from `.env`.
- The sign-in card no longer shows the site's address in its corner.
- AskCharts has a home page, [askcharts.pro](https://askcharts.pro), with a demo video. The README and Settings,
  About point to it.
- Settings, About, the README and NOTICE now say that Pine Script, like TradingView, is a trademark of
  TradingView, Inc. AskCharts uses the name only to say what kind of scripts it runs.
- NOTICE carries the MIT notice for Tabler Icons, because the trend up and trend down icons in the emoji
  picker use a line from that set.
- The README shows the AskCharts mark beside its title, and so does Settings, About, with the tagline
  underneath.

## 0.1.1 (2026-10-21)

A security fix for the sign-in gateway, which only runs when AskCharts is on a server. Desktop installs
don't use it.

- The gateway used to count each visitor by the `CF-Connecting-IP` header, and anyone could send that
  header through Caddy or nginx, so a visitor could get around the sign-in limits. Now it believes a
  visitor's address header only when `ASKCHARTS_TRUST_PROXY` says what's in front of it: `cloudflare` for a
  Cloudflare tunnel, `forwarded` for Caddy, nginx and the like, or empty when nothing is in front. A value
  it doesn't know stops the gateway from starting.
- The account gets at most one sign-in email every 10 minutes, so a stranger can't use up the hourly
  email cap.

To update a server, add `ASKCHARTS_TRUST_PROXY` to `.env` (see `.env.example` and the server guide), then
run `git pull && docker compose up -d --build`. Without it everything still works, but all visitors share
one set of sign-in limits and the log says so.

## 0.1.0 (2026-10-21)

The first public release.

- Charts with 19 chart types, intervals from 1 second to 1 month, and up to 16 charts on screen
- 89 built in indicators, a Pine Script editor and community scripts you can add
- Drawing tools, alerts, a screener, a heatmap, calendars, news and company financials
- A strategy tester with a full report, bar replay and paper trading
- AskCharts AI, which works on the chart for you with your own Claude key
- XRPL On chain, the XRP Ledger's activity and payments under your chart (optional)
- Free market data with no key, and optional Alpaca or Polygon keys for live US stock prices
- One line installs for Mac, Linux and Windows, and Docker with a passkey sign in for servers
