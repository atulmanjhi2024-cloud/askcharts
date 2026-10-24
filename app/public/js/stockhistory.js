// Settings, Stock data: the stock history (history/alpaca.mjs at the repo root), years of the whole market's
// 1-minute bars for US stocks and ETFs, from the same free Alpaca key as live prices. Like Crypto data, the
// page shows what the importer did and asks it for more (history/data/jobs, source "alpaca"); the importer
// runs outside the app, so a download carries on through a restart. Off until it's started here.
import { api, esc } from "./api.js";
import { when } from "./marketdata.js";

const SYMBOL = /^[A-Z][A-Z0-9.]{0,9}$/;

export function stockHistory(app) {
  const st = { s: null, key: false, err: "", json: "", flash: "", tone: "", flashAt: 0, add: "" };
  // the US stocks and ETFs on my watchlists, for the first download
  const watched = () => [
    ...new Set(
      Object.values(app.state.watchlists || {})
        .flat()
        .map((x) => String(x?.symbol ?? x))
        .filter((x) => x.startsWith("US:"))
        .map((x) => x.slice(3).toUpperCase())
        .filter((x) => SYMBOL.test(x)),
    ),
  ];
  const ask = async (job, done) => {
    try {
      await api.post("/api/history/jobs", { source: "alpaca", ...job });
      st.flash = done;
      st.tone = "ok";
    } catch (e) {
      st.flash = e.message;
      st.tone = "err";
    }
    st.flashAt = Date.now();
    st.json = "";
  };
  return {
    // true when something on the page changed
    async load() {
      try {
        const [s, k] = await Promise.all([api.get("/api/history/status"), api.get("/api/feeds/keys")]);
        const json = JSON.stringify([s.alpaca, (s.queued || []).filter((x) => x.source === "alpaca"), s.jobs, k?.alpaca?.set]);
        st.err = "";
        if (json === st.json) return false;
        st.json = json;
        st.s = s;
        st.key = !!k?.alpaca?.set;
      } catch (e) {
        st.err = e.message;
      }
      return true;
    },
    html() {
      let h = '<div class="cs-sec">STOCK HISTORY (ALPACA)</div><div class="md-wrap md-stocks">';
      const s = st.s;
      if (!s) return `${h}<p class="ai-lead">${st.err ? `The stock history isn't available: ${esc(st.err)}` : "Loading…"}</p></div>`;
      const a = s.alpaca || {},
        list = a.list || [],
        q = (s.queued || []).filter((x) => x.source === "alpaca"),
        ro = s.jobs === false;
      const stored = list.filter((x) => a.symbols?.[x]?.first);
      const flash = st.flash && Date.now() - st.flashAt < 30000 ? `<div class="ai-status ${st.tone}">${esc(st.flash)}</div>` : "";
      h += "<p class=\"ai-lead\">Years of 1-minute bars for US stocks and ETFs, from 2016, stored on this computer: the whole market's trades (every exchange), not only the free live feed's. Stock charts and the strategy report's backtests use them; the newest bars still come live.</p>";
      if (ro) h += '<div class="ai-note">This copy reads the store read only, so Download, Update now, Add and Remove are off here. They run on the copy that keeps the store.</div>';
      if (!st.key && !stored.length && !ro) return `${h}<p class="ai-note">It comes from your Alpaca account, with the same free key as live prices: save an Alpaca key above first.</p></div>`;
      const adding = q.filter((x) => x.cmd === "add").map((x) => x.symbol);
      const addRow = ro
        ? ""
        : `<div class="md-add"><input class="cs-num ai-in" data-sh="symbol" placeholder="Add a stock or ETF by its ticker, like AAPL or SPY" autocomplete="off" spellcheck="false" value="${esc(st.add)}"><button class="btn" data-sh="add">Add stock</button></div>`;
      // nothing downloaded yet: offer it, for the US stocks on my watchlists (never started by itself)
      if (!stored.length && !a.job && !q.length && !list.length) {
        if (ro) return `${h}<p class="ai-note">Nothing is stored yet.</p></div>`;
        const w = watched();
        h += "<p class=\"ai-note\">About 80 MB and under a minute a stock, from Alpaca's free plan (bars older than 15 minutes). Nothing downloads until you start it; after that it updates every hour.</p>";
        h += w.length
          ? `<div class="md-acts"><button class="btn primary" data-sh="start">Download stock history</button></div><div class="ai-sub md-tight">For the US stocks and ETFs on your watchlists: ${esc(w.join(", "))}. You can add more after.</div>`
          : `<div class="ai-sub">Add a stock by its ticker to start, or put US stocks on a watchlist first.</div>${addRow}`;
        return `${h}${flash}</div>`;
      }
      const state = a.job
        ? ["busy", `Downloading ${a.job.symbol || ""}${a.job.note ? `: ${a.job.note.replace(/^\S+ /, "")}` : ""}…`]
        : q.length
          ? ["busy", "Starting…"]
          : a.failures
            ? ["err", `The last update failed: ${a.lastError?.message || "no reason given"}.${a.lastOk ? ` Last good update ${when(a.lastOk)}.` : ""}`]
            : !a.automatic
              ? ["warn", "Automatic updates are off. Update now still works."]
              : a.lastOk
                ? ["ok", `Up to date to about an hour ago. Last update ${when(a.lastOk)}.`]
                : ["busy", "Waiting for the first update."];
      h += `<div class="md-state ${state[0]}"><i></i><span>${esc(state[1])}</span></div>`;
      if (!ro) {
        h += `<label class="cs-chk"><input type="checkbox" data-sh="auto" ${a.automatic ? "checked" : ""}><span class="cs-box"></span><span>Update automatically, every hour</span></label>`;
        h += '<div class="md-acts"><button class="btn" data-sh="update">Update now</button></div>';
      }
      h += flash;
      if (a.lastJob && !a.lastJob.ok && Date.now() - Date.parse(a.lastJob.at) < 600e3) h += `<div class="ai-status err">${esc(a.lastJob.message)}</div>`;
      h += '<div class="md-sub">Stocks</div><table class="md-coins"><thead><tr><th>Stock</th><th>From</th><th>Through</th><th></th><th></th></tr></thead><tbody>';
      for (const sym of list) {
        const p = a.symbols?.[sym] || {};
        const dl = p.first ? `<a class="md-dl" href="/api/history/export?exchange=US&pair=${encodeURIComponent(sym)}" download title="Download ${esc(sym)}'s stored bars as CSV">⬇</a>` : "";
        const rm = ro ? "" : `<button class="md-rm" data-sh="remove" data-symbol="${esc(sym)}" title="Remove ${esc(sym)} and its stored bars">×</button>`;
        h += `<tr><td><b>${esc(sym)}</b></td><td>${p.first ? esc(when(p.first, { time: false })) : "…"}</td><td>${p.last ? esc(when(p.last)) : "…"}</td><td>${dl}</td><td>${rm}</td></tr>`;
        if (p.error) h += `<tr class="md-err"><td colspan="5">${esc(when(p.error.at))}: ${esc(p.error.message)}</td></tr>`;
      }
      for (const sym of adding.filter((x) => !list.includes(x))) h += `<tr><td><b>${esc(sym)}</b></td><td>…</td><td>…</td><td><span class="muted">Adding</span></td><td></td></tr>`;
      h += "</tbody></table>";
      h += addRow;
      if (!ro) h += '<div class="ai-sub md-tight">Regular hours (09:30 to 16:00 New York), split adjusted, as stock charts show. Removing a stock deletes its stored bars.</div>';
      return `${h}</div>`;
    },
    // keep the page still while a ticker is being typed
    typing: (page) => page.contains(document.activeElement) && document.activeElement.matches('[data-sh="symbol"]'),
    bind(page, redraw) {
      const go = async (job, done) => {
        await ask(job, done);
        await this.load();
        redraw();
      };
      const start = page.querySelector('[data-sh="start"]');
      if (start) start.onclick = () => go({ cmd: "start", symbols: watched() }, "Downloading the stock history. It shows here as it goes.");
      const auto = page.querySelector('[data-sh="auto"]');
      if (auto) auto.onchange = (e) => go({ cmd: "automatic", on: e.target.checked }, e.target.checked ? "Updates every hour." : "Automatic updates off. Update now still works.");
      const upd = page.querySelector('[data-sh="update"]');
      if (upd) upd.onclick = () => go({ cmd: "update" }, "Updating the stock history.");
      const box = page.querySelector('[data-sh="symbol"]');
      const add = page.querySelector('[data-sh="add"]');
      if (box) {
        box.oninput = () => (st.add = box.value);
        box.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === "Enter") add?.click();
        };
      }
      if (add)
        add.onclick = () => {
          const sym = String(st.add || "").trim().toUpperCase().replace(/^US:/, "");
          if (!SYMBOL.test(sym)) {
            st.flash = "Type the stock's ticker, like AAPL, F or BRK.B.";
            st.tone = "err";
            st.flashAt = Date.now();
            return redraw();
          }
          st.add = "";
          // the first stock, with nothing else yet: a start with that one
          const first = !(st.s?.alpaca?.list || []).length;
          go(first ? { cmd: "start", symbols: [sym] } : { cmd: "add", symbol: sym }, `Adding ${sym}. It shows here when it's in.`);
        };
      for (const b of page.querySelectorAll('[data-sh="remove"]'))
        b.onclick = () => {
          const sym = b.dataset.symbol;
          if (!confirm(`Remove ${sym} and its stored bars? Its charts go back to the live sources' bars.`)) return;
          go({ cmd: "remove", symbol: sym }, `Removing ${sym}.`);
        };
    },
  };
}
