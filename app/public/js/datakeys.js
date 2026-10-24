// Settings, Stock data: your own data keys, optional. The free sources need none; an Alpaca or Polygon
// (now Massive) key gives live prices for US stocks and ETFs (and CME futures, with Polygon) instead of
// delayed ones, with the free sources behind it. Each key is checked with its provider before it's
// saved, and the page only ever learns whether one is saved and its last 4 characters (lib/feeds.js).
import { api, esc } from "./api.js";

const BLANK = { alpaca: { keyId: "", secretKey: "", feed: null }, polygon: { apiKey: "" } };
const NAMES = { alpaca: "Alpaca", polygon: "Polygon (Massive)" };
const EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
// A secret's box with the eye, as for the AskCharts AI key: it shows what was typed or pasted, to check it
// before saving. A saved key never comes back, so there's nothing to show once it's saved.
const secret = (dk, label, placeholder, value) =>
  `<div class="ai-f"><span>${label}</span><div class="ai-key"><input class="cs-num ai-in" type="password" data-dk="${dk}" autocomplete="off" spellcheck="false" placeholder="${placeholder}" value="${esc(value)}"><button type="button" class="ai-eye" data-dk-eye title="Show what you typed">${EYE}</button></div></div>`;

export function dataKeys() {
  const st = { s: null, err: "", busy: "", flash: {}, form: structuredClone(BLANK) };
  const say = (prov, tone, text) => (st.flash[prov] = { tone, text });
  return {
    async load() {
      try {
        st.s = await api.get("/api/feeds/keys");
        st.err = "";
      } catch (e) {
        st.err = e.message;
      }
    },
    html() {
      let h = '<div class="cs-sec">LIVE US STOCK PRICES (OPTIONAL)</div><div class="md-keys">';
      h += '<p class="ai-lead">AskCharts works with no key: its market data is free. If you have an account with one of these, its key gives you live prices for US stocks and ETFs (and CME futures, with Polygon) instead of delayed ones. The free sources stay behind it.</p>';
      if (!st.s) return `${h}<div class="cs-l span">${st.err ? `Couldn't read the keys: ${esc(st.err)}` : "Loading…"}</div></div>`;
      const a = st.s.alpaca,
        p = st.s.polygon,
        f = st.form;
      const state = (x, saved) => `<div class="md-state ${x.set ? "ok" : "warn"}"><i></i><span>${x.set ? `Saved: ${saved}` : "No key saved."}</span></div>`;
      const flash = (prov) => (st.flash[prov] ? `<div class="ai-status ${st.flash[prov].tone}">${esc(st.flash[prov].text)}</div>` : "");
      const acts = (prov, x) =>
        `<div class="md-acts"><button class="btn" data-dk-save="${prov}" ${st.busy ? "disabled" : ""}>${st.busy === prov ? "Checking…" : "Save and check"}</button>${
          x.set ? `<button class="btn" data-dk-test="${prov}" ${st.busy ? "disabled" : ""}>Check the saved key</button><button class="btn" data-dk-rm="${prov}" ${st.busy ? "disabled" : ""}>Remove</button>` : ""
        }</div>`;

      h += '<div class="md-sub">Alpaca</div>';
      h += state(a, `key ID ending in ${esc(a.hint || "")}, ${a.feed === "sip" ? "SIP feed (paid)" : "IEX feed (free)"}.`);
      h += `<label class="ai-f"><span>Key ID</span><input class="cs-num ai-in" data-dk="alpaca.keyId" autocomplete="off" spellcheck="false" placeholder="${a.set ? "Paste a new one to replace it" : "Paste the key ID"}" value="${esc(f.alpaca.keyId)}"></label>`;
      h += secret("alpaca.secretKey", "Secret key", a.set ? "Saved, and never shown. Paste a new one to replace it" : "Paste the secret key", f.alpaca.secretKey);
      const feed = f.alpaca.feed ?? (a.feed || "iex");
      h += `<label class="ai-f"><span>Feed</span><select class="cs-num ai-in" data-dk="alpaca.feed"><option value="iex" ${feed === "iex" ? "selected" : ""}>IEX (free accounts)</option><option value="sip" ${feed === "sip" ? "selected" : ""}>SIP (Alpaca's paid plan)</option></select></label>`;
      h += acts("alpaca", a) + flash("alpaca");
      h += `<div class="ai-sub md-tight">A free account at alpaca.markets gives live US stock prices on the IEX feed. The keys are under API Keys in Alpaca's dashboard.${a.set ? " To change only the feed, pick it and press Save and check." : ""}</div>`;

      h += '<div class="md-sub">Polygon (now Massive)</div>';
      h += state(p, `key ending in ${esc(p.hint || "")}.`);
      h += secret("polygon.apiKey", "API key", p.set ? "Saved, and never shown. Paste a new one to replace it" : "Paste the API key", f.polygon.apiKey);
      h += acts("polygon", p) + flash("polygon");
      h += '<div class="ai-sub md-tight">US stocks, and CME futures (NQ, MNQ, ES, MES) on a futures plan. Live or delayed depends on your plan; the free plan is end of day only.</div>';

      h += '<p class="ai-note">Keys stay on this computer, in a file only this account can read, and each is only ever sent to its own provider. A saved key is never shown again. These actions take effect right away.</p>';
      h += '<p class="ai-note">Stock and ETF history isn\'t stored on this computer yet: their charts use each source\'s own feed.</p></div>';
      return h;
    },
    bind(page, redraw) {
      for (const el of page.querySelectorAll("[data-dk]")) {
        const [prov, field] = el.dataset.dk.split(".");
        const set = () => (st.form[prov][field] = el.value);
        el.oninput = set;
        el.onchange = set;
        el.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === "Enter") page.querySelector(`[data-dk-save="${prov}"]`)?.click();
        };
      }
      // the eye: show or hide what's in the box, without redrawing (the cursor stays where it was)
      for (const b of page.querySelectorAll("[data-dk-eye]"))
        b.onclick = (e) => {
          e.preventDefault();
          const input = b.parentElement.querySelector("input");
          input.type = input.type === "password" ? "text" : "password";
          b.title = input.type === "text" ? "Hide what you typed" : "Show what you typed";
          b.classList.toggle("on", input.type === "text");
        };
      const run = async (prov, work) => {
        st.busy = prov;
        redraw();
        try {
          await work();
        } catch (e) {
          say(prov, "err", e.message);
        }
        st.busy = "";
        redraw();
      };
      for (const b of page.querySelectorAll("[data-dk-save]"))
        b.onclick = () => {
          const prov = b.dataset.dkSave,
            f = st.form[prov];
          const body = prov === "alpaca" ? { provider: prov, keyId: f.keyId, secretKey: f.secretKey, feed: f.feed ?? st.s.alpaca.feed ?? "iex" } : { provider: prov, apiKey: f.apiKey };
          run(prov, async () => {
            const r = await api.post("/api/feeds/keys", body);
            st.s = r;
            st.form[prov] = structuredClone(BLANK[prov]);
            say(prov, r.note ? "warn" : "ok", r.note ? `Saved. ${r.note}` : `Saved, and ${NAMES[prov]} accepted it.`);
          });
        };
      for (const b of page.querySelectorAll("[data-dk-test]"))
        b.onclick = () => {
          const prov = b.dataset.dkTest;
          run(prov, async () => {
            const r = await api.post("/api/feeds/keys/test", { provider: prov });
            say(prov, r.ok ? "ok" : "err", r.ok ? `${NAMES[prov]} accepts the saved key.` : r.message);
          });
        };
      for (const b of page.querySelectorAll("[data-dk-rm]"))
        b.onclick = () => {
          const prov = b.dataset.dkRm;
          if (!confirm(`Remove the saved ${NAMES[prov]} key? Charts go back to the free sources.`)) return;
          run(prov, async () => {
            st.s = await api.del(`/api/feeds/keys/${prov}`);
            say(prov, "ok", "Removed. Charts use the free sources again.");
          });
        };
    },
  };
}
