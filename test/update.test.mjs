// Offline tests of AskCharts' updates: the signed checksums, the checks on every file, the version rule, and how
// the installer is started on each system. node --test test/update.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compare, readSums, latest, download, launch } from "../update.mjs";

const keys = crypto.generateKeyPairSync("ed25519");
const pub = [keys.publicKey.export({ type: "spki", format: "pem" })];
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

// a release as GitHub serves it: files, their checksums, the signature
function release(version, { sign = keys.privateKey, tamper = {} } = {}) {
  const files = {
    "release.json": Buffer.from(JSON.stringify({ version, date: "2026-10-22", notes: `What's new in ${version}` })),
    "askcharts.tar.gz": Buffer.from(`archive ${version}`),
    "install.sh": Buffer.from("#!/bin/sh\necho installing\n"),
    "install.ps1": Buffer.from("Write-Host installing\n"),
  };
  const sums = Buffer.from(Object.entries(files).map(([n, b]) => `${sha(b)}  ${n}\n`).join(""));
  const all = { ...files, SHA256SUMS: sums, "SHA256SUMS.sig": Buffer.from(crypto.sign(null, sums, sign).toString("base64")), ...tamper };
  return async (url) => {
    const name = url.split("/").pop();
    return all[name] ? new Response(all[name]) : new Response("", { status: 404 });
  };
}
const BASE = "https://releases.example";

test("versions compare as numbers, part by part", () => {
  assert.ok(compare("0.1.10", "0.1.9") > 0);
  assert.ok(compare("0.2.0", "0.1.99") > 0);
  assert.equal(compare("0.1.4", "0.1.4"), 0);
  assert.ok(compare("0.1.4", "0.1.5") < 0);
});

test("the newest release, read only when its signature and checksum check out", async () => {
  assert.deepEqual(await latest({ base: BASE, fetch: release("0.1.5"), keys: pub }), { version: "0.1.5", date: "2026-10-22", notes: "What's new in 0.1.5" });
  const other = crypto.generateKeyPairSync("ed25519").privateKey;
  await assert.rejects(latest({ base: BASE, fetch: release("0.1.5", { sign: other }), keys: pub }), /signature/);
  await assert.rejects(latest({ base: BASE, fetch: release("0.1.5", { tamper: { "release.json": Buffer.from('{"version":"9.9.9","date":"x","notes":""}') } }), keys: pub }), /doesn't match/);
  assert.throws(() => readSums(Buffer.from("x"), "AAAA", pub), /signature/);
});

test("an update downloads and checks every file, and refuses an older or equal version", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "askcharts-update-"));
  const got = await download({ base: BASE, dir, current: "0.1.4", fetch: release("0.1.5"), keys: pub, platform: "linux" });
  assert.equal(got.version, "0.1.5");
  assert.equal(got.installer, path.join(dir, "install.sh"));
  assert.deepEqual(fs.readdirSync(dir).sort(), ["SHA256SUMS", "SHA256SUMS.sig", "askcharts.tar.gz", "install.sh", "release.json"]);
  assert.equal(fs.readFileSync(path.join(dir, "askcharts.tar.gz"), "utf8"), "archive 0.1.5");
  // Windows gets its own installer
  assert.equal((await download({ base: BASE, dir, current: "0.1.4", fetch: release("0.1.5"), keys: pub, platform: "win32" })).installer, path.join(dir, "install.ps1"));
  await assert.rejects(download({ base: BASE, dir, current: "0.1.5", fetch: release("0.1.5"), keys: pub }), /isn't newer/);
  await assert.rejects(download({ base: BASE, dir, current: "0.1.6", fetch: release("0.1.5"), keys: pub }), /isn't newer/);
  await assert.rejects(download({ base: BASE, dir, current: "0.1.4", fetch: release("0.1.5", { tamper: { "askcharts.tar.gz": Buffer.from("something else") } }), keys: pub }), /askcharts.tar.gz doesn't match/);
  // a server that says, or sends, far too much
  const huge = async (url) => (url.endsWith(".gz") ? new Response("x", { headers: { "content-length": String(500e6) } }) : release("0.1.5")(url));
  await assert.rejects(download({ base: BASE, dir, current: "0.1.4", fetch: huge, keys: pub }), /too big/);
  fs.rmSync(dir, { recursive: true });
});

test("the installer starts on its own, as each system needs it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "askcharts-launch-"));
  const calls = [];
  const spawnFn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { unref() {} };
  };
  const base = { installer: "/tmp/x/install.sh", source: "/tmp/x", logFile: path.join(dir, "update.log"), spawnFn };
  launch({ ...base, install: { dir: "/home/me/AskCharts", label: "askcharts", starter: "systemd" }, platform: "linux" });
  launch({ ...base, install: { dir: "/Users/me/AskCharts", label: "askcharts", starter: "launchd" }, platform: "darwin" });
  launch({ ...base, install: { dir: "/home/me/AskCharts", label: "askcharts", starter: "autostart", updateBase: "http://127.0.0.1:9" }, platform: "linux" });
  launch({ ...base, installer: "C:\\x\\install.ps1", install: { dir: "C:\\Users\\me\\AskCharts", label: "askcharts", starter: "windows" }, platform: "win32" });
  // systemd: a unit of its own, so stopping AskCharts's service doesn't stop the update
  assert.equal(calls[0].cmd, "systemd-run");
  assert.ok(calls[0].args.includes("--user") && calls[0].args.includes("--collect") && calls[0].args.some((a) => /^--unit=askcharts-update-\d+$/.test(a)));
  assert.ok(calls[0].args.includes("--setenv=ASKCHARTS_SOURCE=/tmp/x") && calls[0].args.includes("--setenv=ASKCHARTS_UPDATE=1") && calls[0].args.includes("--setenv=ASKCHARTS_NO_OPEN=1"));
  // Mac and autostart: a detached process of its own
  assert.equal(calls[1].cmd, "/bin/sh");
  assert.equal(calls[1].opts.detached, true);
  assert.equal(calls[1].opts.env.ASKCHARTS_HOME, "/Users/me/AskCharts");
  assert.equal(calls[2].opts.env.ASKCHARTS_NO_SERVICE, "1");
  assert.equal(calls[2].opts.env.ASKCHARTS_UPDATE_BASE, "http://127.0.0.1:9");
  // Windows: PowerShell, detached
  assert.equal(calls[3].cmd, "powershell.exe");
  assert.ok(calls[3].args.includes("-File") && calls[3].opts.detached);
  fs.rmSync(dir, { recursive: true });
});
