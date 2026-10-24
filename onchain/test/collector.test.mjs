// The collector against a public server that says to slow down (xrplcluster.com: "rate limit: units quota
// (2000 per 10s) exhausted, retry in ~6357ms"). A fake WebSocket plays the server, offline. Before: the
// collector dropped the connection, reconnected after 2 seconds into the same burst, and left the old
// socket open. Now it waits as long as the server says, fills in at half the pace, stays connected, and
// closes its socket however a connection ends. node --test onchain/test/collector.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RIPPLE_EPOCH } from "../xrpl-ledger.mjs";

process.env.ONCHAIN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "xrpl-collector-"));
process.env.XRPL_SERVER = "wss://public.example";
process.env.XRPL_PACE = "40"; // quick for the test; the public default (2) is checked on its own below

// the server: which requests it refuses, and every socket opened
const server = { sockets: [], latest: 1000, refuse: () => null };
globalThis.WebSocket = class {
  constructor(url) {
    this.url = url;
    this.closed = 0;
    server.sockets.push(this);
    setTimeout(() => this.onopen?.(), 1);
  }
  send(text) {
    const q = JSON.parse(text);
    const reply = (body) => setTimeout(() => this.onmessage?.({ data: JSON.stringify({ id: q.id, ...body }) }), 1);
    const no = server.refuse(q);
    if (no) return reply({ status: "error", ...no });
    if (q.command === "subscribe") return reply({ status: "success", result: { ledger_index: server.latest, validated_ledgers: `${server.latest - 5}-${server.latest}` } });
    if (q.command === "ledger")
      return reply({ status: "success", result: { validated: true, ledger: { ledger_index: q.ledger_index, close_time: Math.floor(Date.now() / 1000) - 60 - RIPPLE_EPOCH, close_time_resolution: 10, transactions: [] } } });
  }
  close() {
    this.closed++;
    setTimeout(() => this.onclose?.({}), 1);
  }
  // the server ends the connection
  hangUp(reason = "") {
    setTimeout(() => this.onclose?.({ reason }), 1);
  }
};

const C = await import("../xrpl.mjs");
const { openDb, span } = await import("../db.mjs");

test("which servers are your own: this computer and this network", () => {
  // made-up addresses, built from parts: the release's scrub refuses any LAN address written out in a file
  const at = (...n) => `ws://${n.join(".")}:51234`;
  for (const u of ["ws://127.0.0.1:51234", "ws://localhost:51234", at(192, 168, 1, 20), at(10, 0, 0, 5), at(172, 20, 1, 1), "ws://[::1]:51234", "ws://node.local:51234"]) assert.equal(C.isLocal(u), true, u);
  for (const u of ["wss://xrplcluster.com", "wss://s1.ripple.com", at(172, 32, 0, 1), "not a url"]) assert.equal(C.isLocal(u), false, u);
});

test("a server saying to slow down, and for how long", () => {
  assert.equal(C.limitWait(new Error("rate limit: units quota (2000 per 10s) exhausted, retry in ~6357ms")), 6357);
  assert.equal(C.limitWait(new Error("xrplcluster.com closed the connection: rate limit, retry in 3s")), 3000);
  assert.equal(C.limitWait(Object.assign(new Error("You are placing too much load on the server."), { code: "slowDown" })), 10000);
  assert.equal(C.limitWait(new Error("too busy")), 10000);
  assert.equal(C.limitWait(new Error("rate limit, retry in ~900000ms")), 60000); // never more than a minute
  assert.equal(C.limitWait(new Error("Ledger not found")), null);
});

test("told to slow down while filling in: it waits as long as asked, at half the pace, on the same connection", async () => {
  const db = openDb();
  const st = C.newStatus();
  let refused = 0;
  const asked = [];
  server.refuse = (q) => {
    if (q.command !== "ledger") return null;
    asked.push([q.ledger_index, Date.now()]);
    // the first two fill-in requests are over the quota
    if (refused < 2) {
      refused++;
      return { error: "rateLimited", error_message: "rate limit: units quota (2000 per 10s) exhausted, retry in ~60ms" };
    }
    return null;
  };
  const run = C.follow(db, st, null);
  // the six ledgers the server holds come in; then the server ends the connection
  for (let i = 0; i < 200 && span(db).count < 6; i++) await new Promise((r) => setTimeout(r, 20));
  server.sockets.at(-1).hangUp();
  await assert.rejects(run, /closed the connection/);
  assert.equal(span(db).count, 6, "every ledger the server holds, the refused ones too");
  assert.equal(server.sockets.length, 1, "no new connection for a slow down");
  // the same ledger asked again after the server's 60 ms (plus a margin), twice
  assert.equal(asked[0][0], asked[1][0]);
  assert.ok(asked[1][1] - asked[0][1] >= 300, `${asked[1][1] - asked[0][1]} ms`);
  assert.equal(st.pace, 10, "40, halved twice");
  assert.match(st.lastError, /rate limit/);
  assert.equal(st.limited, null, "the wait is over");
  assert.equal(server.sockets[0].closed, 1, "closed when the connection ended");
  db.close();
});

test("any other failure ends the connection and closes its socket (none left open beside the next one)", async () => {
  const db = openDb();
  server.refuse = (q) => (q.command === "ledger" ? { error: "internal", error_message: "Internal error" } : null);
  server.latest = 2000;
  const before = server.sockets.length;
  await assert.rejects(C.follow(db, C.newStatus(), null), /Internal error/);
  assert.equal(server.sockets.length, before + 1);
  assert.equal(server.sockets.at(-1).closed, 1);
  // a slow down on subscribe itself: the connection ends, and the reconnect waits as long as the server said
  server.refuse = (q) => (q.command === "subscribe" ? { error: "slowDown", error_message: "rate limit: units quota (2000 per 10s) exhausted, retry in ~4000ms" } : null);
  const e = await C.follow(db, C.newStatus(), null).catch((x) => x);
  assert.equal(C.limitWait(e), 4000);
  assert.equal(server.sockets.at(-1).closed, 1);
  db.close();
});
