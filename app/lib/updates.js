// Settings, Updates on the app's side. AskCharts' runner (run.mjs, update.mjs) checks and updates; the app reads
// what the runner wrote (updates/status.json) and passes Check now and Update now on over the runner's channel.
// Under anything else (no runner, no ASKCHARTS_UPDATES) there are no updates here.
import fs from "node:fs";
import path from "node:path";

const DIR = process.env.ASKCHARTS_UPDATES || "";
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const read = (f) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
};

// The runner's status, and the installer's result read fresh: the installer writes it after the new version
// answers, a moment after the new runner wrote its status
export function status() {
  if (!DIR || !process.send) throw bad("AskCharts' runner isn't running this copy", 404);
  return { ...(read("status.json") || { state: "idle", version: null, kind: "manual", autoCheck: true }), result: read("result.json") };
}

// body: the request's JSON, read by the server
export async function act(body = {}) {
  status();
  if (body.action === "autoCheck") {
    const file = path.join(DIR, "settings.json");
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ autoCheck: body.on === true }));
    fs.renameSync(`${file}.tmp`, file);
    return { ...status(), autoCheck: body.on === true };
  }
  if (body.action !== "check" && body.action !== "install") throw bad("action is check, install or autoCheck");
  process.send({ updates: body.action });
  // an update stops this app in a moment: answer at once
  if (body.action === "install") return { ...status(), state: "downloading" };
  // a check: the runner writes its new state straight away
  await sleep(400);
  return status();
}
