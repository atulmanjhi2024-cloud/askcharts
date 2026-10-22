// AskCharts' updates: whether a newer release is out, and getting it safely. A release's SHA256SUMS lists
// every file with its sha256 and is signed (ed25519) with a key that never touches GitHub. Nothing is used
// until that signature checks out against KEYS, every file matches its sha256 and the version is newer than
// this one. The installer then swaps the files, on its own: it stops AskCharts to do it.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// The release keys AskCharts trusts. A list, so a new key can arrive in a release the old one signed.
export const KEYS = ["-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAJpeUyCAV645HXyPVjfcJG6UQYqx9EXhFcIbeCkbuTbs=\n-----END PUBLIC KEY-----\n"];
export const RELEASES = "https://github.com/realgrapedrop/askcharts/releases/latest/download";
// Update now on Windows waits until someone has run it on Windows; until then the page shows the install line
export const WINDOWS_TESTED = false;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
// biggest a file may be (the release is under 1 MB in October 2026)
const MAX = { "askcharts.tar.gz": 200e6 };
const MAX_OTHER = 2e6;

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// "0.1.10" against "0.1.9", part by part as numbers: above 0 when a is newer
export function compare(a, b) {
  const x = String(a).split(".").map(Number),
    y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

// A file from the release, cut off (not buffered) past `cap` bytes
async function get(base, name, { fetch, timeout, cap = MAX_OTHER }) {
  let res;
  try {
    res = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(timeout), redirect: "follow" });
  } catch (e) {
    throw new Error(`couldn't download ${name} (${e.name === "TimeoutError" ? "no answer" : e.cause?.code || e.cause?.message || e.message})`);
  }
  if (!res.ok) throw new Error(`couldn't download ${name} (HTTP ${res.status})`);
  if (Number(res.headers.get("content-length")) > cap) throw new Error(`${name} is too big`);
  const parts = [];
  let size = 0;
  for await (const part of res.body) {
    size += part.length;
    if (size > cap) throw new Error(`${name} is too big`);
    parts.push(part);
  }
  return Buffer.concat(parts);
}

// SHA256SUMS ("<sha256>  <file>" lines), once its signature checks out: file name to sha256
export function readSums(sums, sig, keys = KEYS) {
  const s = Buffer.from(String(sig).trim(), "base64");
  const ok = keys.some((k) => {
    try {
      return crypto.verify(null, sums, k, s);
    } catch {
      return false;
    }
  });
  if (!ok) throw new Error("the release's signature doesn't check out");
  const map = new Map();
  for (const line of sums.toString().split("\n")) {
    const m = /^([0-9a-f]{64}) [ *]?([\w.-]+)$/.exec(line.trim());
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

function readRelease(buf) {
  let r;
  try {
    r = JSON.parse(buf);
  } catch {
    throw new Error("release.json isn't readable");
  }
  if (!VERSION.test(r?.version) || typeof r.date !== "string" || typeof r.notes !== "string") throw new Error("release.json is odd");
  return { version: r.version, date: r.date.slice(0, 40), notes: r.notes.slice(0, 20000) };
}

// The newest release, checked: { version, date, notes }
export async function latest({ base = RELEASES, fetch = globalThis.fetch, keys = KEYS, timeout = 30000 } = {}) {
  const o = { fetch, timeout };
  const sums = readSums(await get(base, "SHA256SUMS", o), (await get(base, "SHA256SUMS.sig", o)).toString(), keys);
  const rel = await get(base, "release.json", o);
  if (sha(rel) !== sums.get("release.json")) throw new Error("release.json doesn't match the signed checksums");
  return readRelease(rel);
}

// Everything an update needs, into dir (emptied first), each file checked as it comes. A version that isn't
// newer than `current` is refused, signed or not: an old release served again could bring old bugs back.
export async function download({ base = RELEASES, dir, current, fetch = globalThis.fetch, keys = KEYS, platform = process.platform, timeout = 300000 }) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const o = { fetch, timeout };
  const sumsBuf = await get(base, "SHA256SUMS", o),
    sig = (await get(base, "SHA256SUMS.sig", o)).toString();
  const sums = readSums(sumsBuf, sig, keys);
  const installer = platform === "win32" ? "install.ps1" : "install.sh";
  let release = null;
  for (const f of ["release.json", installer, "askcharts.tar.gz"]) {
    if (!sums.has(f)) throw new Error(`${f} isn't in the release's checksums`);
    const buf = await get(base, f, { ...o, cap: MAX[f] || MAX_OTHER });
    if (sha(buf) !== sums.get(f)) throw new Error(`${f} doesn't match its signed checksum`);
    if (f === "release.json") {
      release = readRelease(buf);
      if (compare(release.version, current) <= 0) throw new Error(`${release.version} isn't newer than ${current}`);
    }
    fs.writeFileSync(path.join(dir, f), buf, { mode: 0o600 });
  }
  // the installer checks the archive against these again
  fs.writeFileSync(path.join(dir, "SHA256SUMS"), sumsBuf, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "SHA256SUMS.sig"), sig, { mode: 0o600 });
  return { ...release, installer: path.join(dir, installer) };
}

// The installer, started on its own: it stops AskCharts, and this process with it, to swap the files.
// install: the install record the installer wrote (its folder, its login item and how that starts AskCharts).
export function launch({ installer, source, install, logFile, platform = process.platform, spawnFn = spawn }) {
  const env = {
    ASKCHARTS_SOURCE: source,
    ASKCHARTS_HOME: install.dir,
    ASKCHARTS_LABEL: install.label,
    ASKCHARTS_NO_OPEN: "1",
    ASKCHARTS_UPDATE: "1",
    ...(install.updateBase ? { ASKCHARTS_UPDATE_BASE: install.updateBase } : {}),
    ...(install.starter === "autostart" ? { ASKCHARTS_NO_SERVICE: "1" } : {}),
  };
  const out = fs.openSync(logFile, "a");
  if (platform === "win32") {
    spawnFn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installer], { detached: true, stdio: ["ignore", out, out], env: { ...process.env, ...env }, windowsHide: true }).unref();
  } else if (install.starter === "systemd") {
    // its own short-lived unit: stopping the AskCharts service stops everything in its group, this included
    const args = ["--user", `--unit=${install.label}-update-${Date.now()}`, "--collect", "--quiet", ...Object.entries(env).map(([k, v]) => `--setenv=${k}=${v}`)];
    spawnFn("systemd-run", [...args, "/bin/sh", "-c", 'exec /bin/sh "$0" >> "$1" 2>&1', installer, logFile], { stdio: ["ignore", out, out] });
  } else {
    // its own session, so stopping AskCharts's process group leaves it running
    spawnFn("/bin/sh", [installer], { detached: true, stdio: ["ignore", out, out], env: { ...process.env, ...env } }).unref();
  }
  fs.closeSync(out);
}
