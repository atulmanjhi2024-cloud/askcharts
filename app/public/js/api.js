// The sign-in gateway asks for a fresh passkey before a write that runs code on the server (saving
// or deleting a JavaScript indicator, importing a signal). It answers 428 with { stepUp: true }; the
// passkey check earns a one-time grant, and the same request goes once more carrying it.
export async function fetchStepUp(url, init = {}) {
  const res = await fetch(url, init);
  if (res.status !== 428) return res;
  const data = await res.clone().json().catch(() => null);
  if (!data?.stepUp) return res;
  const grant = await passkeyGrant();
  return fetch(url, { ...init, headers: { ...init.headers, "x-step-up": grant } });
}

let webAuthn = null;
function loadWebAuthn() {
  webAuthn ||= new Promise((resolve, reject) => {
    if (window.SimpleWebAuthnBrowser) return resolve(window.SimpleWebAuthnBrowser);
    const s = document.createElement("script");
    s.src = "/auth/static/simplewebauthn.js"; // the gateway's own copy, as on the sign-in page
    s.onload = () => resolve(window.SimpleWebAuthnBrowser);
    s.onerror = () => {
      webAuthn = null;
      reject(new Error("Couldn't load the passkey check. Nothing was saved."));
    };
    document.head.appendChild(s);
  });
  return webAuthn;
}

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function passkeyGrant() {
  const W = await loadWebAuthn();
  const { options, challengeId } = await postJson("/step-up/options", {});
  const ask = () => W.startAuthentication({ optionsJSON: options });
  let response;
  try {
    response = await ask();
  } catch (e) {
    if (e?.name !== "NotAllowedError" && e?.cause?.name !== "NotAllowedError") throw e;
    // Cancelled, or the browser wants a fresh tap before it shows the passkey (Safari): offer it
    // from a button, which starts the check inside the tap itself.
    response = await askFromButton(ask);
  }
  return (await postJson("/step-up/verify", { challengeId, response })).grant;
}

function askFromButton(ask) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("div");
    el.className = "toast";
    const yes = document.createElement("button");
    const no = document.createElement("button");
    yes.className = no.className = "btn small";
    yes.textContent = "Use passkey";
    no.textContent = "Cancel";
    el.append("Saving code that runs on the server needs your passkey. ", yes, " ", no);
    const cancel = () => {
      el.remove();
      reject(new Error("The passkey check was cancelled, so nothing was saved."));
    };
    const timer = setTimeout(cancel, 60000);
    yes.onclick = () => {
      clearTimeout(timer);
      el.remove();
      ask().then(resolve, () => reject(new Error("The passkey check didn't go through, so nothing was saved.")));
    };
    no.onclick = () => {
      clearTimeout(timer);
      cancel();
    };
    (document.getElementById("toasts") || document.body).appendChild(el);
  });
}

// Thin wrapper over the local server. Writes carry the x-qt header the server requires.
async function req(method, url, body) {
  const res = await fetchStepUp(url, {
    method,
    headers:
      body !== undefined
        ? { "Content-Type": "application/json", "x-qt": "1" }
        : { "x-qt": "1" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw Object.assign(new Error(data?.error || data || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

export const api = {
  get: (u) => req("GET", u),
  post: (u, b) => req("POST", u, b ?? {}),
  put: (u, b) => req("PUT", u, b ?? {}),
  patch: (u, b) => req("PATCH", u, b ?? {}),
  del: (u) => req("DELETE", u),
  candles: (symbol, tf, limit = 3000) =>
    req(
      "GET",
      `/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&limit=${limit}`,
    ),
  quotes: (symbols) =>
    req("GET", `/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`),
  search: (q) => req("GET", `/api/search?q=${encodeURIComponent(q)}`),
};

export function download(name, content, type = "text/csv") {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export function fmtPrice(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return fmtNum(v);
  const d = a >= 1000 ? 2 : a >= 1 ? (a >= 100 ? 2 : 4) : a >= 0.01 ? 6 : 8;
  return v.toLocaleString(undefined, {
    minimumFractionDigits: Math.min(d, 2),
    maximumFractionDigits: d,
  });
}

export function fmtNum(v, d = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(d);
}

export const fmtPct = (v) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
// "BINANCE:BTCUSDT" -> "BTCUSDT"; a spread "SPREAD:BINANCE:BTCUSDT / BINANCE:ETHUSDT" -> "BTCUSDT/ETHUSDT".
export const ticker = (id) => {
  const s = String(id || "");
  if (s.startsWith("SPREAD:")) return s.slice(7).split(" ").map((x) => (x.includes(":") ? x.split(":").pop() : x)).join("");
  return s.split(":").pop();
};
export const exchange = (id) => String(id || "").split(":")[0];
