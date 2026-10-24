// Settings, Crypto data: the history store that gives KRAKEN charts and the strategy report's deep
// backtests years of Kraken's own bars (history/ at the repo root). The page shows what the importer
// last did and asks it for more: Update now, Automatic, a coin in or out, an accuracy check, a gap scan.
// The importer runs those outside the app (AskCharts' runner starts it), so they carry on through a restart.
import { api, esc } from "./api.js";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");
// "20:05" today, "15 Oct 20:05" this year, "6 Oct 2013" before (local time)
export function when(iso, { time = true } = {}) {
  const t = typeof iso === "number" ? iso * 1000 : Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const d = new Date(t),
    now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (time && d.toDateString() === now.toDateString()) return hm;
  const day = `${d.getDate()} ${MON[d.getMonth()]}`;
  if (d.getFullYear() !== now.getFullYear()) return `${day} ${d.getFullYear()}`;
  return time ? `${day} ${hm}` : day;
}
const gb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round((b || 0) / 1e6)} MB`);
const JOB_WORDS = { update: "Update now", add: "Add", remove: "Remove", verify: "Accuracy check", gaps: "Gap scan", automatic: "Automatic" };
const COMMON = { XBT: "BTC", XDG: "DOGE" };
// Kraken's quote currencies, longest first so "USDT"/"USDC" aren't cut short as "USD" (a pair can only
// end with one of these, so there's no real ambiguity either way).
const QUOTES = ["USDT", "USDC", "USD", "EUR", "GBP", "AUD", "CAD", "JPY", "CHF", "XBT", "ETH"];
const common = (pair) => {
  const q = QUOTES.find((x) => pair.length > x.length && pair.endsWith(x));
  if (!q) return pair;
  const base = pair.slice(0, -q.length);
  return `${COMMON[base] || base}/${COMMON[q] || q}`;
};

export function marketData() {
  const st = { s: null, err: "", json: "", pairs: null, flash: "", flashAt: 0, tone: "", add: "" };
  const ask = async (job, done) => {
    try {
      const r = await api.post("/api/history/jobs", job);
      if (st.s) st.s.queued = r.queued;
      st.flash = done;
      st.flashAt = Date.now();
      st.tone = "ok";
    } catch (e) {
      st.flash = e.message;
      st.flashAt = Date.now();
      st.tone = "err";
    }
  };
  return {
    // true when something on the page changed
    async load() {
      try {
        const s = await api.get("/api/history/status");
        const json = JSON.stringify(s);
        st.err = "";
        if (json === st.json) return false;
        st.json = json;
        st.s = s;
      } catch (e) {
        st.err = e.message;
      }
      return true;
    },
    async loadPairs() {
      if (st.pairs) return;
      try {
        st.pairs = await api.get("/api/history/pairs");
      } catch {
        st.pairs = [];
      }
    },
    html() {
      const s = st.s;
      let h = '<div class="cs-sec">KRAKEN (CRYPTO)</div>';
      if (!s) return `${h}<div class="cs-l span">${st.err ? `Crypto data isn't available: ${esc(st.err)}` : "Loading…"}</div>`;
      // nothing downloaded yet: offer it (a big first download, so it's never started for you). An empty
      // store counts as nothing: the importer makes one the first time it runs for any reason.
      const none = !s.available || !(s.kraken?.coins || []).some((c) => s.kraken.pairs?.[c]?.first);
      if (none && !s.kraken?.automatic && !s.kraken?.job) {
        const asked = (s.queued || []).some((x) => x.cmd === "automatic" && x.on);
        h += `<div class="md-wrap"><p class="ai-lead">Kraken's history isn't downloaded yet, so KRAKEN charts show Kraken's last 720 bars. Downloading it gives them years of Kraken's own bars, from each coin's first trade, and keeps them up to date every hour.</p>`;
        h += `<p class="ai-note">The first download is Kraken's archive, about 10 GB. It needs about 34 GB free while it comes in and is checked, and 20 GB after. Then each coin catches up from the archive's end (the last quarter's) at Kraken's pace: minutes for a quiet coin, an hour or more for a busy one.</p>`;
        h += asked ? '<div class="md-state busy"><i></i><span>Starting the download…</span></div>' : '<div class="md-acts"><button class="btn primary" data-md="start">Download Kraken history</button></div>';
        if (st.flash && Date.now() - st.flashAt < 30000) h += `<div class="ai-status ${st.tone}">${esc(st.flash)}</div>`;
        return `${h}</div>`;
      }
      const k = s.kraken,
        coins = k.coins || [],
        q = s.queued || [];
      // a request still waiting shows as made: the importer applies it when its turn comes
      const auto = q.filter((x) => x.cmd === "automatic").at(-1)?.on ?? k.automatic;
      const removing = new Set(q.filter((x) => x.cmd === "remove").map((x) => x.pair)),
        adding = q.filter((x) => x.cmd === "add" && !coins.includes(x.pair)).map((x) => x.pair);
      h += '<div class="md-wrap">';
      h += `<p class="ai-lead">Years of Kraken's own bars, from each coin's first trade, stored on this computer. KRAKEN charts and the strategy report's backtests use them; the newest bars still come live from Kraken.</p>`;
      h += `<div class="md-state ${this.tone(s)}"><i></i><span>${esc(this.state(s))}</span></div>`;
      // a copy reading another's store (QT_HISTORY_JOBS=off): its requests would run there, so none here
      const ro = s.jobs === false;
      if (ro) h += `<div class="ai-note">This copy reads the store read only, so Update now, Add and Remove are off here. They run on the copy that keeps the store. Automatic updates are ${auto ? "on" : "off"} there.</div>`;
      else {
        h += `<label class="cs-chk"><input type="checkbox" data-md="auto" ${auto ? "checked" : ""}><span class="cs-box"></span><span>Update automatically, every hour</span></label>`;
        h += '<div class="md-acts"><button class="btn" data-md="update">Update now</button><button class="btn" data-md="verify">Check accuracy</button><button class="btn" data-md="gaps">Find gaps</button></div>';
      }
      if (st.flash && Date.now() - st.flashAt < 30000) h += `<div class="ai-status ${st.tone}">${esc(st.flash)}</div>`;
      // the facts, in TradingView's two-column rows
      const fact = (l, r) => `<div class="md-k">${l}</div><div class="md-v">${r}</div>`;
      const ar = k.archives || [];
      let f = fact("Kraken's archives", ar.length ? `${esc(ar.map((a) => (a === "Full" ? "Full" : a)).join(", "))}${k.nextQuarter ? `. ${esc(k.nextQuarter)} is fetched when Kraken posts it (checked daily${k.quarterCheckedAt ? `, last ${esc(when(k.quarterCheckedAt))}` : ""}).` : ""}` : "None imported");
      const ver = coins.map((c) => k.pairs[c]?.verify).filter((v) => v && !v.error);
      const off = coins.filter((c) => k.pairs[c]?.verify && !k.pairs[c].verify.ok && !k.pairs[c].verify.error);
      f += fact("Accuracy check", ver.length ? `${esc(when(ver.map((v) => v.at).sort().at(-1)))}: ${off.length ? `<span class="md-bad">${esc(off.join(", "))} ${off.length === 1 ? "differs" : "differ"} from Kraken</span>` : `${ver.length} of ${coins.length} coins match Kraken's own bars`}. Weekly.` : "Not run yet. Weekly.");
      const gp = coins.map((c) => k.pairs[c]?.gaps).filter(Boolean);
      const bad = gp.reduce((a, g) => a + (g.mismatched || 0), 0),
        fixed = gp.reduce((a, g) => a + (g.repaired || 0), 0);
      f += fact("Gap scan", gp.length ? `${esc(when(gp.map((g) => g.at).sort().at(-1)))}: ${bad ? `${bad} hours off in the last 30 days, ${fixed} repaired from Kraken's trades` : "no hours missing in the last 30 days"}. Daily.` : "Not run yet. Daily.");
      if (s.disk) f += fact("Disk", `Store ${gb(s.disk.storeBytes)}, downloads ${gb(s.disk.rawBytes)}. ${gb(s.disk.freeBytes)} free; imports stop below ${s.disk.minFreeGB} GB.`);
      h += `<div class="md-facts">${f}</div>`;
      // the coins
      h += '<div class="md-sub">Coins</div><table class="md-coins"><thead><tr><th>Coin</th><th>From</th><th>Through</th><th>Check</th><th></th><th></th></tr></thead><tbody>';
      for (const c of coins) {
        const p = k.pairs[c] || {},
          v = p.verify;
        const chk = removing.has(c)
          ? '<span class="muted">Removing</span>'
          : !v
            ? '<span class="muted">Not yet</span>'
            : v.error
              ? `<span class="muted" title="${esc(v.error)}">Couldn't check</span>`
              : v.ok
                ? '<span class="md-good">Matches</span>'
                : '<span class="md-bad">Differs</span>';
        const rm = removing.has(c) || ro ? "" : `<button class="md-rm" data-md="remove" data-pair="${esc(c)}" title="Remove ${esc(c)} and its stored bars">×</button>`;
        // a plain GET link (no x-qt needed): downloads what's stored, finest grain first (Kraken's archives: 1 minute)
        const dl = p.first ? `<a class="md-dl" href="/api/history/export?pair=${esc(c)}" download title="Download ${esc(c)}'s stored bars as CSV">⬇</a>` : "";
        h += `<tr><td><b>${esc(common(c))}</b> <span class="muted">${esc(c)}</span></td><td>${p.first ? esc(when(p.first, { time: false })) : "…"}</td><td>${p.last1m ? esc(when(p.last1m)) : "…"}</td><td>${chk}</td><td>${dl}</td><td>${rm}</td></tr>`;
        if (p.error) h += `<tr class="md-err"><td colspan="6">${esc(when(p.error.at))}: ${esc(p.error.message)}</td></tr>`;
      }
      for (const c of adding) h += `<tr><td><b>${esc(common(c))}</b> <span class="muted">${esc(c)}</span></td><td>…</td><td>…</td><td><span class="muted">Adding</span></td><td></td><td></td></tr>`;
      h += "</tbody></table>";
      const opts = ro ? "" : (st.pairs || []).filter((p) => !coins.includes(p.pair)).map((p) => `<option value="${esc(p.pair)}">${esc(p.name)}</option>`).join("");
      if (!ro) {
        h += `<div class="md-add"><input class="cs-num ai-in" data-md="pair" list="md-pairs" placeholder="Add a coin: Kraken's name, like ATOMUSD or XRPEUR" autocomplete="off" spellcheck="false" value="${esc(st.add)}"><datalist id="md-pairs">${opts}</datalist><button class="btn" data-md="add">Add coin</button></div>`;
        h += `<div class="ai-sub md-tight">Kraken's archive has every coin from its first trade. Adding one takes about a minute, then its trades since the archive, at Kraken's pace (an hour or more for a busy coin).</div>`;
      }
      // Binance's section and the note on other exchanges follow, from Settings (chartsettings.js)
      h += `<p class="ai-note">Actions here start right away; Cancel doesn't undo them. Removing a coin deletes its bars and shrinks the store file, which needs about twice the store's size free for a moment.</p></div>`;
      return h;
    },
    tone(s) {
      const k = s.kraken;
      if (k.failures >= 1) return "err";
      if (k.job || s.queued?.length) return "busy";
      if (!k.automatic || (k.lastOk && Date.now() - Date.parse(k.lastOk) > 3 * 3600e3)) return "warn";
      return "ok";
    },
    state(s) {
      const k = s.kraken;
      if (k.job) return `Working: ${[k.job.pair, k.job.note || k.job.kind].filter(Boolean).join(", ")}${s.queued?.length ? `. Waiting: ${s.queued.map((q) => JOB_WORDS[q.cmd] + (q.pair ? ` ${q.pair}` : "")).join(", ")}` : ""}`;
      if (s.queued?.length) return `Waiting to start: ${s.queued.map((q) => JOB_WORDS[q.cmd] + (q.pair ? ` ${q.pair}` : "")).join(", ")}`;
      if (k.failures >= 1) return `The last ${k.failures > 1 ? `${k.failures} updates` : "update"} failed: ${k.lastError?.message || "no reason given"}.${k.lastOk ? ` Last good update ${when(k.lastOk)}.` : ""}`;
      if (!k.automatic) return "Automatic updates are off. Update now still works.";
      if (k.lastOk && Date.now() - Date.parse(k.lastOk) > 3 * 3600e3) return `No update since ${when(k.lastOk)}. Is the hourly timer running?`;
      if (k.lastJob && Date.now() - Date.parse(k.lastJob.at) < 600e3 && !k.lastJob.ok) return `${JOB_WORDS[k.lastJob.cmd] || "The last request"} failed: ${k.lastJob.message}`;
      // what a Remove did to the store's size, for a while after
      if (k.lastJob?.ok && k.lastJob.cmd === "remove" && /^removed/.test(k.lastJob.message || "") && Date.now() - Date.parse(k.lastJob.at) < 600e3)
        return `Remove ${k.lastJob.pair}: ${k.lastJob.message}.`;
      return k.lastOk ? `Up to date. Last update ${when(k.lastOk)}.` : "Waiting for the first update.";
    },
    // keep the page still while a coin is being typed
    typing: (page) => page.contains(document.activeElement) && document.activeElement.matches("input[type=text], input:not([type])"),
    bind(page, redraw) {
      const wrap = page.querySelector(".md-wrap");
      if (!wrap) return;
      const start = page.querySelector('[data-md="start"]');
      if (start)
        start.onclick = async () => {
          await ask({ cmd: "automatic", on: true }, "Downloading Kraken's history. It shows here as it goes.");
          await ask({ cmd: "update" }, "Downloading Kraken's history. It shows here as it goes.");
          await this.load();
          redraw();
        };
      if (!page.querySelector('[data-md="auto"]')) return;
      if (!st.pairs)
        this.loadPairs().then(() => {
          if (page.isConnected && !this.typing(page)) redraw();
        });
      const input = page.querySelector('[data-md="pair"]');
      const pairOf = (v) => {
        const t = v.trim().toUpperCase();
        const hit = (st.pairs || []).find((p) => p.pair === t || p.name.toUpperCase() === t || p.name.replace("/", "").toUpperCase() === t);
        return hit ? hit.pair : t;
      };
      const after = async (job, words) => {
        await ask(job, words);
        await this.load();
        redraw();
      };
      if (input) {
        input.oninput = () => (st.add = input.value);
        input.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === "Enter") page.querySelector('[data-md="add"]')?.click();
        };
      }
      // (no store yet: no checkbox)
      const auto = page.querySelector('[data-md="auto"]');
      if (auto) auto.onchange = (e) => after({ cmd: "automatic", on: e.target.checked }, e.target.checked ? "Automatic updates are on." : "Automatic updates are off.");
      wrap.onclick = (e) => {
        const b = e.target.closest("button[data-md]");
        if (!b) return;
        const act = b.dataset.md;
        if (act === "update") after({ cmd: "update" }, "Asked for an update. It starts when the current one finishes.");
        else if (act === "verify") after({ cmd: "verify" }, "Asked for an accuracy check.");
        else if (act === "gaps") after({ cmd: "gaps" }, "Asked for a gap scan of the last 30 days.");
        else if (act === "remove") {
          const pair = b.dataset.pair;
          if (!confirm(`Remove ${common(pair)} (${pair})? Its stored bars are deleted and the store file shrinks; its charts go back to Kraken's last 720 bars. Adding it again re-imports them.`)) return;
          after({ cmd: "remove", pair }, `Removing ${pair}.`);
        } else if (act === "add") {
          const pair = pairOf(st.add);
          if (!/^[A-Z0-9]{2,20}$/.test(pair)) {
            st.flash = "Type Kraken's name for the pair, like ATOMUSD (Bitcoin is XBTUSD).";
            st.flashAt = Date.now();
            st.tone = "err";
            return redraw();
          }
          st.add = "";
          after({ cmd: "add", pair }, `Adding ${pair}. Its archive bars take about a minute, then its trades since.`);
        }
      };
    },
  };
}
