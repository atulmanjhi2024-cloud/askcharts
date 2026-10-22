#!/usr/bin/env node
// AskCharts' runner. It starts the app and keeps it running, along with what goes with it: the history
// importer when there's work for it, the XRPL collector when it's turned on, on a server (Docker) the sign-in
// gateway, and on a computer the updates (update.mjs: a daily check, and Update now in Settings, Updates).
// Plain Node, nothing to install.
//
//   node run.mjs            start, and print the address
//   node run.mjs --open     start, then open AskCharts in the browser (the desktop installers do this)
//
// Everything you make lives in ASKCHARTS_DATA (default: data/ beside this file), never beside the
// code, so updating AskCharts never touches it:
//   app/       charts, layouts, watchlists, alerts and settings     custom/    your own indicators
//   history/   Kraken's bars (Settings, Market data)                 onchain/   the XRP Ledger store
//   gateway/   passkeys and sessions (a server only)                  updates/   what the Updates page shows
//
// Settings (environment):
//   PORT                 the app's port: 3777, or the next free one (with the gateway on: that port or no start)
//   ASKCHARTS_GATEWAY=1  run the sign-in gateway in front of the app (Docker sets it), with
//     ASKCHARTS_ORIGIN   the address people open, like https://charts.example.com
//     ASKCHARTS_EMAIL    the one account that can sign in
//     ASKCHARTS_TRUST_PROXY   what's in front: cloudflare, forwarded (Caddy, nginx), or empty for nothing
//     ASKCHARTS_GATEWAY_PORT, ASKCHARTS_GATEWAY_HOST   where the gateway listens (3778, 0.0.0.0)
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASES, WINDOWS_TESTED, latest, download, launch, compare } from "./update.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.ASKCHARTS_DATA || path.join(HERE, "data"));
const OPEN = process.argv.includes("--open");
const dirs = Object.fromEntries(["app", "custom", "history", "onchain", "gateway", "updates"].map((d) => [d, path.join(DATA, d)]));
const log = (who, msg) => console.log(`${new Date().toISOString()} [${who}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true, mode: 0o700 });

// a closed log (the terminal it was started from, gone) is no reason to stop
for (const s of [process.stdout, process.stderr]) s.on("error", () => {});

// ---- one runner per data folder: a second start just points at the first
const PIDFILE = path.join(DATA, "run.pid"),
  PORTFILE = path.join(DATA, "port");
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
// A process number can be handed to another program after a crash or a restart, so the other runner
// counts only if AskCharts also answers on its port.
const answers = async (port) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`, { signal: AbortSignal.timeout(2000) });
    return r.ok && (await r.json()).name === "AskCharts";
  } catch {
    return false;
  }
};
const other = Number(fs.existsSync(PIDFILE) && fs.readFileSync(PIDFILE, "utf8"));
const otherPort = Number(fs.existsSync(PORTFILE) && fs.readFileSync(PORTFILE, "utf8"));
if (other && other !== process.pid && alive(other) && otherPort && (await answers(otherPort))) {
  console.log(`AskCharts is already running: http://localhost:${otherPort}`);
  if (OPEN) openBrowser(`http://localhost:${otherPort}`);
  process.exit(0);
}
fs.writeFileSync(PIDFILE, String(process.pid));

// ---- the example indicator that comes with the app, into a new custom folder
if (!fs.readdirSync(dirs.custom).length)
  for (const f of fs.readdirSync(path.join(HERE, "app", "custom")).filter((f) => f.endsWith(".js"))) fs.copyFileSync(path.join(HERE, "app", "custom", f), path.join(dirs.custom, f));

// ---- the app's port: the one asked for, or the next free one
const free = (port, host = "127.0.0.1") =>
  new Promise((resolve) => {
    const s = net.createServer().once("error", () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
// The last port used comes first: an installed AskCharts app and the browser's storage for the site
// are tied to the address, port included, so it shouldn't move between logins
const LASTPORT = path.join(DATA, "last-port");
const last = Number(fs.existsSync(LASTPORT) && fs.readFileSync(LASTPORT, "utf8"));
const GATEWAY = process.env.ASKCHARTS_GATEWAY === "1";
let PORT = Number(process.env.PORT) || (!GATEWAY && last) || 3777;
if (GATEWAY) {
  // Behind the gateway the app keeps its port: moved to the next free one, it could land on the gateway's own
  // port, and whatever sends people there (a tunnel, a proxy) would reach the app with no sign in
  const gwPort = Number(process.env.ASKCHARTS_GATEWAY_PORT) || 3778;
  const why =
    PORT === gwPort
      ? `the app and the sign-in gateway are both set to port ${PORT}`
      : !(await free(PORT))
        ? `the app's port ${PORT} is taken`
        : !(await free(gwPort, process.env.ASKCHARTS_GATEWAY_HOST || "0.0.0.0"))
          ? `the sign-in gateway's port ${gwPort} is taken`
          : "";
  if (why) {
    log("runner", `${why}: not starting (PORT and ASKCHARTS_GATEWAY_PORT set them)`);
    process.exit(1);
  }
} else while (!(await free(PORT))) PORT++;
fs.writeFileSync(PORTFILE, String(PORT));
fs.writeFileSync(LASTPORT, String(PORT));

const base = { ...process.env };
delete base.PORT;
delete base.HOST;
const appEnv = {
  ...base,
  HOST: "127.0.0.1",
  PORT: String(PORT),
  QT_NO_OPEN: "1",
  QT_DATA_DIR: dirs.app,
  QT_CUSTOM_DIR: dirs.custom,
  QT_HISTORY: path.join(dirs.history, "bars.sqlite"),
  HISTORY_DATA: dirs.history,
  QT_ONCHAIN: path.join(dirs.onchain, "xrpl.sqlite"),
  ONCHAIN_DATA: dirs.onchain,
  QT_CATALOG: path.join(HERE, "catalog", "data", "catalog.sqlite"),
  ASKCHARTS_UPDATES: dirs.updates,
};

// ---- children: their output in this log, a restart after a crash (waiting longer each time)
const kids = new Map(),
  backoff = new Map();
let stopping = false;
function run(name, args, env, { restart = false } = {}) {
  const started = Date.now();
  // the fourth channel ties the child to this runner: it exits when the runner goes, however it goes
  const child = spawn(process.execPath, args, { cwd: HERE, env, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  kids.set(name, child);
  // the app passes on Settings, Updates' Check now and Update now
  if (name === "app") child.on("message", (m) => (m?.updates === "check" ? checkUpdates() : m?.updates === "install" ? installUpdate() : null));
  for (const s of [child.stdout, child.stderr]) {
    let rest = "";
    s.on("data", (b) => {
      const lines = (rest + b).split(/\r?\n/);
      rest = lines.pop();
      for (const l of lines) if (l.trim()) log(name, l);
    });
  }
  child.on("exit", (code, signal) => {
    if (kids.get(name) === child) kids.delete(name);
    if (stopping) return;
    if (code || signal) log(name, `stopped (${signal || `exit ${code}`})`);
    if (!restart) return;
    // back after 2 seconds, then 4, 8 ... a minute while it keeps failing straight away
    const wait = Date.now() - started > 60000 ? 2 : Math.min(60, (backoff.get(name) || 1) * 2);
    backoff.set(name, wait);
    setTimeout(() => !stopping && !kids.has(name) && run(name, args, env, { restart }), wait * 1000);
  });
  return child;
}
const stop = (name) => {
  const c = kids.get(name);
  if (!c) return;
  kids.delete(name);
  c.kill("SIGTERM");
};

run("app", [path.join("app", "server.js")], appEnv, { restart: true });

// ---- the gateway, on a server
if (GATEWAY) {
  const origin = process.env.ASKCHARTS_ORIGIN || "";
  let rpID = "";
  try {
    rpID = new URL(origin).hostname;
  } catch {
    log("runner", "ASKCHARTS_ORIGIN isn't set to an address like https://charts.example.com: the gateway can't start");
  }
  if (rpID)
    run(
      "gateway",
      [path.join("gateway", "server.js")],
      {
        ...base,
        HOST: process.env.ASKCHARTS_GATEWAY_HOST || "0.0.0.0",
        PORT: process.env.ASKCHARTS_GATEWAY_PORT || "3778",
        UPSTREAM: `127.0.0.1:${PORT}`,
        ORIGIN: origin,
        RP_ID: rpID,
        ALLOWED_EMAIL: process.env.ASKCHARTS_EMAIL || "",
        TRUST_PROXY: process.env.ASKCHARTS_TRUST_PROXY || "",
        DATA_DIR: dirs.gateway,
      },
      { restart: true },
    );
}

// ---- Kraken's history: requests from Settings, Market data at once, the hourly update (which does
// nothing while Automatic is off). One at a time: the importer waits for its own lock anyway.
const histEnv = { ...base, HISTORY_DATA: dirs.history };
const history = (cmd) => !kids.has("history") && run("history", [path.join("history", "kraken.mjs"), cmd], histEnv);
const jobsDir = path.join(dirs.history, "jobs");
setInterval(() => {
  try {
    if (fs.readdirSync(jobsDir).some((f) => f.endsWith(".json"))) history("jobs");
  } catch {
    /* no requests yet */
  }
}, 5000);
// the hourly update only while Automatic is on: off, there's nothing to do and no store to open
const automatic = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dirs.history, "settings.json"), "utf8")).kraken?.automatic === true;
  } catch {
    return false;
  }
};
setTimeout(() => {
  if (automatic()) history("update");
  setInterval(() => automatic() && history("update"), 3600e3);
}, 600e3);

// ---- XRPL On chain: on, off, which server and the shared history, from Settings, Market data
const xrplSettings = path.join(dirs.onchain, "settings.json");
// the shared history: up to 90 days of ledgers, published hourly and signed (onchain/history-sync.mjs)
const XRPL_HISTORY = "https://data.askcharts.pro";
let xrplServer = null,
  xrplHistory = null;
setInterval(() => {
  let s = {};
  try {
    s = JSON.parse(fs.readFileSync(xrplSettings, "utf8"));
  } catch {
    /* never turned on */
  }
  const on = s.enabled === true,
    server = s.server || "wss://xrplcluster.com",
    history = s.history !== false;
  if (kids.has("xrpl") && (!on || server !== xrplServer || history !== xrplHistory)) {
    log("runner", !on ? "XRPL On chain: turned off" : server !== xrplServer ? `XRPL On chain: switching to ${server}` : `XRPL On chain: shared history ${history ? "on" : "off"}`);
    stop("xrpl");
  }
  if (on && !kids.has("xrpl")) {
    xrplServer = server;
    xrplHistory = history;
    log("runner", `XRPL On chain: following the ledger through ${server}${history ? `, history from ${XRPL_HISTORY}` : ""}`);
    run("xrpl", [path.join("onchain", "xrpl.mjs"), "run"], { ...base, ONCHAIN_DATA: dirs.onchain, XRPL_SERVER: server, XRPL_HISTORY_URL: history ? XRPL_HISTORY : "", XRPL_BACKFILL_DAYS: "1", XRPL_KEEP_DAYS: "90", XRPL_PACE: "5" });
  }
}, 5000);

// ---- the address, and the browser
const url = `http://localhost:${PORT}`;
(async () => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  log("runner", `AskCharts is running: ${url}${GATEWAY ? ` (behind the sign-in gateway on port ${process.env.ASKCHARTS_GATEWAY_PORT || 3778})` : ""}`);
  if (OPEN) openBrowser(url);
})();

// ---- updates: a daily check, and Update now (Settings, Updates). Only an install the installer made can
// update itself: its install.json says where it is and how it starts. Docker gets the commands instead.
const VERSION = fs.readFileSync(path.join(HERE, "VERSION"), "utf8").trim();
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
};
// the same folder however it's written (a linked home folder; a drive letter in another case on Windows)
const real = (p) => {
  try {
    p = fs.realpathSync(p);
  } catch {
    /* gone: as written */
  }
  return process.platform === "win32" ? p.toLowerCase() : p;
};
function installRecord() {
  const r = readJson(path.join(HERE, "..", "install.json"));
  return r && typeof r.dir === "string" && real(path.resolve(r.dir, "program")) === real(HERE) ? r : null;
}
const UPDATES = { status: path.join(dirs.updates, "status.json"), settings: path.join(dirs.updates, "settings.json"), result: path.join(dirs.updates, "result.json") };
let update = { state: "idle", checkedAt: null, latest: null, newer: false, error: null, target: null };
function writeUpdates() {
  const rec = installRecord();
  const s = {
    version: VERSION,
    kind: rec ? "desktop" : fs.existsSync("/.dockerenv") ? "docker" : "manual",
    starter: rec?.starter || null,
    updatable: !!rec && (rec.starter !== "windows" || WINDOWS_TESTED),
    // Docker: the folder on the server it was started from (compose.yaml passes it), for the update steps
    folder: /^(\/|[A-Za-z]:\\)/.test(process.env.ASKCHARTS_FOLDER || "") ? process.env.ASKCHARTS_FOLDER.slice(0, 300) : null,
    autoCheck: readJson(UPDATES.settings)?.autoCheck !== false,
    // where the check looks when it isn't GitHub: the update address the installer was given (a private channel)
    updateHost: updateBase() === RELEASES ? null : updateBase().replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "").slice(0, 100),
    ...update,
    result: readJson(UPDATES.result),
    updatedAt: new Date().toISOString(),
  };
  const tmp = `${UPDATES.status}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
  fs.renameSync(tmp, UPDATES.status);
}
const updateBase = () => installRecord()?.updateBase || process.env.ASKCHARTS_UPDATE_BASE || RELEASES;
async function checkUpdates() {
  if (update.state !== "idle") return;
  update = { ...update, state: "checking", error: null };
  writeUpdates();
  try {
    const l = await latest({ base: updateBase() });
    update = { ...update, latest: l, newer: compare(l.version, VERSION) > 0 };
  } catch (e) {
    update.error = e.message;
  }
  update = { ...update, state: "idle", checkedAt: new Date().toISOString() };
  writeUpdates();
}
async function installUpdate() {
  const rec = installRecord();
  if (!rec || update.state !== "idle" || (rec.starter === "windows" && !WINDOWS_TESTED)) return;
  update = { ...update, state: "downloading", error: null };
  writeUpdates();
  try {
    // everything downloaded and checked before anything stops
    const dir = path.join(dirs.updates, "next");
    const got = await download({ base: updateBase(), dir, current: VERSION });
    update = { ...update, state: "installing", target: got.version };
    writeUpdates();
    log("runner", `updating to ${got.version}: the installer stops AskCharts, swaps it and starts it again`);
    // the result on file now: a different one, later, is this update's (the installer's clock reads seconds only)
    const launched = Date.now(),
      before = JSON.stringify(readJson(UPDATES.result));
    launch({ installer: got.installer, source: dir, install: rec, logFile: path.join(dirs.updates, "update.log") });
    // All well, the installer stops this runner. If it fails before that, it writes why in result.json: back
    // to idle with the reason (and after 15 minutes without a word, too).
    const watch = setInterval(() => {
      const r = readJson(UPDATES.result);
      const fresh = !!r && JSON.stringify(r) !== before;
      if (!fresh && Date.now() - launched < 15 * 60e3) return;
      clearInterval(watch);
      update = { ...update, state: "idle", target: null, error: fresh ? (r.ok ? null : r.reason) : `the installer didn't report back; AskCharts is still on ${VERSION}` };
      writeUpdates();
    }, 2000);
  } catch (e) {
    log("runner", `update: ${e.message}`);
    update = { ...update, state: "idle", error: e.message };
    writeUpdates();
  }
}
// what the last update downloaded is done with by the time AskCharts starts again
fs.rmSync(path.join(dirs.updates, "next"), { recursive: true, force: true });
writeUpdates();
// once a day while it's on, at a random time (not every install at once), the first within the hour
setTimeout(
  function daily() {
    if (readJson(UPDATES.settings)?.autoCheck !== false) checkUpdates();
    setTimeout(daily, (23 + Math.random() * 2) * 3600e3);
  },
  (5 + Math.random() * 55) * 60e3,
);

function openBrowser(u) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [u]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", u]] : ["xdg-open", [u]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref();
  } catch {
    /* no browser to open: the address is in the log */
  }
}

// ---- stop: everything, then this
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  log("runner", "stopping");
  for (const c of kids.values()) c.kill("SIGTERM");
  for (let i = 0; i < 50 && [...kids.values()].some((c) => c.exitCode === null && c.signalCode === null); i++) await sleep(100);
  try {
    if (Number(fs.readFileSync(PIDFILE, "utf8")) === process.pid) fs.unlinkSync(PIDFILE);
  } catch {
    /* already gone */
  }
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// anything unexpected: say so, stop the children, and exit so the login item starts a fresh runner
for (const ev of ["uncaughtException", "unhandledRejection"])
  process.on(ev, (e) => {
    log("runner", `stopped by an error: ${e?.stack || e}`);
    for (const c of kids.values()) c.kill("SIGTERM");
    process.exit(1);
  });
