# Changelog

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
