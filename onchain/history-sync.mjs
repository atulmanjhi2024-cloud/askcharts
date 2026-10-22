// Shared XRPL history on an install: the publisher's signed manifest, then every chunk in the keep window with
// ledgers this store is missing, each checked (xrpl-history.mjs) before a row goes in. The collector runs this
// on start and after a reconnect, before the slow ledger by ledger fill, and once an hour. It only downloads.
import { readManifest, decodeChunk, RULES, MAX_CHUNK, MAX_MANIFEST, PUBLIC_KEY } from "./xrpl-history.mjs";
import { importChunk, dropLedgers, getState, setState } from "./db.mjs";

// what came in from which chunk: [[first, last, name], ...], so a revoked chunk's rows can go again; the newest
// manifest taken; every name ever revoked
const IMPORTED = "history.imported",
  SEEN = "history.updated",
  REVOKED = "history.revoked";

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

export async function syncHistory({ db, url, keepDays = 90, fetch = globalThis.fetch, now = Date.now() / 1000, timeout = 60000, log = () => {}, publicKey = PUBLIC_KEY }) {
  const get = async (path, cap) => {
    const res = await fetch(`${url}/xrpl/${path}`, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return readCapped(res, cap);
  };
  const m = readManifest(await get("manifest.json", MAX_MANIFEST), (await get("manifest.json.sig", 1000)).toString(), publicKey);
  // An older manifest than one already taken is refused, even signed: served again, it could bring back a chunk
  // revoked since. Revoked names are kept for good, so no later manifest brings one back either.
  const seen = getState(db, SEEN);
  if (seen && m.updated < seen) throw new Error(`the manifest (${m.updated}) is older than one already taken (${seen})`);
  setState(db, SEEN, m.updated);
  const revoked = new Set([...JSON.parse(getState(db, REVOKED) || "[]"), ...m.revoked]);
  setState(db, REVOKED, JSON.stringify([...revoked]));
  let imported = JSON.parse(getState(db, IMPORTED) || "[]");
  // a revoked chunk: the rows it brought in go (never the store's own), so its fixed chunk fills them again
  let dropped = 0;
  for (const [a, b, name] of imported) if (revoked.has(name)) dropped += dropLedgers(db, a, b);
  imported = imported.filter(([, , name]) => !revoked.has(name));
  setState(db, IMPORTED, JSON.stringify(imported));
  const out = { updated: m.updated, rulesMatch: m.rules === RULES, chunks: m.chunks.length, fetched: 0, added: 0, dropped, failed: 0, lastError: null, newest: m.chunks.at(-1)?.to ?? null };
  // Only chunks wholly inside the keep window: one that starts before it would lose its oldest ledgers to the
  // collector's hourly prune, look incomplete again and come down again every hour.
  const cut = now - keepDays * 86400;
  const have = db.prepare("SELECT COUNT(*) AS n FROM ledgers WHERE idx BETWEEN ? AND ?");
  for (const e of m.chunks) {
    if (e.from < cut || revoked.has(e.name) || have.get(e.first, e.last).n >= e.ledgers) continue;
    try {
      const c = decodeChunk(await get(e.name, MAX_CHUNK), e, { now });
      const runs = importChunk(db, c.ledgers, c.whales);
      imported.push(...runs.map(([a, b]) => [a, b, e.name]));
      setState(db, IMPORTED, JSON.stringify(imported));
      out.fetched++;
      out.added += runs.reduce((s, [a, b]) => s + b - a + 1, 0);
    } catch (err) {
      // skipped, never half in: the next sync tries it again
      out.failed++;
      out.lastError = `${e.name}: ${err.message}`;
      log(out.lastError);
    }
  }
  // runs the store has pruned since
  const first = db.prepare("SELECT MIN(idx) AS i FROM ledgers").get().i;
  setState(db, IMPORTED, JSON.stringify(imported.filter(([, b]) => first != null && b >= first)));
  return out;
}
