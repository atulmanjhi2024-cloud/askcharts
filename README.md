# AskCharts <img src="app/public/icons/askcharts-192.png" alt="" width="36" height="36">

Charts, backtests and an AI that works on the chart for you. Watch the demo at [askcharts.pro](https://askcharts.pro).

AskCharts is a charting platform that runs on your own computer or your own server. It has what you'd expect from
a trading platform: charts, indicators, drawing tools, alerts, a screener, a strategy tester and bar replay. What
sets it apart is **AskCharts AI**. You tell it what you want in plain English, and it does it on the chart.

You bring your own AI model and your own key: **Claude** from Anthropic, **GPT** from OpenAI or **Grok** from xAI.
Google Gemini is next.

## What AskCharts AI does

Open the AskCharts AI panel (the robot on the right) and type. For example:

- "Show me Bitcoin on the 4 hour chart with RSI and a 50 period moving average"
- "Put ETH, SOL and XRP side by side"
- "Draw a Fibonacci retracement from the last swing low to the swing high"
- "Mark support and resistance on this chart"
- "Add NVDA and AMD to my watchlist"
- "Add XRPL Activity"
- "How do I set an alert when RSI crosses 70?"

It works on the chart and the panels around it, the way you would. It changes the symbol, the interval, the chart
type and the layout. It adds, changes and removes indicators. It draws, moves and deletes drawings. It compares
symbols, starts bar replay, and edits watchlists and favorites. It also reads indicator values and looks at a picture
of the chart to answer questions about it. Ask "how do I" and you get the steps instead.

Every change it makes shows as a step you can undo. It asks before removing a lot at once, and you can have it ask
before every change. It can't place trades, change your keys or settings, or write code. It explains what it sees
but won't tell you to buy or sell.

## What's in it

- 19 chart types, intervals from 1 second to 1 month, and up to 16 charts on screen
- 89 indicators built in, a Pine Script editor for your own indicators and strategies, and community scripts to add
- Drawing tools: lines, channels, Fibonacci, patterns, shapes, text and more
- Alerts, a screener, a heatmap, calendars, news and company financials
- A strategy tester with a full report, bar replay and paper trading
- XRPL On chain: the XRP Ledger's activity and payments under your chart (optional)

Market data is free and needs no account or key. Crypto comes from Binance, Coinbase and Kraken. US stocks and ETFs
come from Yahoo and Nasdaq. Forex and some futures are there too (futures about 10 minutes delayed). You can also
download years of Kraken's own history to your computer. If you have an Alpaca or Polygon (now Massive) account, its
key gives you live US stock prices (and CME futures, with Polygon): add it in Settings, Stock data.

## What you need

- A recent Mac, Windows 10 or 11, or Linux (64 bit)
- About 150 MB of disk, more if you download history
- Chrome or Edge (Firefox and Safari should work, but I test on Chrome)
- An internet connection, for live prices, Kraken's history, XRPL On chain and AskCharts AI
- For AskCharts AI, an API key from Anthropic, OpenAI or xAI
- Optional: a free Alpaca account, for live US stock prices and stock history

## What gets installed

One folder, `AskCharts` in your home folder. No admin rights, and nothing else on your computer changes.

- `program`: AskCharts itself
- `node`: its own copy of Node.js, checked against nodejs.org's checksums. A Node.js you already have isn't touched.
- `data`: your layouts, watchlists, alerts, settings and keys. Updates never touch it.
- A start and an uninstall script

Outside that folder, only what starts it when you log in: a LaunchAgent on a Mac
(`~/Library/LaunchAgents/askcharts.plist`), a user service and a menu entry on Linux, and shortcuts in Startup and the Start menu on
Windows. AskCharts only listens on your own computer, so nothing else on your network can reach it.

## Step 1: Install on your computer (Mac, Windows, Linux)

No account and no sign in. AskCharts runs on your computer only.

**Mac or Linux.** Open Terminal and paste:

```sh
curl -fsSL https://github.com/realgrapedrop/askcharts/releases/latest/download/install.sh | sh
```

**Windows.** Open PowerShell and paste:

```powershell
irm https://github.com/realgrapedrop/askcharts/releases/latest/download/install.ps1 | iex
```

It downloads about 50 MB, starts AskCharts, and opens it in your browser at http://localhost:3777. From then on
it starts by itself whenever you log in.

- **Make it look like an app.** In Chrome or Edge, choose "Install AskCharts" from the address bar. It gets its own
  window and a dock or taskbar icon.
- **Update.** Settings, Updates, then Update now. A dot on the gear says a new version is out. AskCharts checks
  the update's signature and every file before anything stops, keeps your charts and settings, and goes back to
  the old version by itself if the new one doesn't start. To see if there's a new one, AskCharts asks GitHub
  once a day, which GitHub sees like any download; a switch on the same page turns that off. Versions before
  0.1.5 don't have the button: paste the same line again once, and from then on it's a click. On Windows, keep
  pasting the line for now: Update now comes to Windows once it has been tested there.
- **Remove.** On a Mac or Linux, run `~/AskCharts/uninstall`. On Windows, double click `uninstall.cmd` in your
  `AskCharts` folder. Your charts and settings stay in its `data` folder until you delete it.

## Step 2: Add your AI and data keys

Both go in Settings, the gear at the top right. Each key is checked with its provider before it's saved.

1. **AI key, for AskCharts AI.** Settings, AskCharts AI. Pick the provider, paste your key, press Test, pick a
   model and press Ok. Get a key at [platform.claude.com](https://platform.claude.com) for Claude,
   [platform.openai.com](https://platform.openai.com/api-keys) for GPT or [console.x.ai](https://console.x.ai)
   for Grok. You pay the provider directly for what you use. Each provider keeps its own key, so you can switch
   between them without pasting a key again.
2. **Alpaca key, for live US stock prices (optional).** Settings, Stock data. Paste the key ID and secret key,
   leave the feed on IEX for a free account, and press Save and check. Get the keys from a free account at
   [alpaca.markets](https://alpaca.markets), under API Keys. A Polygon (now Massive) key goes in the same tab.

**New key later?** Paste it in the same place and save it the same way. It replaces the old one. Each tab also
has a button to remove a saved key.

Without any keys, the charts, data and everything else still work. Only AskCharts AI needs one.

## Step 3: Your first chart

1. **Pick a symbol.** Click the symbol at the top left, or just start typing on the chart: `BTC`, `AAPL`,
   `EURUSD`.
2. **Pick an interval.** Click the interval next to it, or type one on the chart: `5` for 5 minutes, `4h`, `1D`.
3. **Ask for the rest.** Open AskCharts AI from the robot on the right and say what you want, like "Add RSI and
   a 50 period moving average".
4. **More history (optional).** Settings, Stock data downloads years of 1-minute bars for your US stocks
   (with the free Alpaca key, about 85 MB a stock), Settings, Crypto data downloads Kraken's full history
   (about 10 GB), and Settings, On chain data turns on XRPL On chain. XRPL On chain follows the XRP Ledger
   through a public server, which is about 15 GB of downloads a day. When it starts it also fills in up to 90
   days of history from askcharts.pro (about 0.5 MB a day, every file signed and checked), so the charts aren't
   empty. Each only downloads, and you can switch each off in the same place.

The [quick start](docs/quick-start.md) walks through the screen: the chart, the toolbars and the panels.

## Install on a server

To reach AskCharts from anywhere, run it on a server with Docker. There it sits behind a sign in with a passkey,
since the internet can reach it. The [server guide](docs/server.md) covers Docker, the sign in, HTTPS through a
Cloudflare tunnel, your keys, and prompts you can give your own AI to walk you through it.

## Privacy

Everything runs on your computer, or on your server. There's no account. Your AI key, and any data keys you add,
stay on your computer in a file only your account can read, and each is only ever sent to its own provider. A
saved key is never shown again, not even to you. Market data comes straight from the public sources above.
AskCharts doesn't send anything to me.

## Where it came from

AskCharts started from [Quant Terminal](https://part-timequant.com) by Lewis Jackson, released under the MIT
licence. I've since made it sturdier and added a lot to it, so that anyone can get a capable charting setup and
run it in plain English: AskCharts AI, a workspace that works like TradingView's, a Pine Script editor with
community scripts, a detailed strategy report, years of stored market history, XRPL On chain, and a passkey sign in
for servers.

The charts are drawn with TradingView's [Lightweight Charts](https://github.com/tradingview/lightweight-charts)
(Apache 2.0). AskCharts isn't affiliated with TradingView. TradingView and Pine Script are trademarks of
TradingView, Inc.

## Licence and contributing

AskCharts is released under the Apache License 2.0 (`LICENSE`). The code that came from Quant Terminal keeps its MIT
licence; its copyright and licence text are in `NOTICE`, with Lightweight Charts' notice. You're free to fork it. To
get a change into this repo, send a pull request (see `CONTRIBUTING.md`).

Nothing here is financial advice.
