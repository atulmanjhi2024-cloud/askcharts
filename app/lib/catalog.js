// The Pine catalog that the repo's catalog/ tool fills: public scripts from GitHub that this app's
// interpreter runs, for the community menus of the Indicators dialog. Opened read only on first use.
// A list carries no code; one script's code comes by its key. Keys come from repo and path, so they
// stay the same when the catalog is fetched again.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = process.env.QT_CATALOG || path.join(ROOT, "..", "catalog", "data", "catalog.sqlite");
const PICKS = path.join(path.dirname(FILE), "..", "picks.json");
const NAVS = ["picks", "top", "trending", "market"];
const MISSING = "The catalog isn't built yet. Run node ingest.mjs and node check.mjs in the catalog folder.";

export const keyOf = (repo, p) => crypto.createHash("sha256").update(`${repo}:${p}`).digest("hex").slice(0, 12);

let db = null;
async function open() {
  if (db) return db;
  if (!fs.existsSync(FILE)) return null;
  const { DatabaseSync } = await import("node:sqlite");
  db = new DatabaseSync(FILE, { readOnly: true });
  return db;
}

// Every script that runs here, one per exact copy, and one per title within a repo.
async function runnable() {
  const d = await open();
  if (!d) return null;
  const rows = d
    .prepare(`SELECT s.id, s.repo, s.path, s.author, s.license, s.license_origin, s.norm_hash, c.kind, c.title, c.overlay, c.trades,
      r.stars, r.forks, r.stars_30d, r.pushed_at
      FROM scripts s JOIN checks c ON c.script_id = s.id JOIN repos r ON r.id = s.repo
      WHERE c.status = 'ok' ORDER BY r.stars DESC, s.id`)
    .all();
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const title = String(r.title || path.basename(r.path)).trim();
    const same = `${r.repo}\n${title.toLowerCase()}\n${r.kind}`;
    if (seen.has(r.norm_hash) || seen.has(same)) continue;
    seen.add(r.norm_hash);
    seen.add(same);
    out.push({
      key: keyOf(r.repo, r.path), id: r.id, title, kind: r.kind === "strategy" ? "strategy" : "indicator", overlay: !!r.overlay,
      author: r.author || r.repo.split("/")[0], repo: r.repo, path: r.path, license: r.license || null, licenseFrom: r.license_origin,
      stars: r.stars || 0, forks: r.forks || 0, stars30: r.stars_30d || 0, pushed: r.pushed_at || "", trades: r.trades ?? null,
    });
  }
  return out;
}

// Top and Trending rank repos (a script has no stars of its own), then take one script from each
// repo in turn, so one big collection doesn't fill the list.
function interleave(rows, score) {
  const byRepo = new Map();
  for (const r of [...rows].sort((a, b) => a.title.localeCompare(b.title))) {
    if (!byRepo.has(r.repo)) byRepo.set(r.repo, []);
    byRepo.get(r.repo).push(r);
  }
  const repos = [...byRepo.values()].sort((a, b) => score(b[0]) - score(a[0]) || b[0].pushed.localeCompare(a[0].pushed));
  const out = [];
  for (let i = 0; out.length < rows.length; i++) for (const list of repos) if (list[i]) out.push(list[i]);
  return out;
}

function picks(rows) {
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(PICKS, "utf8"));
  } catch {
    /* no picks file: an empty menu */
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return list.map((p) => byKey.get(keyOf(p.repo, p.path))).filter(Boolean);
}

export async function list(nav) {
  if (!NAVS.includes(nav)) throw Object.assign(new Error("Unknown catalog list"), { status: 400 });
  const rows = await runnable();
  if (!rows) return { rows: [], reason: MISSING };
  const strip = ({ id, pushed, ...r }) => r;
  if (nav === "picks") return { rows: picks(rows).map(strip) };
  if (nav === "top") return { rows: interleave(rows, (r) => Math.log1p(r.stars) + 0.5 * Math.log1p(r.forks)).map(strip) };
  if (nav === "trending") return { rows: interleave(rows, (r) => r.stars30).map(strip) };
  return { rows: [...rows].sort((a, b) => a.title.localeCompare(b.title)).map(strip) };
}

export async function script(key) {
  const rows = await runnable();
  const r = rows?.find((x) => x.key === key);
  if (!r) throw Object.assign(new Error("That script isn't in the catalog any more."), { status: 404 });
  const { code } = db.prepare("SELECT code FROM scripts WHERE id = ?").get(r.id);
  const { id, pushed, ...meta } = r;
  return { ...meta, code };
}
