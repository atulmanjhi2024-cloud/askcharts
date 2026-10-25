// Settings, Crypto data: Binance's history (history/binance.mjs at the repo root), each coin's own Binance bars from
// its first month there, for BINANCE charts. Like Kraken's, the page shows what the importer did and asks it for
// more (history/data/jobs, source "binance"); the importer runs outside the app. Off until it's started here.
import { api, esc } from "./api.js";
import { when, waitingFor } from "./marketdata.js";

const PAIR = /^[A-Z0-9]{2,20}$/;
// Kraken's names for the coins it lists in dollars, as Binance's USDT pairs (XBTUSD is BTCUSDT)
const usdt = (kraken) => {
  const m = /^(.+?)(USD|ZUSD)$/.exec(kraken);
  return m ? `${{ XBT: "BTC", XDG: "DOGE" }[m[1]] || m[1]}USDT` : null;
};

export function binanceHistory(app) {
  const st = { s: null, err: "", json: "", flash: "", tone: "", flashAt: 0, add: "" };
  // the Binance coins on my watchlists, and my Kraken coins in USDT, for the first download
  const offered = () => {
    const watched = Object.values(app.state.watchlists || {})
      .flat()
      .map((x) => String(x?.symbol ?? x))
      .filter((x) => x.startsWith("BINANCE:"))
      .map((x) => x.slice(8).toUpperCase());
    const kraken = (st.s?.kraken?.coins || []).map(usdt).filter(Boolean);
    return [...new Set([...watched, ...kraken])].filter((p) => PAIR.test(p));
  };
  const ask = async (job, done) => {
    try {
      await api.post("/api/history/jobs", { source: "binance", ...job });
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
        const s = await api.get("/api/history/status");
        const json = JSON.stringify([s.binance, (s.queued || []).filter((x) => x.source === "binance"), s.running, s.jobs, s.kraken?.coins]);
        st.err = "";
        if (json === st.json) return false;
        st.json = json;
        st.s = s;
      } catch (e) {
        st.err = e.message;
      }
      return true;
    },
    html() {
      let h = '<div class="cs-sec">BINANCE (CRYPTO)</div><div class="md-wrap md-binance">';
      const s = st.s;
      if (!s) return `${h}<p class="ai-lead">${st.err ? `Binance's history isn't available: ${esc(st.err)}` : "Loading…"}</p></div>`;
      const b = s.binance || {},
        list = b.list || [],
        q = (s.queued || []).filter((x) => x.source === "binance"),
        ro = s.jobs === false;
      const stored = list.filter((x) => b.pairs?.[x]?.first);
      const flash = st.flash && Date.now() - st.flashAt < 30000 ? `<div class="ai-status ${st.tone}">${esc(st.flash)}</div>` : "";
      h += "<p class=\"ai-lead\">Binance's own bars, from each coin's first month on Binance, stored on this computer. BINANCE charts and the strategy report's backtests use them; the newest bars still come live from Binance.</p>";
      if (ro) h += '<div class="ai-note">This copy reads the store read only, so Download, Update now, Add and Remove are off here. They run on the copy that keeps the store.</div>';
      const addRow = ro
        ? ""
        : `<div class="md-add"><input class="cs-num ai-in" data-bh="pair" placeholder="Add a coin: Binance's name, like BTCUSDT or ETHBTC" autocomplete="off" spellcheck="false" value="${esc(st.add)}"><button class="btn" data-bh="add">Add coin</button></div>`;
      // nothing downloaded yet: offer it (never started by itself)
      if (!stored.length && !b.job && !q.length && !list.length) {
        if (ro) return `${h}<p class="ai-note">Nothing is stored yet.</p></div>`;
        const o = offered();
        h += "<p class=\"ai-note\">From Binance's monthly files, each checked against Binance's own checksum: about 400 MB and two minutes for a coin traded since 2017 (Bitcoin), less for newer ones. Nothing downloads until you start it; after that it updates every hour.</p>";
        h += o.length
          ? `<div class="md-acts"><button class="btn primary" data-bh="start">Download Binance history</button></div><div class="ai-sub md-tight">For ${esc(o.join(", "))}: the Binance coins on your watchlists and your Kraken coins, in USDT. You can add or remove coins after.</div>`
          : `<div class="ai-sub">Add a coin by Binance's name to start.</div>${addRow}`;
        return `${h}${flash}</div>`;
      }
      const state = b.job
        ? ["busy", `Downloading ${b.job.note || b.job.pair || ""}…`]
        : q.length
          ? ["busy", `${waitingFor(s) || "Starting"}…`]
          : b.failures
            ? ["err", `The last update failed: ${b.lastError?.message || "no reason given"}.${b.lastOk ? ` Last good update ${when(b.lastOk)}.` : ""}`]
            : !b.automatic
              ? ["warn", "Automatic updates are off. Update now still works."]
              : b.lastOk
                ? ["ok", `Up to date. Last update ${when(b.lastOk)}.`]
                : ["busy", "Waiting for the first update."];
      h += `<div class="md-state ${state[0]}"><i></i><span>${esc(state[1])}</span></div>`;
      if (!ro) {
        h += `<label class="cs-chk"><input type="checkbox" data-bh="auto" ${b.automatic ? "checked" : ""}><span class="cs-box"></span><span>Update automatically, every hour</span></label>`;
        h += '<div class="md-acts"><button class="btn" data-bh="update">Update now</button></div>';
      }
      h += flash;
      if (b.lastJob && !b.lastJob.ok && Date.now() - Date.parse(b.lastJob.at) < 600e3) h += `<div class="ai-status err">${esc(b.lastJob.message)}</div>`;
      h += '<div class="md-sub">Coins</div><table class="md-coins"><thead><tr><th>Coin</th><th>From</th><th>Through</th><th></th><th></th></tr></thead><tbody>';
      for (const pair of list) {
        const p = b.pairs?.[pair] || {};
        const dl = p.first ? `<a class="md-dl" href="/api/history/export?exchange=BINANCE&pair=${encodeURIComponent(pair)}" download title="Download ${esc(pair)}'s stored bars as CSV">⬇</a>` : "";
        const rm = ro ? "" : `<button class="md-rm" data-bh="remove" data-pair="${esc(pair)}" title="Remove ${esc(pair)} and its stored bars">×</button>`;
        h += `<tr><td><b>${esc(pair)}</b></td><td>${p.first ? esc(when(p.first, { time: false })) : "…"}</td><td>${p.last ? esc(when(p.last)) : "…"}</td><td>${dl}</td><td>${rm}</td></tr>`;
        if (p.error) h += `<tr class="md-err"><td colspan="5">${esc(when(p.error.at))}: ${esc(p.error.message)}</td></tr>`;
      }
      for (const pair of q.filter((x) => x.cmd === "add").map((x) => x.pair).filter((x) => !list.includes(x)))
        h += `<tr><td><b>${esc(pair)}</b></td><td>…</td><td>…</td><td><span class="muted">Adding</span></td><td></td></tr>`;
      h += "</tbody></table>";
      // coins offered that Binance doesn't list (a Kraken coin like XDC), left out of the download
      const out = (b.notListed || []).filter((x) => !list.includes(x));
      if (out.length) h += `<div class="ai-sub md-tight">Binance doesn't list ${esc(out.join(", "))}, so ${out.length === 1 ? "it's" : "they're"} left out.</div>`;
      h += addRow;
      if (!ro) h += "<div class=\"ai-sub md-tight\">Binance's names, as on its charts: BTCUSDT, ETHBTC. Removing a coin deletes its stored bars.</div>";
      return `${h}</div>`;
    },
    // keep the page still while a coin is being typed
    typing: (page) => page.contains(document.activeElement) && document.activeElement.matches('[data-bh="pair"]'),
    bind(page, redraw) {
      const go = async (job, done) => {
        await ask(job, done);
        await this.load();
        redraw();
      };
      const start = page.querySelector('[data-bh="start"]');
      if (start) start.onclick = () => go({ cmd: "start", pairs: offered() }, "Downloading Binance's history. It shows here as it goes.");
      const auto = page.querySelector('[data-bh="auto"]');
      if (auto) auto.onchange = (e) => go({ cmd: "automatic", on: e.target.checked }, e.target.checked ? "Updates every hour." : "Automatic updates off. Update now still works.");
      const upd = page.querySelector('[data-bh="update"]');
      if (upd) upd.onclick = () => go({ cmd: "update" }, "Updating Binance's history.");
      const box = page.querySelector('[data-bh="pair"]');
      const add = page.querySelector('[data-bh="add"]');
      if (box) {
        box.oninput = () => (st.add = box.value);
        box.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === "Enter") add?.click();
        };
      }
      if (add)
        add.onclick = () => {
          const pair = String(st.add || "").trim().toUpperCase().replace(/^BINANCE:/, "");
          if (!PAIR.test(pair)) {
            st.flash = "Type Binance's name for the pair, like BTCUSDT.";
            st.tone = "err";
            st.flashAt = Date.now();
            return redraw();
          }
          st.add = "";
          const first = !(st.s?.binance?.list || []).length;
          go(first ? { cmd: "start", pairs: [pair] } : { cmd: "add", pair }, `Adding ${pair}. It shows here when it's in.`);
        };
      for (const btn of page.querySelectorAll('[data-bh="remove"]'))
        btn.onclick = () => {
          const pair = btn.dataset.pair;
          if (!confirm(`Remove ${pair} and its stored bars? Its charts go back to Binance's live bars.`)) return;
          go({ cmd: "remove", pair }, `Removing ${pair}.`);
        };
    },
  };
}
