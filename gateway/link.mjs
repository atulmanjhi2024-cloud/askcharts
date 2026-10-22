// A one-time sign-in link for the account (ALLOWED_EMAIL), printed here instead of emailed: the way to
// add the first passkey on a server with no mail set up, or a new device later. It works once and
// expires like an emailed one. Run it where the gateway runs, with the same settings:
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
