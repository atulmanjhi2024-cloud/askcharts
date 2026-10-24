// Settings, On chain data: XRPL On chain on or off, the server its collector follows, the shared history,
// and what the collector has stored. The collector runs outside the app (AskCharts' runner starts it, and
// restarts it within a few seconds of a change here), so this page only reads its status and saves settings.
import { api, esc } from "./api.js";
import { when } from "./marketdata.js";

export function onchainData() {
  const st = { oc: null, err: "", json: "", server: null, flash: "", flashAt: 0, tone: "" };
  // the server's host (the collector reports only that)
  const hostOf = (u) => {
    try {
      return new URL(u).host;
    } catch {
      return u;
    }
  };
  // the collector's own last failure, in plain words
  const why = (m) => (!m ? "" : /rate.?limit|slow.?down|too.?busy/i.test(m) ? "it's rate limiting this network" : /closed the connection/i.test(m) ? "it closed the connection" : m.replace(/\.$/, ""));
  return {
    // true when something on the page changed
    async load() {
      let oc = null;
      try {
        oc = await api.get("/api/onchain/settings");
        st.err = "";
      } catch (e) {
        st.err = e.message;
      }
      const json = JSON.stringify(oc);
      if (json === st.json) return false;
      st.json = json;
      st.oc = oc;
      return true;
    },
    html() {
      const o = st.oc;
      let h = '<div class="cs-sec">XRP LEDGER (XRPL ON CHAIN)</div><div class="md-wrap md-xrpl">';
      if (!o) return `${h}<p class="ai-lead">XRPL On chain isn't available here${st.err ? `: ${esc(st.err)}` : ""}.</p></div>`;
      const c = o.collector;
      const waitS = c?.limited && Math.max(1, Math.round((Date.parse(c.limited.until) - Date.now()) / 1000));
      const failed = c?.lastError && (!c.connected || !c.connectedAt || Date.parse(c.lastErrorAt) >= Date.parse(c.connectedAt));
      const state = !o.enabled
        ? ["warn", "Off. The XRPL indicators under Indicators, On chain show nothing new."]
        : !c || !c.updated || Date.now() - Date.parse(c.updated) > 120e3
          ? ["busy", "Starting…"]
          : c.server && c.server !== hostOf(o.server)
            ? ["busy", `Switching to ${o.server}…`]
            : !c.connected
              ? ["err", `Can't reach ${o.server}${failed ? `: ${why(c.lastError)}` : ""}. Trying again.`]
              : c.limited && Date.parse(c.limited.until) > Date.now()
                ? ["warn", `Following the ledger. ${hostOf(o.server)} asked to slow down, so it's filling in more slowly (next in ${waitS} s).${(c.behind ?? 0) > 10 ? ` It's falling behind the ledger: this server can't keep up with every ledger. Try ${hostOf(o.server) === "s1.ripple.com" ? "your own node" : "wss://s1.ripple.com or your own node"}.` : ""}`]
                : ["ok", `Following the ledger${c.toFill ? `, ${c.toFill.toLocaleString("en-US")} older ledger${c.toFill === 1 ? "" : "s"} still to fill in` : ""}.`];
      h += `<p class="ai-lead">The XRP Ledger's activity and payments, ledger by ledger, for the XRPL indicators under Indicators, On chain. Kept for 90 days on this computer.</p>`;
      h += `<div class="md-state ${state[0]}"><i></i><span>${esc(state[1])}</span></div>`;
      h += `<label class="cs-chk"><input type="checkbox" data-oc="xrpl" ${o.enabled ? "checked" : ""}><span class="cs-box"></span><span>Follow the XRP Ledger</span></label>`;
      h += `<div class="md-add"><input class="cs-num ai-in" data-oc="server" placeholder="wss://s1.ripple.com" autocomplete="off" spellcheck="false" value="${esc(st.server ?? o.server)}"><button class="btn" data-oc="save">Save server</button></div>`;
      h += `<div class="ai-sub md-tight">A public server sends about 15 GB a day to follow every ledger. If you run your own XRP Ledger node, put its WebSocket address here instead.</div>`;
      h += `<label class="cs-chk"><input type="checkbox" data-oc="history" ${o.history ? "checked" : ""}><span class="cs-box"></span><span>Fill in history from askcharts.pro</span></label>`;
      h += `<div class="ai-sub md-tight">Up to 90 days of ledgers from data.askcharts.pro when the collector starts, about 0.5 MB a day, every file signed and checked. Without it, the collector fills in one day back, ledger by ledger, from the server above. It only downloads; nothing is sent.</div>`;
      if (st.flash && Date.now() - st.flashAt < 30000) h += `<div class="ai-status ${st.tone}">${esc(st.flash)}</div>`;
      const sh = c?.history;
      const shared = !o.history ? "" : sh?.error ? `Couldn't read it last time (${sh.error})` : sh?.newest ? `Filled in up to ${when(new Date(sh.newest * 1000).toISOString())}` : "";
      if (o.stored || shared) {
        h += '<div class="md-facts">';
        if (o.stored) h += `<div class="md-k">Stored</div><div class="md-v">${o.stored.ledgers.toLocaleString("en-US")} ledgers, ${esc(when(new Date(o.stored.from * 1000).toISOString()))} to ${esc(when(new Date(o.stored.to * 1000).toISOString()))}</div>`;
        if (shared) h += `<div class="md-k">Shared history</div><div class="md-v">${esc(shared)}</div>`;
        h += "</div>";
      }
      return `${h}</div>`;
    },
    // keep the page still while a server is being typed, and while a typed server isn't saved yet (a
    // redraw between pressing Save and letting go would lose the click)
    typing: (page) => (page.contains(document.activeElement) && document.activeElement.matches("input[type=text], input:not([type])")) || (st.server != null && st.server !== st.oc?.server),
    bind(page, redraw) {
      const save = async (body, words) => {
        try {
          st.oc = await api.post("/api/onchain/settings", body);
          st.server = null;
          st.flash = words;
          st.tone = "ok";
        } catch (e) {
          st.flash = e.message;
          st.tone = "err";
        }
        st.flashAt = Date.now();
        st.json = "";
        redraw();
      };
      const server = page.querySelector('[data-oc="server"]');
      if (server) {
        server.oninput = () => (st.server = server.value);
        server.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === "Enter") page.querySelector('[data-oc="save"]')?.click();
        };
      }
      const on = page.querySelector('[data-oc="xrpl"]');
      if (on) on.onchange = (e) => save({ enabled: e.target.checked }, e.target.checked ? "Following the XRP Ledger. The collector starts within a few seconds." : "Stopped following the XRP Ledger. What's stored stays.");
      const hist = page.querySelector('[data-oc="history"]');
      if (hist) hist.onchange = (e) => save({ enabled: !!st.oc?.enabled, history: e.target.checked }, e.target.checked ? "The collector fills in from askcharts.pro each time it starts." : "Shared history off. The collector fills in one day back, ledger by ledger.");
      const btn = page.querySelector('[data-oc="save"]');
      if (btn) btn.onclick = () => save({ enabled: !!st.oc?.enabled, server: st.server ?? st.oc?.server }, "Server saved.");
    },
  };
}
