// The Heatmap tab's data, ready to draw.
//
// Crypto: the 100 largest coins by market cap (CoinGecko's free list, one request every few
// minutes), without stablecoins (unless asked), wrapped or staked copies of other coins, and
// tokenized gold or loans. Price and 24h change are live from Binance where the coin trades there
// (checked against CoinGecko's price, so a ticker clash can't mix two coins up), otherwise
// CoinGecko's own. If CoinGecko can't be reached, Binance's list sized by 24h volume stands in.
//
// US stocks: the 200 largest (Nasdaq). Colour is the regular session's change: today's while the
// market is open, the last session's before the open. Pre-market and after-hours moves are kept
// apart, as a separate choice.

import { getJson, cached, cryptoScreener, nasdaqScreener, usMarket } from "./providers.js";

const CG_URL = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&price_change_percentage=24h";
const CG_TTL = 4 * 60e3;
const CG_BACKOFF = 10 * 60e3;

// Fiat stablecoins (the near-$1 check below catches most of the rest).
const STABLE = new Set("USDT USDC DAI USDE USDS FDUSD TUSD USDP PYUSD USD1 USDG RLUSD BUSD GUSD LUSD FRAX USDD CRVUSD GHO USDY USD0 EURC EURT EURS EURI AEUR USDB USDX SUSDE SUSDS SDAI USDF USR DEUSD AUSD FRXUSD USDTB BFUSD USDO USDA USDM USDZ USDQ USDL U USDT0 XUSD USDAI SRUSD".split(" "));
// Copies of other coins and tokenized real-world assets.
const COPY = new Set("WBTC WETH WBETH WEETH WSTETH STETH CBBTC RETH METH CBETH LBTC SOLVBTC JITOSOL MSOL BNSOL JUPSOL TBTC EZETH RSETH WBNB WTRX BTCB XAUT PAXG KAU KAG FIGR_HELOC BUIDL OUSG USYC USTB STHYPE KHYPE LSETH OSETH SWETH BBTC ENZOBTC UNIBTC PUMPBTC FBTC CLBTC SAVAX STX_WRAPPED EUTBL JAAA YLDS A7A5 BCAP USTBL BENJI".split(" "));
const COPY_NAME = /\b(wrapped|staked|bridged|restaked|liquid staking|tokenized|gold|heloc|treasury|treasuries|t-bills?|money market|fund|clo)\b/i;

export const isStable = (c) => {
  const s = String(c.symbol || "").toUpperCase();
  if (STABLE.has(s)) return true;
  const p = Number(c.current_price ?? c.price);
  // a dollar or euro in the ticker or the name, priced near its peg
  return /USD|EUR/i.test(`${s} ${c.name || ""}`) && p > 0.9 && p < 1.25;
};
export const isCopy = (c) => COPY.has(String(c.symbol || "").toUpperCase()) || COPY_NAME.test(String(c.name || ""));

let cgGood = null,
  cgDownUntil = 0;
async function coingecko(deps) {
  if (Date.now() < cgDownUntil) return cgGood;
  try {
    const list = await (deps.cached || cached)("hm:coingecko", CG_TTL, () => deps.getJson(CG_URL));
    if (Array.isArray(list) && list.length) cgGood = { at: Date.now(), list };
  } catch (e) {
    // a refusal (429) or an outage: keep the last good list and leave CoinGecko alone for a while
    cgDownUntil = Date.now() + (e.status === 429 ? CG_BACKOFF : 2 * 60e3);
  }
  return cgGood;
}

export async function cryptoHeatmap({ stables = false } = {}, deps = { getJson, cached, cryptoScreener }) {
  const [cg, bin] = await Promise.all([coingecko(deps), deps.cryptoScreener().catch(() => [])]);
  const byBase = new Map();
  for (const r of bin) if (String(r.symbol).startsWith("BINANCE:")) byBase.set(String(r.name).toUpperCase(), r);
  const binAt = bin.length ? Date.now() : null;
  if (!cg) {
    // no market caps: Binance's most traded coins, sized by 24h volume, with the same exclusions
    const rows = bin
      .filter((r) => !isStable({ symbol: r.name, price: r.price }) && !isCopy({ symbol: r.name, name: r.name }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 100)
      .map((r) => ({ ticker: r.name, name: r.name, symbol: r.symbol, price: r.price, changePct: r.changePct, volume: r.volume, marketCap: 0, source: "binance" }));
    return { universe: "crypto", sizedBy: "volume", rows, asOf: binAt, note: "CoinGecko's market caps aren't available right now, so tiles are sized by 24h trading volume on Binance." };
  }
  const rows = [],
    seen = new Set(),
    dropped = [];
  for (const c of cg.list) {
    const sym = String(c.symbol || "").toUpperCase();
    if (!sym || seen.has(sym) || !(c.market_cap > 0)) continue;
    if ((!stables && isStable(c)) || isCopy(c)) {
      dropped.push(sym);
      continue;
    }
    seen.add(sym);
    const b = byBase.get(sym);
    const live = b && c.current_price > 0 && Math.abs(b.price / c.current_price - 1) < 0.05;
    const price = live ? b.price : c.current_price;
    const change = live ? b.changePct : c.price_change_percentage_24h;
    rows.push({
      ticker: sym,
      name: c.name,
      symbol: live ? b.symbol : "",
      price,
      changePct: Number.isFinite(change) ? change : null,
      // the market cap moves with the live price between CoinGecko's updates
      marketCap: c.market_cap * (price / (c.current_price || price)),
      volume: c.total_volume || 0,
      source: live ? "binance" : "coingecko",
    });
    if (rows.length >= 100) break;
  }
  return { universe: "crypto", sizedBy: "marketCap", rows, dropped, asOf: binAt, capsAt: cg.at, note: "" };
}

export async function usHeatmap(deps = { nasdaqScreener, usMarket }) {
  const [all, market] = await Promise.all([deps.nasdaqScreener("stocks"), deps.usMarket()]);
  const rows = all
    .filter((r) => r.marketCap > 0)
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, 200)
    .map((r) => ({
      ticker: r.ticker,
      name: r.name,
      symbol: r.symbol,
      sector: r.sector || "Other",
      price: r.regularPrice ?? r.price,
      changePct: r.sessionChangePct ?? r.changePct,
      extChangePct: r.extChangePct ?? null,
      extPrice: r.extChangePct != null ? r.price : null,
      marketCap: r.marketCap,
      volume: r.volume,
    }));
  return { universe: "us", sizedBy: "marketCap", rows, session: market.status, open: market.open, lastSession: market.lastSession, asOf: Date.now() };
}
