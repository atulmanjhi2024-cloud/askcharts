// One XRP Ledger ledger, summed up for the chart: transactions by family, Batch wrappers and failed ones
// apart, XRP moved by payments, XRP into and out of known exchange wallets, fees, new accounts, XRP traded on
// the ledger's own exchange, and the big payments one by one. Pure functions, no network, so the tests can
// feed them ledgers.

// Seconds between 1970 and the XRP Ledger's own epoch (1 January 2000).
export const RIPPLE_EPOCH = 946684800;
// Payments of this much XRP and up are kept one by one (the chart's markers pick their own floor).
export const WHALE_MIN = 100000;

// The four families (money, markets, NFTs, accounts), with the newer transaction types added. Anything
// else is "other".
const FAMILY_TYPES = {
  money: ["Payment", "EscrowCreate", "EscrowFinish", "EscrowCancel", "CheckCreate", "CheckCash", "CheckCancel", "PaymentChannelCreate", "PaymentChannelFund", "PaymentChannelClaim"],
  markets: ["OfferCreate", "OfferCancel", "AMMCreate", "AMMDeposit", "AMMWithdraw", "AMMBid", "AMMVote", "AMMDelete", "AMMClawback"],
  nfts: ["NFTokenMint", "NFTokenBurn", "NFTokenCreateOffer", "NFTokenCancelOffer", "NFTokenAcceptOffer", "NFTokenModify"],
  accounts: ["TrustSet", "AccountSet", "AccountDelete", "SetRegularKey", "SignerListSet", "TicketCreate", "DepositPreauth", "Clawback", "DIDSet", "DIDDelete", "CredentialCreate", "CredentialAccept", "CredentialDelete", "DelegateSet"],
};
export const FAMILIES = [...Object.keys(FAMILY_TYPES), "other"];
export const FAMILY_OF = Object.fromEntries(Object.entries(FAMILY_TYPES).flatMap(([f, types]) => types.map((t) => [t, f])));

// Exchange wallets, as labelled on XRPScan. Partial: the big exchanges run many more wallets than these
// (Coinbase alone has hundreds), so flows are a floor.
export const EXCHANGES = {
  rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv: "Bitstamp", rUobSiUpYH2S97Mgb4E7b7HuzQj2uzZ3aD: "Bitstamp", rGFuMiw48HdbnrUbkRYuitXTmfrDBNTCnX: "Bitstamp", rBMFF7vhe2pxYS5wo3dpXMDrbbRudB7hGf: "Bitstamp",
  rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh: "Binance", rNxp4h8apvRis6mJf9Sh8C6iRxfrDWN7AV: "Binance",
  rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh: "Kraken", rUeDDFNp2q7Ymvyv75hFGC8DAcygVyJbNF: "Kraken", rGZjPjMkfhAqmc1ssEiT753uAgyftHRo2m: "Kraken", rp7TCczQuQo61dUo1oAgwdpRxLrA8vDaNV: "Kraken", rEvuKRoEbZSbM5k5Qe5eTD9BixZXsfkxHf: "Kraken",
  rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w: "Coinbase", rw2ciyaNshpHe7bCHo4bRWq6pqqynnWKQg: "Coinbase", rUfghnh1VAWajpAmxgrzLPiCXJ7RwdJUgt: "Coinbase", rwpTh9DDa52XkM9nTKp2QrJuCGV5d1mQVP: "Coinbase", r3YsZdkznVzYBv141qhwXHDWoPUXLdksNw: "Coinbase",
  rMrgNBrkE6FdCjWih5VAWkGMrmerrWpiZt: "Bybit", rNFKfGBzMspdKfaZdpnEyhkFyw7C1mtQ8x: "Bybit", rJn2zAPdFA193sixJwuFixRkYDUtx3apQh: "Bybit", rwBHqnCgNRnk3Kyoc6zon6Wt4Wujj3HNGe: "Bybit", raQxZLtqurEXvH5sgijrif7yXMNwvFRkJN: "Bybit", rMvCasZ9cohYrSZRNYPTZfoaaSUQMfgQ8G: "Bybit", rGdKQGwo9DM43DSfDgkjx7ihdCHkJEnp1k: "Bybit",
  rLW9gnQo7BQhU6igk5keqYnH3TVrCxGRzm: "Bitfinex", rE3hWEGquaixF2XwirNbA1ds4m55LxNZPk: "Bitfinex",
  r4DymtkgUAh2wqRxVfdd3Xtswzim6eC6c5: "Crypto.com", rPHNKf25y3aqATYfrMv9LQnTRHQUYELXfn: "Crypto.com", rJmXYcKCGJSayp4sAdp6Eo4CdSFtDVv7WG: "Crypto.com", rKNwXQh9GMjaU8uTqKLECsqyib47g5dMvo: "Crypto.com", rKV8HEL3vLc6q9waTiJcewdRdSFyx67QFb: "Crypto.com",
  rUW9toSjQkLY6EspdnBJP2paG4hWKmNbMh: "KuCoin", r4pxv9txfQTyVkQUetNmyJqDy7s5fPPVfB: "KuCoin", rhKrvXY8zRvVyDLT4nfXB86HyhqQyvcr4c: "KuCoin", rBWFDgD785LUBDDgcCi9dAW6TH2Gmtq8CM: "KuCoin", rNFugeoj3ZN8Wv6xhuLegUBBPXKCyWLRkB: "KuCoin",
  rUzWJkXyEtT8ekSSxkBYPqCvHpngcy6Fks: "OKX",
  rfExyse8PLGAav8yVfpdLsPf9e13RwBdpi: "HTX", rNah8BxuXEpKm8tyigYgZ4DnZDHRXhgwXc: "HTX", raTQAD4isuvnGERc1jBhiFBpoTYMwQG7Yi: "HTX", rKoFoX8RveEMP5MgrbKA8R8J7nFi9g2zW4: "HTX", rJ9p6JwpypXYpoUk33DDjEkHT5gtKLvsVw: "HTX",
  rHcFoo6a9qT5NHiVn1THQRhsEGcxtYCV4d: "Gate.io", rLzxZuZuAHM7k3FzfmhGkXVwScM4QSxoY7: "Gate.io", rNnWmrc1EtNRe5SEQEs9pFibcjhpvAiVKF: "Gate.io", rNu9U5sSouNoFunHp9e9trsLV6pvsSf54z: "Gate.io",
  raQwCVAJVqjrVm1Nj5SFRcX8i22BhdC9WA: "Upbit", rNzT5xopUaJK8L7mHbThUGKaHoct62dNBC: "Upbit", rN9qNpgnBaZwqCg8CvUZRPqCcPPY7wfWep: "Upbit", rJYQKfsTi8XCLZ1vGSf9CxiL4prz5bvbtz: "Upbit", rBszWJzYpNoqoY4xKuGUpN23b6EBT41ocF: "Upbit",
  rPMM1dRp7taeRkbT74Smx2a25kTAHdr4N5: "Bithumb", rNTkgxs5WG5mU5Sz26YoDVrHim5Y5ohC7: "Bithumb", r9hUMZBc3MWRc4YdsdZgNCW5Qef8wNSXpb: "Bithumb", r9LHiNDZvpLoWPoKnbH2JWjFET8zoYT4Y5: "Bithumb", rD7XQw67JWBXuo2WPX2gZRsGKNsDUGTbx5: "Bithumb",
  raBQUYdAhnnojJQ6Xi3eXztZ74ot24RDq1: "Gemini", raq2gccLh11AwvBrpYcHntUTv4xQNRpyyG: "Gemini", rBYpyCjNwBDQFrgEdVfyosSgQS6iL6sTHe: "Gemini",
  rs2dgzYeqYqsk8bvkQR5YPyqsXYcA24MP2: "MEXC", rhKFvuZbm4gXD7pL3WkM9bP4eWamVGNMMk: "MEXC",
  rPVMhWBsfF9iMXYj3aAzJVkPDTFNSyWdKy: "Bittrex", rEuvmJgjK7PbmiWfvG9DGSWi1GcRcsoxgR: "Bittrex",
  rDCgaaSBAWYfsxUYhCk1n26Na7x8PQGmkq: "Poloniex", rwU8rAiE2eyEPz3sikfbHuqCuiAtdXqa2v: "Poloniex", rEoRCpve6aPs6gg2u5aaeCsBmX9ZB7TzhR: "Poloniex", rwJXYKC1VMzGYc6RHnhnbe38syj5EE34cS: "Poloniex",
  rBTjeJu1Rvnbq476Y7PDnvnXUeERV9CxEQ: "Korbit", rJRarS792K6LTqHsFkZGzM1Ue6G8jZ2AfK: "Korbit", rGU8q9qNCCQG2eMgJpLJJ1YFF5JAbntqau: "Korbit", r9WGxuEbUSh3ziYt34mBRViPbqVxZmwsu3: "Korbit", rNWWbLxbZRKd51NNZCEjoSNovrrx7yiPyt: "Korbit",
  rGfGdVYLDSbji5mqfMvdpx4c8JyyfqVFgf: "Bitso", rfEu1Wnr7LxStoFx8DBdzgr8M16FBUbH3K: "Bitso", rLSn6Z3T8uCxbcd1oxwfGQN1Fdn5CyGujK: "Bitso",
  rsRy14FvipgqudiGmptJBhr1RtpsgfzKMM: "Luno", rsbfd5ZYWqy6XXf6hndPbRjDAzfmWc1CeQ: "Luno",
  rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq: "GateHub",
  rfkE1aSy9G8Upk4JssnwBxhEv5p4mn2KTy: "Uphold",
};

// Drops as a whole number, or null when the field isn't plain XRP (an issued currency, or "unavailable").
const drops = (v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);

// ---- the ledger's own exchange (.project/xrpl-dex.md)
// What a transaction did, from its metadata, seen from the taker (whoever's transaction crossed): XRP it
// received from and paid to offers on the order book and AMM pools. An offer it filled shows its old amounts;
// one removed unfilled (cancelled, expired, unfunded) doesn't, and isn't a trade. A pool is an account with an
// AMM entry: its XRP moves in deposits, withdrawals, bids and votes too, which aren't trades. A trade between
// two tokens through XRP (auto bridging) both receives and pays XRP: the smaller of the two is bridged.
// Bump DEX_RULES when what counts changes: the shared history's rules hash carries it.
export const DEX_RULES = 1;
export const DEX_COLS = ["dex_got", "dex_paid", "amm_got", "amm_paid", "dex_bridge", "dex_fills", "amm_swaps"];
const AMM_NOT_TRADES = new Set(["AMMCreate", "AMMDeposit", "AMMWithdraw", "AMMBid", "AMMVote", "AMMDelete", "AMMClawback"]);
// one successful transaction into the ledger's running totals (drops, counts)
function addDex(d, tx, meta) {
  let got = 0,
    paid = 0,
    ammGot = 0,
    ammPaid = 0,
    swapped = false;
  const pools = !AMM_NOT_TRADES.has(tx.TransactionType);
  for (const n of meta.AffectedNodes || []) {
    const node = n.ModifiedNode || n.DeletedNode;
    if (!node) continue;
    if (node.LedgerEntryType === "Offer" && node.PreviousFields) {
      const p = node.PreviousFields,
        f = node.FinalFields || {};
      // an account crossing its own offer trades with nobody
      if (f.Account === tx.Account) continue;
      const g = drops(p.TakerGets),
        q = drops(p.TakerPays);
      const gave = g == null ? 0 : g - (drops(f.TakerGets) ?? 0),
        took = q == null ? 0 : q - (drops(f.TakerPays) ?? 0);
      if (gave > 0) got += gave;
      if (took > 0) paid += took;
      if (gave > 0 || took > 0) d.dex_fills++;
    } else if (pools && n.ModifiedNode && node.LedgerEntryType === "AccountRoot" && node.FinalFields?.AMMID) {
      const before = drops(node.PreviousFields?.Balance),
        after = drops(node.FinalFields.Balance);
      if (before == null || after == null || before === after) continue;
      swapped = true;
      if (after > before) ammPaid += after - before;
      else ammGot += before - after;
    }
  }
  got += ammGot;
  paid += ammPaid;
  d.dex_got += got;
  d.dex_paid += paid;
  d.amm_got += ammGot;
  d.amm_paid += ammPaid;
  d.dex_bridge += Math.min(got, paid);
  if (swapped) d.amm_swaps++;
}

// A `ledger` response's ledger (api_version 2, or 1: the transaction's fields at the top and its
// metadata in metaData) into one row and the big payments in it.
export function summarize(ledger, { seen = null } = {}) {
  const idx = Number(ledger.ledger_index);
  const close = Number(ledger.close_time) + RIPPLE_EPOCH;
  if (!Number.isInteger(idx) || !Number.isFinite(close)) throw new Error("Not a ledger: no index or close time");
  const row = { idx, close, res: Number(ledger.close_time_resolution) || 10, seen, txs: 0, failed: 0, batch: 0, money: 0, markets: 0, nfts: 0, accounts: 0, other: 0, xrp: 0, pays: 0, ex_in: 0, ex_out: 0, fees: 0, created: 0 };
  const whales = [],
    dex = Object.fromEntries(DEX_COLS.map((c) => [c, 0]));
  for (const t of ledger.transactions || []) {
    if (typeof t !== "object") throw new Error("Ledger without its transactions expanded");
    const tx = t.tx_json || t,
      meta = t.meta || t.metaData || {};
    row.txs++;
    row.fees += drops(tx.Fee) || 0;
    // a Batch wrapper always applies; its inner transactions that did apply are in the ledger too
    if (tx.TransactionType === "Batch") {
      row.batch++;
      continue;
    }
    if (meta.TransactionResult !== "tesSUCCESS") {
      row.failed++;
      continue;
    }
    row[FAMILY_OF[tx.TransactionType] || "other"]++;
    for (const n of meta.AffectedNodes || []) if (n.CreatedNode?.LedgerEntryType === "AccountRoot") row.created++;
    addDex(dex, tx, meta);
    if (tx.TransactionType !== "Payment" || tx.Account === tx.Destination) continue;
    const d = drops(meta.delivered_amount ?? meta.DeliveredAmount);
    if (d == null) continue;
    const xrp = d / 1e6,
      from = EXCHANGES[tx.Account],
      to = EXCHANGES[tx.Destination];
    row.xrp += xrp;
    row.pays++;
    // one exchange's own wallets, or one exchange to another: not a flow in or out of exchanges
    if (to && !from) row.ex_in += xrp;
    if (from && !to) row.ex_out += xrp;
    if (xrp >= WHALE_MIN)
      whales.push({ hash: t.hash || tx.hash, idx, src: tx.Account, dst: tx.Destination, tag: Number.isInteger(tx.DestinationTag) ? tx.DestinationTag : null, xrp, src_name: from || null, dst_name: to || null });
  }
  // summed in drops, stored in XRP like the other amounts; the counts as they are
  for (const c of DEX_COLS) row[c] = c === "dex_fills" || c === "amm_swaps" ? dex[c] : dex[c] / 1e6;
  return { row, whales };
}

// Where each ledger goes on a chart. The network rounds close times to `res` seconds (10, normally) and
// moves a ledger on by a second when the one before has the same time, so three ledgers read :30, :31
// and :32 and the next :41. Ledgers in one window are spread evenly across it (the network rounds to the
// nearest, so the window is res/2 either side). `rows`: one window's ledgers, in index order.
export function place(rows) {
  const n = rows.length;
  return rows.map((r, k) => {
    const b = r.close - (r.close % r.res);
    return Math.round(b - r.res / 2 + ((k + 0.5) * r.res) / n);
  });
}
export const windowOf = (r) => r.close - (r.close % r.res);

// "107757613-107808936" or "32570-50000,50002-107808936" into [[from, to], ...]
export function ranges(s) {
  return String(s || "")
    .split(",")
    .filter((p) => p.trim())
    .map((p) => p.trim().split("-").map(Number))
    .filter((p) => p.every(Number.isInteger))
    .map((p) => [p[0], p[1] ?? p[0]]);
}
