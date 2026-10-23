// Shared XRPL history: the files a publishing machine puts out and the checks an
// install runs on them before it imports a row. A chunk is a run of ledgers with no holes: the store's own
// rows (less `t`, which the import places again, and `seen`) and their big payments, as JSON compressed with
// brotli. One per hour, rolled into one per day once the day is out. The manifest lists every chunk with its
// sha256 and is signed (ed25519): the public key is here, the private key only on the publishing machine.
// Everything that comes in is checked as untrusted. Node only, no packages.
import crypto from "node:crypto";
import zlib from "node:zlib";
import { FAMILY_OF, EXCHANGES, WHALE_MIN, RIPPLE_EPOCH, DEX_COLS, DEX_RULES } from "./xrpl-ledger.mjs";

export const FORMAT = 1;
// the store's layout these rows come from (db.mjs SCHEMA when this format was made)
export const LAYOUT = 1;
export const COLS = ["idx", "close", "res", "txs", "failed", "batch", "money", "markets", "nfts", "accounts", "other", "xrp", "pays", "ex_in", "ex_out", "fees", "created"];
export const WHALE_COLS = ["hash", "idx", "src", "dst", "tag", "xrp", "src_name", "dst_name"];
// The counting rules (transaction families and the exchange list) as a short hash: rows counted under other
// rules don't line up (exchange flows above all), so every chunk says which rules counted it.
export const RULES = crypto.createHash("sha256").update(JSON.stringify([FAMILY_OF, EXCHANGES])).digest("hex").slice(0, 12);
// Format 2 (.project/xrpl-dex.md): the same rows plus trading on the ledger's own exchange (NULL where the
// collector didn't count it yet), published beside format 1 under xrpl/v2/: installs up to 0.1.12 read format 1
// and refuse any other columns. Its rules hash covers the DEX rules too.
export const FORMATS = {
  1: { format: 1, layout: 1, cols: COLS, rules: RULES, path: "xrpl" },
  2: { format: 2, layout: 2, cols: [...COLS, ...DEX_COLS], rules: crypto.createHash("sha256").update(JSON.stringify([FAMILY_OF, EXCHANGES, DEX_RULES])).digest("hex").slice(0, 12), path: "xrpl/v2" },
};
// The publisher's key (node onchain/publish.mjs keygen made it; its private half never leaves that machine).
export const PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAuVao6f3ptGuvt1X4Ta17PiU9AGLxXDpFpfnGoLSejZA=\n-----END PUBLIC KEY-----\n";
// Sizes an install accepts: a day is about 0.5 MB compressed and 2 MB of JSON (October 2026)
export const MAX_CHUNK = 8e6;
export const MAX_JSON = 64e6;
export const MAX_MANIFEST = 2e6;
// an hour or a day, and a revision when a chunk was revoked and put out again ("-r2")
const NAME = /^(h\/\d{4}-\d{2}-\d{2}T\d{2}|d\/\d{4}-\d{2}-\d{2})(-r\d{1,3})?\.json\.br$/;
const ADDRESS = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const HASH = /^[0-9A-F]{64}$/;
const NAMES = new Set(Object.values(EXCHANGES));
const INT = new Set(["idx", "close", "res", "txs", "failed", "batch", "money", "markets", "nfts", "accounts", "other", "pays", "fees", "created"]);
const COUNTS = ["txs", "failed", "batch", "money", "markets", "nfts", "accounts", "other", "pays", "created"];

const bad = (why) => new Error(`Shared XRPL history: ${why}`);
export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

// ---------- chunks ----------

// ledgers: rows in COLS order, by index, no holes; whales: rows in WHALE_COLS order
export function encodeChunk(ledgers, whales, f = FORMATS[FORMAT]) {
  const json = Buffer.from(JSON.stringify({ format: f.format, layout: f.layout, rules: f.rules, cols: f.cols, ledgers, whaleCols: WHALE_COLS, whales }));
  return zlib.brotliCompressSync(json, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: json.length } });
}

// One ledger row: whole numbers where the store has them, amounts within XRP's supply, and the counts adding up
// the way the collector counts (every transaction is a Batch wrapper, a failed one or one of the five families).
function checkLedger(r, now, f = FORMATS[FORMAT]) {
  if (!Array.isArray(r) || r.length !== f.cols.length) throw bad("a ledger row has the wrong shape");
  const o = Object.fromEntries(f.cols.map((c, k) => [c, r[k]]));
  if (!isInt(o.idx, 1, 1e12) || !isInt(o.close, RIPPLE_EPOCH, now + 86400) || !isInt(o.res, 1, 120)) throw bad(`ledger ${o.idx}: bad index, close time or resolution`);
  for (const c of COUNTS) if (!isInt(o[c], 0, 1e6)) throw bad(`ledger ${o.idx}: bad ${c}`);
  if (!isInt(o.fees, 0, 1e15)) throw bad(`ledger ${o.idx}: bad fees`);
  for (const c of ["xrp", "ex_in", "ex_out"]) if (!isNum(o[c], 0, 1e11)) throw bad(`ledger ${o.idx}: bad ${c}`);
  if (o.txs !== o.failed + o.batch + o.money + o.markets + o.nfts + o.accounts + o.other) throw bad(`ledger ${o.idx}: its counts don't add up`);
  if (o.pays > o.money || o.ex_in + o.ex_out > o.xrp * (1 + 1e-9) + 1e-6) throw bad(`ledger ${o.idx}: its payments don't add up`);
  for (const c of COLS) if (INT.has(c) && !Number.isInteger(o[c])) throw bad(`ledger ${o.idx}: ${c} isn't whole`);
  if (f.format >= 2) checkDex(o);
  return o;
}

// The DEX columns: all counted or none (NULL: not counted yet), amounts within XRP's supply, and the gross
// amounts holding together: the AMM part within its total, the bridged part within either total (a sum of the
// smaller of two numbers is never more than either sum). A little room for adding up floats.
const DEX_AMOUNTS = ["dex_got", "dex_paid", "amm_got", "amm_paid", "dex_bridge"];
const within = (a, b) => a <= b * (1 + 1e-9) + 1e-6;
function checkDex(o) {
  const n = DEX_COLS.filter((c) => o[c] === null).length;
  if (n === DEX_COLS.length) return;
  if (n) throw bad(`ledger ${o.idx}: its DEX numbers are partly missing`);
  for (const c of DEX_AMOUNTS) if (!isNum(o[c], 0, 1e11)) throw bad(`ledger ${o.idx}: bad ${c}`);
  for (const c of ["dex_fills", "amm_swaps"]) if (!isInt(o[c], 0, 1e6)) throw bad(`ledger ${o.idx}: bad ${c}`);
  if (!within(o.amm_got, o.dex_got) || !within(o.amm_paid, o.dex_paid) || !within(o.dex_bridge, o.dex_got) || !within(o.dex_bridge, o.dex_paid))
    throw bad(`ledger ${o.idx}: its DEX numbers don't add up`);
}

function checkWhale(w, first, last) {
  if (!Array.isArray(w) || w.length !== WHALE_COLS.length) throw bad("a big payment has the wrong shape");
  const o = Object.fromEntries(WHALE_COLS.map((c, k) => [c, w[k]]));
  if (typeof o.hash !== "string" || !HASH.test(o.hash)) throw bad("a big payment has a bad hash");
  if (!isInt(o.idx, first, last)) throw bad(`big payment ${o.hash}: not in this chunk's ledgers`);
  if (typeof o.src !== "string" || !ADDRESS.test(o.src) || typeof o.dst !== "string" || !ADDRESS.test(o.dst)) throw bad(`big payment ${o.hash}: bad address`);
  if (o.tag !== null && !isInt(o.tag, 0, 4294967295)) throw bad(`big payment ${o.hash}: bad destination tag`);
  if (!isNum(o.xrp, WHALE_MIN, 1e11)) throw bad(`big payment ${o.hash}: bad amount`);
  for (const c of ["src_name", "dst_name"]) if (o[c] !== null && !NAMES.has(o[c])) throw bad(`big payment ${o.hash}: unknown exchange name`);
  return o;
}

// A chunk as it came off the wire. expect: its manifest entry (sha256, first, last, ledgers), checked too.
export function decodeChunk(buf, expect = {}, { maxJson = MAX_JSON, now = Date.now() / 1000, format = FORMAT } = {}) {
  const f = FORMATS[format];
  if (!Buffer.isBuffer(buf) || buf.length > MAX_CHUNK) throw bad("a chunk is too big");
  if (expect.sha256 && sha256(buf) !== expect.sha256) throw bad("a chunk's checksum doesn't match the manifest");
  let c;
  try {
    c = JSON.parse(zlib.brotliDecompressSync(buf, { maxOutputLength: maxJson }));
  } catch {
    throw bad("a chunk isn't readable (or unpacks too big)");
  }
  if (c?.format !== f.format || c.layout !== f.layout) throw bad("a chunk is in a format this version doesn't know");
  if (JSON.stringify(c.cols) !== JSON.stringify(f.cols) || JSON.stringify(c.whaleCols) !== JSON.stringify(WHALE_COLS)) throw bad("a chunk has other columns");
  if (typeof c.rules !== "string" || !/^[0-9a-f]{12}$/.test(c.rules)) throw bad("a chunk doesn't say which rules counted it");
  if (!Array.isArray(c.ledgers) || !c.ledgers.length || !Array.isArray(c.whales)) throw bad("a chunk has no ledgers");
  const ledgers = c.ledgers.map((r) => checkLedger(r, now, f));
  ledgers.forEach((o, k) => {
    if (k && o.idx !== ledgers[k - 1].idx + 1) throw bad(`a chunk has a hole after ledger ${ledgers[k - 1].idx}`);
  });
  const first = ledgers[0].idx,
    last = ledgers.at(-1).idx;
  if ((expect.first != null && expect.first !== first) || (expect.last != null && expect.last !== last) || (expect.ledgers != null && expect.ledgers !== ledgers.length))
    throw bad("a chunk's ledgers don't match the manifest");
  const whales = c.whales.map((w) => checkWhale(w, first, last));
  return { rules: c.rules, first, last, ledgers, whales };
}

// ---------- the manifest ----------

// The signed bytes are the manifest file itself; the signature sits beside it (manifest.json.sig, base64).
export function signManifest(manifest, privateKey) {
  const body = Buffer.from(`${JSON.stringify(manifest, null, 1)}\n`);
  return { body, sig: `${crypto.sign(null, body, privateKey).toString("base64")}\n` };
}

export function readManifest(body, sig, publicKey = PUBLIC_KEY, format = FORMAT) {
  if (!publicKey) throw bad("this version has no publisher key");
  if (!Buffer.isBuffer(body) || body.length > MAX_MANIFEST) throw bad("the manifest is too big");
  let ok = false;
  try {
    ok = crypto.verify(null, body, publicKey, Buffer.from(String(sig).trim(), "base64"));
  } catch {
    ok = false;
  }
  if (!ok) throw bad("the manifest's signature doesn't check out");
  const m = JSON.parse(body);
  if (m?.format !== format || m.chain !== "xrpl" || typeof m.updated !== "string" || !Array.isArray(m.chunks)) throw bad("the manifest is in a format this version doesn't know");
  for (const e of m.chunks) {
    if (typeof e?.name !== "string" || !NAME.test(e.name)) throw bad("the manifest names a chunk oddly");
    if (!isInt(e.first, 1, 1e12) || !isInt(e.last, e.first, 1e12) || e.ledgers !== e.last - e.first + 1) throw bad(`${e.name}: bad ledger range`);
    if (typeof e.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(e.sha256) || !isInt(e.bytes, 1, MAX_CHUNK) || !isInt(e.from, RIPPLE_EPOCH, 4e9) || !isInt(e.to, e.from, 4e9)) throw bad(`${e.name}: bad entry`);
    if (typeof e.rules !== "string" || !/^[0-9a-f]{12}$/.test(e.rules)) throw bad(`${e.name}: no rules`);
  }
  if (!Array.isArray(m.revoked) || m.revoked.some((n) => typeof n !== "string" || !NAME.test(n))) throw bad("the manifest's revoked list is odd");
  return m;
}
