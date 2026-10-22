# Changelog

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
