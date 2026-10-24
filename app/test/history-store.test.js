// The Kraken history store as the server reads it (lib/history.js), on a store of its own: never the
// real one. Market data's requests go to the importer's jobs folder, unless this copy reads another
// copy's store (QT_HISTORY_JOBS=off), when the importer that would run them is that copy's. The CSV
// download (exportSeries) is checked against bars written with the importer's own db.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qt-history-"));
process.env.QT_HISTORY = path.join(dir, "bars.sqlite");
const H = await import("../lib/history.js");
const jobFiles = () => (fs.existsSync(path.join(dir, "jobs")) ? fs.readdirSync(path.join(dir, "jobs")) : []);

test("a copy that reads another's store queues nothing for it (QT_HISTORY_JOBS=off)", () => {
  process.env.QT_HISTORY_JOBS = "off";
  try {
    for (const job of [{ cmd: "update" }, { cmd: "remove", pair: "XRPUSD" }, { cmd: "add", pair: "ATOMUSD" }, { cmd: "automatic", on: false }])
      assert.throws(() => H.requestJob(job), (e) => e.status === 403 && /read only/.test(e.message), job.cmd);
    assert.deepEqual(jobFiles(), []);
    assert.equal(H.status().jobs, false);
  } finally {
    delete process.env.QT_HISTORY_JOBS;
  }
});

test("otherwise a request is queued for the importer, once", () => {
  assert.equal(H.status().jobs, true);
  H.requestJob({ cmd: "remove", pair: "xrpusd" });
  H.requestJob({ cmd: "remove", pair: "XRPUSD" });
  assert.equal(jobFiles().length, 1);
  assert.deepEqual(H.status().queued.map((q) => [q.cmd, q.pair]), [["remove", "XRPUSD"]]);
  assert.throws(() => H.requestJob({ cmd: "drop table" }), (e) => e.status === 400);
});

test("a coin's stored bars export in order, pages of the size asked, a symbol not stored gives nothing", async () => {
  const hdb = await import("../../history/db.mjs");
  const file = path.join(dir, "bars.sqlite");
  const d = hdb.openDb(file);
  const src = hdb.sourceId(d, "test");
  const s = hdb.seriesId(d, "KRAKEN", "ZZZUSD", 60);
  const rows = [];
  for (let i = 0; i < 23; i++) rows.push({ t: 60 * i, o: 1 + i, h: 2 + i, l: 0.5 + i, c: 1.5 + i, v: 10 + i, n: 1 });
  hdb.upsertBars(d, s, src, rows);
  d.close();

  assert.equal(H.exportSeries("KRAKEN", "NOPE"), null, "a symbol with no bars in this store");
  const exp = H.exportSeries("KRAKEN", "ZZZUSD", { page: 10 });
  assert.equal(exp.symbol, "ZZZUSD");
  assert.equal(exp.tfSeconds, 60);
  const pages = [...exp.rows()];
  assert.deepEqual(pages.map((p) => p.length), [10, 10, 3], "23 rows, pages of 10");
  const all = pages.flat();
  assert.deepEqual(all.map((r) => r.t), rows.map((r) => r.t)), "oldest first, every bar once";
  assert.equal(all[0].o, 1);
  assert.equal(all.at(-1).c, 23.5);
});

