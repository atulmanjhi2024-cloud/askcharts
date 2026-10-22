// Your own data keys (lib/feeds.js): saved only after the provider accepts them, never sent back to the
// page, removable. A stand-in plays each provider; no real key is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qt-keys-"));
process.env.QT_DATA_DIR = dir;
const feeds = await import("../lib/feeds.js");
const file = path.join(dir, "feeds.json");
const read = () => JSON.parse(fs.readFileSync(file, "utf8"));
const answer = (status, body = {}) => async (url, init) => {
  answer.last = { url, headers: init.headers };
  return new Response(JSON.stringify(body), { status });
};
const ALPACA = { provider: "alpaca", keyId: "PKTESTKEYID1234", secretKey: "secret-value-5678", feed: "iex" };

test("nothing saved yet", () => {
  assert.deepEqual(feeds.keysStatus(), { alpaca: { set: false }, polygon: { set: false } });
});

test("a key the provider accepts is saved, privately, and the page only sees its last 4 characters", async () => {
  const r = await feeds.saveKey(ALPACA, { fetchImpl: answer(200, { bar: {} }) });
  assert.deepEqual(r.alpaca, { set: true, hint: "1234", feed: "iex" });
  assert.equal(r.note, "");
  assert.ok(!JSON.stringify(r).includes("secret-value"), "the secret never goes back");
  assert.match(answer.last.url, /\/v2\/stocks\/AAPL\/bars\/latest\?feed=iex$/);
  assert.equal(answer.last.headers["APCA-API-KEY-ID"], "PKTESTKEYID1234");
  assert.equal(read().alpaca.secretKey, "secret-value-5678");
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("a key the provider refuses isn't saved, and its words come without the key", async () => {
  await assert.rejects(
    feeds.saveKey({ ...ALPACA, secretKey: "wrong-secret-0000" }, { fetchImpl: answer(403, { message: "forbidden for wrong-secret-0000" }) }),
    (e) => e.status === 400 && /didn't accept it/.test(e.message) && !e.message.includes("wrong-secret-0000"),
  );
  assert.equal(read().alpaca.secretKey, "secret-value-5678");
});

test("the feed alone can change: the saved key is kept and checked on that feed", async () => {
  const r = await feeds.saveKey({ provider: "alpaca", feed: "sip" }, { fetchImpl: answer(200) });
  assert.equal(r.alpaca.feed, "sip");
  assert.match(answer.last.url, /feed=sip$/);
  assert.equal(read().alpaca.keyId, "PKTESTKEYID1234");
});

test("a provider that can't be reached doesn't stop you: saved, with a note", async () => {
  const r = await feeds.saveKey({ provider: "polygon", apiKey: "poly_key_ABCDEFGH" }, { fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND"); } });
  assert.deepEqual(r.polygon, { set: true, hint: "EFGH" });
  assert.match(r.note, /Couldn't reach Polygon/);
});

test("Polygon's key is saved under polygon (the old massive name goes) and Alpaca's stays", async () => {
  fs.writeFileSync(file, JSON.stringify({ ...read(), massive: { apiKey: "old_massive_key_1" }, other: { keep: true } }));
  await feeds.saveKey({ provider: "polygon", apiKey: "poly_key_IJKLMNOP" }, { fetchImpl: answer(200) });
  const raw = read();
  assert.equal(raw.polygon.apiKey, "poly_key_IJKLMNOP");
  assert.equal(raw.massive, undefined);
  assert.deepEqual(raw.other, { keep: true });
  assert.equal(raw.alpaca.keyId, "PKTESTKEYID1234");
  assert.equal(answer.last.headers.Authorization, "Bearer poly_key_IJKLMNOP");
});

test("checking the saved key; bad input; removing", async () => {
  assert.deepEqual(await feeds.testKey("polygon", { fetchImpl: answer(200) }), { ok: true, message: "It works." });
  const no = await feeds.testKey("polygon", { fetchImpl: answer(401, { error: "Unknown API Key" }) });
  assert.equal(no.ok, false);
  assert.match(no.message, /didn't accept it: Unknown API Key/);
  await assert.rejects(feeds.saveKey({ provider: "polygon", apiKey: "short" }), (e) => e.status === 400);
  await assert.rejects(feeds.saveKey({ provider: "other", apiKey: "whatever-12345" }), (e) => e.status === 400);
  assert.deepEqual(feeds.removeKey("polygon").polygon, { set: false });
  assert.equal(read().polygon, undefined);
  await assert.rejects(feeds.testKey("polygon"), (e) => e.status === 400);
  assert.equal(feeds.keysStatus().alpaca.set, true);
  fs.rmSync(dir, { recursive: true });
});
