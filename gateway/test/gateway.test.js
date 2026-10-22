// Gateway tests against a fake Quant Terminal. The passkey ceremony itself is covered by the
// browser check in the README; these cover everything around it.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGateway, APP_CSP } from "../server.js";

let upstream, gateway, base, origin, cookie, upPort;
const seen = [];
const mails = [];
// Stands in for the passkey ceremony at /step-up/verify: the user id the check proves, or null to fail.
let verifyAs = null;
const fakeVerify = async () => {
  if (!verifyAs) throw Object.assign(new Error("That passkey didn't work."), { status: 401 });
  return { userId: verifyAs };
};

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

before(async () => {
  upstream = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    if (req.url === "/api/custom/refused.js") {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "The file must export default." }));
    }
    if (req.url === "/fail") {
      res.writeHead(502, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "No source could load this chart." }));
    }
    if (req.url === "/vendor/lib.js") {
      res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "public, max-age=86400" });
      return res.end("// lib");
    }
    if (req.url === "/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: first\n\n"); // then stays open
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, url: req.url }));
  });
  upPort = await listen(upstream);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-test-"));
  gateway = createGateway(
    {
      host: "127.0.0.1", port: 0, upstream: `127.0.0.1:${upPort}`,
      origin: "http://localhost:0", rpID: "localhost", email: "You@Example.com",
      sessionDays: 7, linkMinutes: 15, dataDir, mailMode: "log",
    },
    { sendLink: async (link) => { mails.push(link); }, verifyPasskey: fakeVerify },
  );
  const port = await listen(gateway);
  base = `http://127.0.0.1:${port}`;
  origin = "http://localhost:0";
  const s = gateway.auth.createSession(gateway.auth.accountId);
  cookie = `qt_session=${s.id}`;
});

after(() => {
  gateway.closeAllConnections(); gateway.close();
  upstream.closeAllConnections(); upstream.close();
});

const post = (p, body, headers = {}) =>
  fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: JSON.stringify(body) });

test("a page request without a session goes to the sign-in page", async () => {
  const r = await fetch(base + "/", { headers: { Accept: "text/html" }, redirect: "manual" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/login");
});

test("an API request without a session gets 401 and never reaches the terminal", async () => {
  const before = seen.length;
  for (const p of ["/api/quotes", "/custom/x.js", "/js/app.js", "/stream"]) {
    const r = await fetch(base + p);
    assert.equal(r.status, 401, p);
  }
  assert.equal(seen.length, before);
});

test("a forged session cookie is refused", async () => {
  const r = await fetch(base + "/api/quotes", { headers: { Cookie: "qt_session=not-a-real-session-value-at-all" } });
  assert.equal(r.status, 401);
});

test("the sign-in page is public and locked down", async () => {
  const r = await fetch(base + "/login");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Continue with passkey/);
  assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.equal((await fetch(base + "/auth/static/login.js")).status, 200);
  assert.equal((await fetch(base + "/auth/static/simplewebauthn.js")).status, 200);
});

test("a signed-in visit to /login goes straight to the terminal", async () => {
  const r = await fetch(base + "/login", { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/");
});

test("writes from another origin are blocked, signed in or not", async () => {
  const r1 = await post("/auth/link", { email: "you@example.com" }, { Origin: "https://evil.example" });
  assert.equal(r1.status, 403);
  const before = seen.length;
  const r2 = await fetch(base + "/api/alerts", { method: "POST", headers: { Cookie: cookie, Origin: "https://evil.example", "x-qt": "1" }, body: "{}" });
  assert.equal(r2.status, 403);
  const r3 = await fetch(base + "/api/alerts", { method: "POST", headers: { Cookie: cookie, "x-qt": "1" }, body: "{}" });
  assert.equal(r3.status, 403, "no Origin header at all");
  assert.equal(seen.length, before);
});

test("a signed-in request reaches the terminal with Host and Origin rewritten and no cookie", async () => {
  const r = await fetch(base + "/api/alerts?x=1", { method: "POST", headers: { Cookie: cookie, Origin: origin, "x-qt": "1", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  const last = seen.at(-1);
  assert.equal(last.method, "POST");
  assert.equal(last.url, "/api/alerts?x=1");
  assert.match(last.headers.host, /^127\.0\.0\.1:\d+$/);
  assert.equal(last.headers.origin, `http://${last.headers.host}`);
  assert.equal(last.headers.cookie, undefined);
  assert.equal(last.headers["x-qt"], "1");
});

test("nothing from the terminal is marked cacheable by a shared cache", async () => {
  const v = await fetch(base + "/vendor/lib.js", { headers: { Cookie: cookie } });
  assert.equal(v.headers.get("cache-control"), "private, max-age=86400");
  assert.match(v.headers.get("vary"), /Cookie/);
  const j = await fetch(base + "/api/x", { headers: { Cookie: cookie } });
  assert.match(j.headers.get("cache-control"), /^private\b/);
});

test("the terminal's responses carry the script lockdown and nosniff", async () => {
  for (const p of ["/", "/vendor/lib.js", "/api/x"]) {
    const r = await fetch(base + p, { headers: { Cookie: cookie } });
    assert.equal(r.headers.get("content-security-policy"), APP_CSP, p);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", p);
  }
  assert.match(APP_CSP, /script-src 'self' 'report-sample'(;|$)/);
  assert.doesNotMatch(APP_CSP, /unsafe-eval|script-src[^;]*unsafe-inline/);
});

test("a CSP report is logged without a session and never reaches the terminal", async () => {
  const before = seen.length;
  const logged = [];
  const log = console.log;
  console.log = (...a) => logged.push(a.join(" "));
  try {
    const r = await fetch(base + "/csp-report", {
      method: "POST",
      headers: { "Content-Type": "application/csp-report" },
      body: JSON.stringify({ "csp-report": { "document-uri": "https://charts.example/?secret=1", "violated-directive": "script-src-attr", "blocked-uri": "inline", "line-number": 12 } }),
    });
    assert.equal(r.status, 204);
  } finally {
    console.log = log;
  }
  assert.equal(seen.length, before);
  assert.deepEqual(logged, ["[csp] blocked script-src-attr inline on / line 12"]);
});

test("a CSP report logs a blocked URL without its query or hash", async () => {
  const logged = [];
  const log = console.log;
  console.log = (...a) => logged.push(a.join(" "));
  try {
    for (const blocked of ["https://cdn.example/x.js?token=abc#frag", "data:text/javascript,alert(1)"])
      await fetch(base + "/csp-report", {
        method: "POST",
        headers: { "Content-Type": "application/csp-report" },
        body: JSON.stringify({ "csp-report": { "document-uri": "https://charts.example/", "violated-directive": "script-src-elem", "blocked-uri": blocked } }),
      });
  } finally {
    console.log = log;
  }
  assert.deepEqual(logged, ["[csp] blocked script-src-elem https://cdn.example/x.js on /", "[csp] blocked script-src-elem data: on /"]);
});

test("Cloudflare's beacon and bot check are blocked quietly, other inline scripts are still logged", async () => {
  const logged = [];
  const log = console.log;
  console.log = (...a) => logged.push(a.join(" "));
  const report = (extra) =>
    fetch(base + "/csp-report", {
      method: "POST",
      headers: { "Content-Type": "application/csp-report" },
      body: JSON.stringify({ "csp-report": { "document-uri": "https://charts.example/", "violated-directive": "script-src-elem", ...extra } }),
    });
  try {
    await report({ "blocked-uri": "https://static.cloudflareinsights.com/beacon.min.js/vce7018?x=1" });
    await report({ "blocked-uri": "inline", "script-sample": "(function(){function c(){var b=a.contentD" });
    await report({ "blocked-uri": "inline", "script-sample": "fetch('/api/custom',{method:'POST'" });
  } finally {
    console.log = log;
  }
  assert.deepEqual(logged, ["[csp] blocked script-src-elem inline on /"]);
});

test("a 502 from the terminal reaches the browser as 500 with its message, not Cloudflare's page", async () => {
  const r = await fetch(base + "/fail", { headers: { Cookie: cookie } });
  assert.equal(r.status, 500);
  assert.equal(r.headers.get("x-upstream-status"), "502");
  assert.equal((await r.json()).error, "No source could load this chart.");
});

test("a logout link on another site doesn't sign me out", async () => {
  const r = await fetch(base + "/logout", { headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" }, redirect: "manual" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/");
  assert.equal(r.headers.get("set-cookie"), null);
  assert.equal((await fetch(base + "/api/x", { headers: { Cookie: cookie } })).status, 200);
});

test("event streams pass through without waiting for the end", async () => {
  const ac = new AbortController();
  const r = await fetch(base + "/stream", { headers: { Cookie: cookie }, signal: ac.signal });
  assert.equal(r.headers.get("content-type"), "text/event-stream");
  const reader = r.body.getReader();
  const { value } = await reader.read();
  assert.match(Buffer.from(value).toString(), /data: first/);
  ac.abort();
});

test("asking for a link answers the same for any address and only mails the account", async () => {
  const r1 = await post("/auth/link", { email: "someone@else.com" });
  const r2 = await post("/auth/link", { email: "  YOU@example.com " });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.deepEqual(await r1.json(), await r2.json());
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "you@example.com");
  assert.match(mails[0].url, /^http:\/\/localhost:0\/link\/[A-Za-z0-9_-]{43}$/);
});

test("a link opens the page without being used up, and a bad one is refused", async () => {
  const token = mails[0].url.split("/link/")[1];
  assert.equal((await fetch(base + "/link/" + token)).status, 200);
  const ok = await post("/auth/enrol/options", { token });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.ok(body.challengeId);
  assert.equal(body.options.authenticatorSelection.userVerification, "required");
  assert.equal(body.options.rp.id, "localhost");
  // A junk answer to the challenge doesn't use the link up.
  const junk = await post("/auth/enrol/verify", { challengeId: body.challengeId, response: { id: "x", rawId: "x", type: "public-key", response: {} } });
  assert.equal(junk.status, 400);
  assert.equal((await post("/auth/enrol/options", { token })).status, 200);
  assert.equal((await post("/auth/enrol/options", { token: "x".repeat(43) })).status, 410);
});

test("sign-in options never name a credential", async () => {
  const r = await post("/auth/login/options", { email: "anyone@example.com" });
  const { options } = await r.json();
  assert.deepEqual(options.allowCredentials ?? [], []);
  assert.equal(options.userVerification, "required");
  const bad = await post("/auth/login/verify", { challengeId: "nope", response: {} });
  assert.equal(bad.status, 400);
});

test("logout ends the session", async () => {
  const s = gateway.auth.createSession(gateway.auth.accountId);
  const c = `qt_session=${s.id}`;
  assert.equal((await fetch(base + "/api/x", { headers: { Cookie: c } })).status, 200);
  const r = await fetch(base + "/logout", { headers: { Cookie: c }, redirect: "manual" });
  assert.equal(r.status, 302);
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await fetch(base + "/api/x", { headers: { Cookie: c } })).status, 401);
});

test("/session names the account to a signed-in page only, and never reaches the terminal", async () => {
  const before = seen.length;
  const out = await fetch(base + "/session");
  assert.equal(out.status, 401);
  const r = await fetch(base + "/session", { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { email: "you@example.com" });
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(seen.length, before);
});

test("junk addresses from many places don't use up the account's links", async () => {
  const sent = mails.length;
  for (let i = 0; i < 12; i++) {
    const r = await post("/auth/link", { email: `junk${i}@else.com` }, { "CF-Connecting-IP": `203.0.113.${i}` });
    assert.equal(r.status, 200);
  }
  await post("/auth/link", { email: "you@example.com" }, { "CF-Connecting-IP": "198.51.100.7" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(mails.length, sent + 1);
});

test("asking for too many links from one place is limited", async () => {
  let last;
  for (let i = 0; i < 8; i++) last = await post("/auth/link", { email: "someone@else.com" });
  assert.equal(last.status, 429);
});

// ---------- fresh passkey check before code-running writes ----------
let ipN = 0;
const stepUpPost = (p, body, c = cookie, gw = base) =>
  fetch(gw + p, { method: "POST", headers: { Cookie: c, Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": `192.0.2.${++ipN}` }, body: JSON.stringify(body) });
async function grantFor(c = cookie, gw = base) {
  verifyAs = gateway.auth.accountId;
  const { challengeId } = await (await stepUpPost("/step-up/options", {}, c, gw)).json();
  const r = await stepUpPost("/step-up/verify", { challengeId, response: {} }, c, gw);
  assert.equal(r.status, 200);
  return (await r.json()).grant;
}
const write = (method, p, grant, c = cookie, gw = base) =>
  fetch(gw + p, { method, headers: { Cookie: c, Origin: origin, "x-qt": "1", "Content-Type": "application/json", ...(grant ? { "x-step-up": grant } : {}) }, body: "{}" });

test("writes that run code on the box need a fresh passkey check and never reach the terminal without one", async () => {
  const before = seen.length;
  for (const [method, p] of [
    ["POST", "/api/custom"], ["DELETE", "/api/custom/x.js"], ["POST", "/api/import/signal?name=x.csv"],
    ["PUT", "/api/custom"], ["PATCH", "/api/custom"], ["POST", "/api/custom/"],
    ["POST", "/api/%63ustom"], ["POST", "/api/import/%73ignal"], ["DELETE", "/api/custom%2Fx.js"],
  ]) {
    const r = await write(method, p);
    assert.equal(r.status, 428, `${method} ${p}`);
    assert.equal((await r.json()).stepUp, true);
  }
  const bad = await write("POST", "/api/%E0%A4%A");
  assert.equal(bad.status, 400, "malformed percent-encoding");
  assert.equal(seen.length, before);
});

test("reading custom indicators and importing bars don't need it", async () => {
  assert.equal((await fetch(base + "/api/custom", { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await write("POST", "/api/import/bars?name=b.csv")).status, 200);
  assert.equal(seen.at(-1).url, "/api/import/bars?name=b.csv");
});

test("a grant lets one write through, is used up, and never reaches the terminal itself", async () => {
  const grant = await grantFor();
  const r = await write("POST", "/api/custom", grant);
  assert.equal(r.status, 200);
  const last = seen.at(-1);
  assert.equal(last.url, "/api/custom");
  assert.equal(last.headers["x-step-up"], undefined);
  assert.equal((await write("POST", "/api/custom", grant)).status, 428, "used up");
});

test("a grant is used up even when the terminal refuses the write", async () => {
  const grant = await grantFor();
  const r = await write("DELETE", "/api/custom/refused.js", grant);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "The file must export default.");
  assert.equal((await write("POST", "/api/custom", grant)).status, 428);
});

test("a grant works only for the session that earned it", async () => {
  const other = `qt_session=${gateway.auth.createSession(gateway.auth.accountId).id}`;
  const grant = await grantFor(other);
  assert.equal((await write("POST", "/api/custom", grant)).status, 428);
});

test("the passkey has to be the account's, and a failed check gives no grant", async () => {
  const { challengeId } = await (await stepUpPost("/step-up/options", {})).json();
  verifyAs = "someone-else";
  const r1 = await stepUpPost("/step-up/verify", { challengeId, response: {} });
  assert.equal(r1.status, 401);
  verifyAs = null;
  const r2 = await stepUpPost("/step-up/verify", { challengeId, response: {} });
  assert.equal(r2.status, 401);
});

test("the passkey check needs a session, only takes POST, and is never sent to the terminal", async () => {
  const before = seen.length;
  assert.equal((await stepUpPost("/step-up/options", {}, "")).status, 401);
  assert.equal((await fetch(base + "/step-up/options", { headers: { Cookie: cookie } })).status, 405);
  assert.equal((await stepUpPost("/step-up/other", {})).status, 404);
  assert.equal(seen.length, before);
});

test("a grant runs out after its time", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-test-"));
  const quick = createGateway(
    { host: "127.0.0.1", port: 0, upstream: `127.0.0.1:${upPort}`, origin, rpID: "localhost", email: "You@Example.com", sessionDays: 7, linkMinutes: 15, dataDir, mailMode: "log", stepUpMs: 50 },
    { sendLink: async () => {}, verifyPasskey: async () => ({ userId: quick.auth.accountId }) },
  );
  const qbase = `http://127.0.0.1:${await listen(quick)}`;
  const qcookie = `qt_session=${quick.auth.createSession(quick.auth.accountId).id}`;
  try {
    const { challengeId } = await (await stepUpPost("/step-up/options", {}, qcookie, qbase)).json();
    const { grant } = await (await stepUpPost("/step-up/verify", { challengeId, response: {} }, qcookie, qbase)).json();
    await new Promise((r) => setTimeout(r, 80));
    assert.equal((await write("POST", "/api/custom", grant, qcookie, qbase)).status, 428);
  } finally {
    quick.closeAllConnections(); quick.close();
  }
});
