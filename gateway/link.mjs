// A one-time sign-in link for the account (ALLOWED_EMAIL): the way to add a passkey on a new device,
// the first one included. It works once and expires after LINK_MINUTES (15). Anyone who opens it in
// that time can add a passkey, so only open it on your own device. Run it where the gateway runs,
// with the same settings:
//   node gateway/link.mjs                                     (on the server)
//   docker compose exec askcharts node gateway/link.mjs       (in Docker)
import path from "node:path";
import { configFromEnv } from "./server.js";
import { openAuth } from "./auth.js";

// beside AskCharts' runner (Docker), the settings have AskCharts' names: the runner passes them on to
// the gateway under these, so this does the same
const env = { ...process.env };
env.ALLOWED_EMAIL ||= env.ASKCHARTS_EMAIL || "";
env.ORIGIN ||= env.ASKCHARTS_ORIGIN || "";
if (!env.RP_ID && env.ORIGIN) env.RP_ID = new URL(env.ORIGIN).hostname;
if (!env.DATA_DIR && env.ASKCHARTS_DATA) env.DATA_DIR = path.join(env.ASKCHARTS_DATA, "gateway");
const cfg = configFromEnv(env);
if (!cfg.email) {
  console.error("ALLOWED_EMAIL (ASKCHARTS_EMAIL in Docker) isn't set: it's the account the link signs in.");
  process.exit(1);
}
const auth = openAuth({ dataDir: cfg.dataDir, rpID: cfg.rpID, rpName: "AskCharts", origin: cfg.origin, email: cfg.email, sessionDays: cfg.sessionDays, linkMinutes: cfg.linkMinutes });
const link = auth.createLink(cfg.email);
console.log(`Open this on the device you want to add, within ${link.minutes} minutes. It works once:\n${link.url}`);
