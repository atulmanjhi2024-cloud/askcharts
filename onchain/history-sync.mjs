// Shared XRPL history on an install: the publisher's signed manifest, then every chunk in the keep window with
// ledgers this store is missing, each checked (xrpl-history.mjs) before a row goes in. The collector runs this
// on start and after a reconnect, before the slow ledger by ledger fill, and once an hour. It only downloads.
// It reads format 2 (xrpl/v2/, with the DEX columns); format 1 is for installs up to 0.1.12, and the tests.
import { readManifest, decodeChunk, FORMATS, MAX_CHUNK, MAX_MANIFEST, PUBLIC_KEY } from "./xrpl-history.mjs";
import { importChunk, fillDex, clearDex, dropLedgers, getState, setState } from "./db.mjs";

// Per format: what came in from which chunk ([[first, last, name], ...], so a revoked chunk's rows can go again),
// the newest manifest taken, and every name ever revoked. Format 2 also keeps the DEX numbers it filled into rows
// the store had ([[first, last, name], ...]) and the chunks it has taken ({name: to}): a chunk of hours before DEX
// counting began brings nothing to a store that has those ledgers, and mustn't come down again every hour.
const KEYS = {
  1: { IMPORTED: "history.imported", SEEN: "history.updated", REVOKED: "history.revoked" },
  2: { IMPORTED: "history2.imported", SEEN: "history2.updated", REVOKED: "history2.revoked", FILLED: "history2.filled", TAKEN: "history2.taken" },
};
const list = (db, k) => JSON.parse(getState(db, k) || "[]");

// A body read up to `cap` bytes; a bigger one is cut off, not buffered.
async function readCapped(res, cap) {
  const len = Number(res.headers.get("content-length"));
  if (len > cap) throw new Error(`too big (${len} bytes)`);
  const parts = [];
  let size = 0;
  for await (const part of res.body) {
    size += part.length;
    if (size > cap) throw new Error("too big");
    parts.push(part);
  }
  return Buffer.concat(parts);
}

export async function syncHistory({ db, url, keepDays = 90, fetch = globalThis.fetch, now = Date.now() / 1000, timeout = 60000, log = () => {}, publicKey = PUBLIC_KEY, format = 2 }) {
  const f = FORMATS[format],
    { IMPORTED, SEEN, REVOKED, FILLED, TAKEN } = KEYS[format];
  const get = async (path, cap) => {
    const res = await fetch(`${url}/${f.path}/${path}`, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return readCapped(res, cap);
  };
  const m = readManifest(await get("manifest.json", MAX_MANIFEST), (await get("manifest.json.sig", 1000)).toString(), publicKey, format);
  // An older manifest than one already taken is refused, even signed: served again, it could bring back a chunk
  // revoked since. Revoked names are kept for good, so no later manifest brings one back either.
  const seen = getState(db, SEEN);
  if (seen && m.updated < seen) throw new Error(`the manifest (${m.updated}) is older than one already taken (${seen})`);
  setState(db, SEEN, m.updated);
  const revoked = new Set([...JSON.parse(getState(db, REVOKED) || "[]"), ...m.revoked]);
  setState(db, REVOKED, JSON.stringify([...revoked]));
  let imported = list(db, IMPORTED);
  // a revoked chunk: the rows it brought in go (never the store's own), so its fixed chunk fills them again
  let dropped = 0;
  for (const [a, b, name] of imported) if (revoked.has(name)) dropped += dropLedgers(db, a, b);
  imported = imported.filter(([, , name]) => !revoked.has(name));
  setState(db, IMPORTED, JSON.stringify(imported));
  let filled = [],
    taken = {};
  if (format === 2) {
    // a chunk has the same name in both formats: rows this store took from format 1 (before it updated) go too
    const older = list(db, KEYS[1].IMPORTED);
    for (const [a, b, name] of older) if (revoked.has(name)) dropped += dropLedgers(db, a, b);
    setState(db, KEYS[1].IMPORTED, JSON.stringify(older.filter(([, , name]) => !revoked.has(name))));
    // and the DEX numbers a revoked chunk filled in are not counted again
    filled = list(db, FILLED);
    for (const [a, b, name] of filled) if (revoked.has(name)) clearDex(db, a, b);
    filled = filled.filter(([, , name]) => !revoked.has(name));
    setState(db, FILLED, JSON.stringify(filled));
    taken = JSON.parse(getState(db, TAKEN) || "{}");
  }
  const out = { updated: m.updated, rulesMatch: m.rules === f.rules, chunks: m.chunks.length, fetched: 0, added: 0, filled: 0, dropped, failed: 0, lastError: null, newest: m.chunks.at(-1)?.to ?? null };
  // Only chunks wholly inside the keep window: one that starts before it would lose its oldest ledgers to the
  // collector's hourly prune, look incomplete again and come down again every hour.
  const cut = now - keepDays * 86400;
  // format 2: a chunk is needed while its ledgers are missing, or present but not counted, until it's taken once
  const have = db.prepare(`SELECT COUNT(*) AS n FROM ledgers WHERE idx BETWEEN ? AND ?${format === 2 ? " AND dex_got IS NOT NULL" : ""}`);
  for (const e of m.chunks) {
    if (e.from < cut || revoked.has(e.name) || taken[e.name] || have.get(e.first, e.last).n >= e.ledgers) continue;
    try {
      const c = decodeChunk(await get(e.name, MAX_CHUNK), e, { now, format });
      const runs = importChunk(db, c.ledgers, c.whales);
      imported.push(...runs.map(([a, b]) => [a, b, e.name]));
      setState(db, IMPORTED, JSON.stringify(imported));
      if (format === 2) {
        const fills = fillDex(db, c.ledgers);
        filled.push(...fills.map(([a, b]) => [a, b, e.name]));
        setState(db, FILLED, JSON.stringify(filled));
        out.filled += fills.reduce((s, [a, b]) => s + b - a + 1, 0);
        taken[e.name] = e.to;
        setState(db, TAKEN, JSON.stringify(taken));
      }
      out.fetched++;
      out.added += runs.reduce((s, [a, b]) => s + b - a + 1, 0);
    } catch (err) {
      // skipped, never half in: the next sync tries it again
      out.failed++;
      out.lastError = `${e.name}: ${err.message}`;
      log(out.lastError);
    }
  }
  // runs the store has pruned since, and chunks gone out of the keep window
  const first = db.prepare("SELECT MIN(idx) AS i FROM ledgers").get().i;
  setState(db, IMPORTED, JSON.stringify(imported.filter(([, b]) => first != null && b >= first)));
  if (format === 2) {
    setState(db, FILLED, JSON.stringify(filled.filter(([, b]) => first != null && b >= first)));
    setState(db, TAKEN, JSON.stringify(Object.fromEntries(Object.entries(taken).filter(([, to]) => to >= cut))));
  }
  return out;
}
