// AskCharts AI, on the right toolbar: a chat panel that answers questions about this app and the
// chart on screen, and does things on the chart when asked (agent.js runs its tools). It runs on your
// own API key, set in Settings, AskCharts AI; the key stays on the server (lib/copilot.js) and never
// comes back to the browser.
import { api, esc, ticker } from "./api.js";
import { BY_ID } from "../lib/indicators.js";
import { PRODUCTS } from "./products.js";
// agent.js (the AI's tools) loads on the first question: it imports the chart, which only runs in a
// browser, and the server's guide imports this file through Settings.
const loadAgent = () => import("./agent.js");

const $ = (s, el = document) => el.querySelector(s);
const STORE = "qt-copilot-chat";
// The same robot as AskCharts AI's button on the right toolbar, in a box wide enough for its ears
const ROBOT = `<svg viewBox="-1.5 0 31 28">${PRODUCTS.find((p) => p.id === "copilot").icon}</svg>`;
const I = {
  newChat: '<svg viewBox="0 0 24 24"><path d="M13 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19h11a1.5 1.5 0 0 0 1.5-1.5V11"/><path d="M17.5 4.5l2 2L12 14l-2.5.5.5-2.5z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5" class="fill"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  done: '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  look: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/></svg>',
  warn: '<svg viewBox="0 0 16 16"><path d="M8 2.5l6 11H2z"/><path d="M8 7v3M8 11.6v.4"/></svg>',
};
// Starter prompts: things to do on the chart, and things to learn.
const SUGGEST = [
  "Show me XRP on the 4 hour with RSI and a 50 EMA",
  "Draw support and resistance on this chart",
  "Put a Fibonacci retracement on the last swing",
  "Compare BTC and ETH on the daily",
  "Explain the indicators on my chart",
  "How do I set an alert when the price crosses a level?",
];

// ---------- a small, safe markdown subset: everything is escaped first ----------
function inline(s) {
  return s
    .split(/(`[^`]+`)/)
    .map((part) =>
      part.length > 1 && part.startsWith("`") && part.endsWith("`")
        ? `<code>${part.slice(1, -1)}</code>`
        : part
            .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
            .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<i>$2</i>")
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'),
    )
    .join("");
}
export function md(src) {
  const lines = esc(src).split("\n");
  let out = "",
    para = [],
    list = null,
    code = null;
  const endPara = () => {
    if (para.length) out += `<p>${para.map(inline).join("<br>")}</p>`;
    para = [];
  };
  const endList = () => {
    if (list) out += `<${list.tag}>${list.items.map((x) => `<li>${inline(x)}</li>`).join("")}</${list.tag}>`;
    list = null;
  };
  for (const line of lines) {
    if (code) {
      if (/^\s*```/.test(line)) {
        out += `<div class="cp-code"><button class="cp-copy" data-copy title="Copy">Copy</button><pre><code>${code.join("\n")}</code></pre></div>`;
        code = null;
      } else code.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) {
      endPara();
      endList();
      code = [];
      continue;
    }
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      endPara();
      endList();
      out += `<div class="cp-h">${inline(h[1])}</div>`;
    } else if (ul || ol) {
      endPara();
      const tag = ul ? "ul" : "ol";
      if (list && list.tag !== tag) endList();
      list ||= { tag, items: [] };
      list.items.push((ul || ol)[1]);
    } else if (!line.trim()) {
      endPara();
      endList();
    } else {
      endList();
      para.push(line);
    }
  }
  if (code) out += `<div class="cp-code"><pre><code>${code.join("\n")}</code></pre></div>`;
  endPara();
  endList();
  return out;
}

const shortName = (def) => /\(([^)]+)\)$/.exec(def.name)?.[1].split(" / ")[0] || def.name;
const iso = (sec) => (Number.isFinite(sec) ? new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ") : null);
const round = (v) => (Number.isFinite(v) ? Number(v.toPrecision(7)) : null);

export class Copilot {
  constructor(app) {
    this.app = app;
    this.cfg = null;
    this.busy = false;
    this.ctrl = null;
    this.el = null;
    this.tools = null;
    // undo points of each answer this session (not kept across a reload), the state each answer left,
    // and the open question
    this.undos = new WeakMap();
    this.after = new WeakMap();
    this.asking = null;
    try {
      this.messages = JSON.parse(localStorage.getItem(STORE) || "[]").filter((m) => m && typeof m.content === "string");
    } catch {
      this.messages = [];
    }
  }
  save() {
    try {
      // chart pictures aren't kept: they're large, and the model doesn't need old ones
      const slim = this.messages.slice(-40).map((m) =>
        m.api ? { ...m, api: m.api.map((x) => (x.role === "tool" ? { ...x, results: x.results.map((r) => (r.image ? { id: r.id, content: "[a picture of the chart]" } : { ...r, content: String(r.content ?? "").slice(0, 1500) })) } : x)) } : m,
      );
      localStorage.setItem(STORE, JSON.stringify(slim));
    } catch {
      /* private window */
    }
  }
  async refreshConfig() {
    try {
      this.cfg = await api.get("/api/copilot/config");
    } catch {
      this.cfg = this.cfg || { hasKey: false };
    }
    if (this.el?.isConnected) this.render();
    return this.cfg;
  }

  // What's on the chart, for questions about it (only when sharing is on in Settings).
  context() {
    const app = this.app,
      p = app.active;
    if (!p) return null;
    const bars = p.shown || [],
      bar = bars.at(-1),
      prev = bars.at(-2);
    const indicators = (p.cfg.indicators || [])
      .map((ind) => {
        const def = BY_ID[ind.id];
        if (!def) return null;
        const res = p.indResults?.[ind.uid] || {},
          values = {};
        for (const o of def.outputs || []) {
          const arr = res[o.key];
          for (let i = (arr?.length || 0) - 1; i >= Math.max(0, (arr?.length || 0) - 3); i--)
            if (Number.isFinite(arr[i])) {
              values[o.label || o.key] = round(arr[i]);
              break;
            }
        }
        return { name: `${shortName(def)} ${p.indicatorParamsLabel?.(ind) || ""}`.trim(), values, ...(ind.hidden ? { hidden: true } : {}), ...(res.error ? { error: String(res.error).slice(0, 120) } : {}) };
      })
      .filter(Boolean);
    const r = p.chart.timeScale().getVisibleLogicalRange();
    return {
      symbol: p.cfg.symbol,
      name: app.symbolName?.(p.cfg.symbol) || "",
      interval: p.cfg.tf,
      chartType: p.cfg.type,
      lastBar: bar ? { time: iso(bar.time), open: round(bar.open), high: round(bar.high), low: round(bar.low), close: round(bar.close), volume: round(bar.volume) } : null,
      previousClose: prev ? round(prev.close) : null,
      barsLoaded: bars.length,
      visible: r ? { from: iso(p.timeOfLogical(Math.max(0, r.from))), to: iso(p.timeOfLogical(Math.min(bars.length - 1, r.to))) } : null,
      indicators,
      compare: p.cfg.compare || [],
      drawings: p.drawings?.items?.length || 0,
      charts: app.panes.length,
      activeAlerts: (app.alertList || []).filter((a) => a.active).length,
      replay: !!p.replay,
      source: p.provider || "",
      theme: document.documentElement.dataset.theme || "dark",
    };
  }

  // Its own element inside the side panel, so an answer still streaming after you switch panels
  // doesn't draw into the next one.
  mount(side) {
    this.el = document.createElement("div");
    this.el.className = "cp-root";
    side.replaceChildren(this.el);
    this.render();
    this.refreshConfig();
    loadAgent().catch(() => {}); // ready before the first question
  }

  render() {
    const el = this.el;
    if (!el?.isConnected) return;
    const cfg = this.cfg;
    const ready = cfg?.hasKey && cfg?.model;
    const body = !cfg
      ? '<div class="pad hint-text">Loading…</div>'
      : !ready
        ? `<div class="cp-empty">${ROBOT}<div class="cp-hello">AskCharts AI</div><p>Ask anything about AskCharts or the chart on screen, or tell it what to put on the chart. It runs on your own API key.</p><button class="btn cp-cta" data-x="settings">Connect a model</button><p class="cp-small">Settings, AskCharts AI: pick the provider, paste the key, Test, choose a model.</p></div>`
        : this.messages.length
          ? this.messages.map((m, i) => this.bubble(m, i)).join("")
          : `<div class="cp-empty">${ROBOT}<div class="cp-hello">How can I help?</div><p>Ask about the chart, or tell me what to put on it. Every change can be undone.</p><div class="cp-sugg">${SUGGEST.map((s) => `<button data-ask="${esc(s)}">${esc(s)}</button>`).join("")}</div></div>`;
    el.innerHTML = `<div class="sp-fill cp">
      <div class="sp-head"><span class="cp-mark">${ROBOT}</span><span class="sp-name">AskCharts AI</span><span class="spacer"></span><button class="sp-icon" data-x="new" title="New chat">${I.newChat}</button><button class="sp-icon" data-x="settings" title="AskCharts AI settings">${I.gear}</button></div>
      <div class="sp-scroll cp-log">${body}</div>
      <div class="cp-foot">
        <div class="cp-box"><textarea rows="1" placeholder="${ready ? "Ask, or tell me what to put on the chart" : "Connect a model in Settings first"}" ${ready ? "" : "disabled"}></textarea><button class="cp-send" data-x="${this.busy ? "stop" : "send"}" title="${this.busy ? "Stop" : "Ask (Enter)"}" ${ready ? "" : "disabled"}>${this.busy ? I.stop : I.send}</button></div>
        <div class="cp-note">${ready ? `${esc(cfg.modelName || cfg.model)}. Answers can be wrong. Not financial advice.` : "&nbsp;"}</div>
      </div></div>`;
    const log = $(".cp-log", el),
      ta = $("textarea", el);
    log.scrollTop = log.scrollHeight;
    el.onclick = (e) => {
      const b = e.target.closest("[data-x],[data-ask],[data-copy],[data-retry],[data-undo],[data-answer]");
      if (!b) return;
      if (b.dataset.ask) return this.ask(b.dataset.ask);
      if (b.dataset.undo) return this.undo(b.dataset.undo);
      if (b.dataset.answer) return this.answer(b.dataset.answer === "yes");
      if (b.hasAttribute("data-copy")) {
        const t = b.parentElement.querySelector("code")?.textContent || "";
        navigator.clipboard?.writeText(t).then(() => this.app.toast("Copied."), () => this.app.toast("Couldn't copy.", "err"));
        return;
      }
      if (b.hasAttribute("data-retry")) return this.retry();
      const x = b.dataset.x;
      if (x === "settings") return this.app.openSettings("ai");
      if (x === "new") {
        this.stop();
        this.answer(false);
        this.messages = [];
        this.save();
        return this.render();
      }
      if (x === "send") return this.ask(ta.value);
      if (x === "stop") return this.stop();
    };
    const grow = () => {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(140, ta.scrollHeight)}px`;
    };
    ta.oninput = grow;
    ta.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!this.busy) this.ask(ta.value);
      }
    };
    if (ready) ta.focus();
  }

  bubble(m, i) {
    if (m.role === "user") return `<div class="cp-msg cp-user" data-i="${i}"><div class="cp-bub">${esc(m.content).replace(/\n/g, "<br>")}</div></div>`;
    const tail = m.error
      ? `<div class="cp-err">${esc(m.error)} <button class="cp-retry" data-retry>Try again</button></div>`
      : m.stopped
        ? '<div class="cp-meta">Stopped.</div>'
        : "";
    if (!m.parts) {
      const typing = m.pending && !m.content ? '<div class="cp-typing"><i></i><i></i><i></i></div>' : "";
      return `<div class="cp-msg cp-ai" data-i="${i}"><div class="cp-md">${md(m.content)}${typing}</div>${tail}</div>`;
    }
    // an answer that acted: its text, and each step with Undo (this session only)
    const snaps = this.undos.get(m);
    let html = "",
      undoable = 0;
    for (const part of m.parts) {
      if (part.t === "text") html += `<div class="cp-md">${md(part.v)}</div>`;
      else if (part.t === "look") html += `<div class="cp-look">${I.look}<span>${esc(part.label)}</span></div>`;
      else if (part.t === "ask") {
        const open = part.answer == null && this.asking?.part === part;
        html += `<div class="cp-ask"><span>${esc(part.q)}</span>${open ? '<span class="cp-ask-btns"><button class="btn" data-answer="yes">Yes</button><button class="btn" data-answer="no">No</button></span>' : `<span class="cp-meta">${part.answer ? "Yes" : "No"}</span>`}</div>`;
      } else if (part.t === "step") {
        const can = snaps && part.k != null && !part.undone && !part.error && !part.declined;
        if (can) undoable++;
        const cls = part.error ? " err" : part.undone ? " undone" : part.declined ? " declined" : "";
        html += `<div class="cp-step${cls}">${part.error ? I.warn : I.done}<span>${esc(part.label)}</span>${can ? `<button class="cp-undo" data-undo="${i}:${part.k}" title="Put this back, and anything after it">Undo</button>` : part.undone ? '<span class="cp-meta">Undone</span>' : ""}</div>`;
      }
    }
    const typing = m.pending ? '<div class="cp-typing"><i></i><i></i><i></i></div>' : "";
    const all = !m.pending && undoable > 1 ? `<button class="cp-undo cp-undo-all" data-undo="${i}:0">Undo all</button>` : "";
    const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
    const used = m.usage && !m.pending ? `<div class="cp-meta cp-used">${k(m.usage.input + m.usage.cached + m.usage.output)} tokens${m.usage.cached ? ` (${k(m.usage.cached)} from cache)` : ""}</div>` : "";
    return `<div class="cp-msg cp-ai" data-i="${i}">${html}${typing}${all}${tail}${used}</div>`;
  }
  paintLast() {
    const log = this.el?.isConnected && $(".cp-log", this.el);
    if (!log) return;
    const i = this.messages.length - 1,
      node = log.querySelector(`.cp-msg[data-i="${i}"]`);
    const html = this.bubble(this.messages[i], i);
    if (node) node.outerHTML = html;
    else log.insertAdjacentHTML("beforeend", html);
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
    if (near) log.scrollTop = log.scrollHeight;
  }

  stop() {
    if (this.ctrl) this.ctrl.abort();
    this.answer(false);
  }
  // Yes or No to the question the AI asked before a big change.
  answer(yes) {
    const q = this.asking;
    if (!q) return;
    this.asking = null;
    q.part.answer = yes;
    q.resolve(yes);
    this.render();
  }
  // Undo a step and everything after it in that answer ("i:k": message i, undo point k).
  async undo(ref) {
    const [i, k] = ref.split(":").map(Number);
    const m = this.messages[i],
      snaps = m && this.undos.get(m);
    if (!snaps?.[k] || this.busy || !this.tools) return;
    // Undo puts the whole view back as it was: say so if things changed after this answer
    const after = this.after.get(m);
    if (after && !this.tools.same(after, this.tools.snapshot()) && !confirm("This also undoes the changes made since this answer. Undo anyway?")) return;
    await this.tools.restore(snaps[k]);
    this.after.set(m, this.tools.snapshot());
    for (const part of m.parts || []) if (part.t === "step" && part.k != null && part.k >= k) part.undone = true;
    this.save();
    this.render();
    this.app.toast(k === 0 ? "Undid every change in that answer." : "Undone.");
  }
  async retry() {
    const last = this.messages.at(-1);
    // a failed answer may have changed things before it broke: put them back, so trying again can't double them
    const snaps = last && this.undos.get(last);
    if (last?.role === "assistant" && snaps?.length && this.tools) await this.tools.restore(snaps[0]);
    if (last?.role === "assistant") this.messages.pop();
    const q = this.messages.at(-1);
    if (q?.role === "user") {
      this.messages.pop();
      this.ask(q.content);
    }
  }

  async ask(text) {
    const q = String(text || "").trim();
    if (!q || this.busy) return;
    if (!this.cfg?.hasKey) return this.app.openSettings("ai");
    // busy before anything waits, so a second Enter can't start a second answer
    this.busy = true;
    let mod;
    try {
      mod = await loadAgent();
    } catch (e) {
      this.busy = false;
      return this.app.toast(`AskCharts AI couldn't load: ${esc(e.message)}`, "err");
    }
    const { AgentTools, converse, historyFor } = mod;
    this.tools ||= new AgentTools(this.app);
    const earlier = historyFor(this.messages.filter((m) => !m.error));
    this.messages.push({ role: "user", content: q });
    const a = { role: "assistant", content: "", parts: [], pending: true };
    this.messages.push(a);
    const snaps = [];
    this.undos.set(a, snaps);
    this.render();
    this.ctrl = new AbortController();
    let frame = 0;
    const paint = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          this.paintLast();
        });
    };
    const textPart = () => {
      const last = a.parts.at(-1);
      if (last?.t === "text") return last;
      const p = { t: "text", v: "" };
      a.parts.push(p);
      return p;
    };
    try {
      const { exchanges, stop, usage } = await converse({
        tools: this.tools,
        history: [...earlier, { role: "user", content: q }],
        context: this.cfg.context ? this.context() : null,
        signal: this.ctrl.signal,
        askFirst: !!this.cfg.askFirst,
        onText: (v) => {
          textPart().v += v;
          a.content += v;
          paint();
        },
        onStep: (call, done) => {
          if (done.read && !done.error) a.parts.push({ t: "look", label: done.label });
          else {
            const part = { t: "step", label: done.label || call.name };
            if (done.error) part.error = true;
            if (done.declined) part.declined = true;
            if (done.snap) {
              part.k = snaps.length;
              snaps.push(done.snap);
            }
            a.parts.push(part);
          }
          paint();
        },
        confirm: (question) =>
          new Promise((resolve) => {
            const part = { t: "ask", q: question, answer: null };
            a.parts.push(part);
            this.asking = { part, resolve };
            this.render();
          }),
      });
      a.api = exchanges;
      a.usage = usage;
      if (stop === "max_tokens") textPart().v += "\n\n(The answer hit its length limit. Ask me to continue.)";
    } catch (e) {
      if (e.name === "AbortError") a.stopped = true;
      else a.error = e.message;
    } finally {
      this.asking?.resolve(false);
      this.asking = null;
      if (snaps.length) this.after.set(a, this.tools.snapshot());
      a.pending = false;
      this.busy = false;
      this.ctrl = null;
      if (!a.parts.length && !a.error && !a.stopped) a.error = "No answer came back.";
      this.save();
      this.render();
    }
  }
}

// ---------- Settings, AskCharts AI: provider, key, Test, model ----------
// The typed key lives only in this dialog and in the requests that test and save it.
export function aiSettings(app) {
  const st = { cfg: null, key: "", reveal: false, models: null, model: "", context: true, askFirst: false, status: "", tone: "", remove: false };
  const pick = (models) => {
    const keep = models.find((m) => m.id === (st.model || st.cfg?.model));
    return (keep || models.find((m) => /sonnet/i.test(m.id) && !m.deprecated) || models.find((m) => !m.deprecated) || models[0])?.id || "";
  };
  return {
    async load() {
      try {
        st.cfg = await api.get("/api/copilot/config");
      } catch {
        st.cfg = { providers: [{ id: "anthropic", name: "Anthropic (Claude, hosted)" }], provider: "anthropic", hasKey: false, context: true };
      }
      st.model = st.cfg.model || "";
      st.context = st.cfg.context !== false;
      st.askFirst = st.cfg.askFirst === true;
    },
    html() {
      const c = st.cfg;
      if (!c) return '<div class="cs-sec">ASKCHARTS AI</div><div class="cs-l span">Loading…</div>';
      const hasKey = c.hasKey && !st.remove;
      const models = st.models
        ? st.models.map((m) => `<option value="${esc(m.id)}" ${m.id === st.model ? "selected" : ""}>${esc(m.name)}${m.deprecated ? " (deprecated)" : ""}</option>`).join("")
        : `<option>${esc(hasKey && c.modelName ? c.modelName : "Test the key first")}</option>`;
      return `<div class="cs-sec">ASKCHARTS AI</div><div class="ai-wrap">
        <p class="ai-lead">AskCharts AI answers questions about the app and the chart on screen, and does things on the chart when you ask, in the panel on the right toolbar. It runs on your own API key.</p>
        <label class="ai-f"><span>Provider</span><select class="cs-num ai-in" data-ai="provider">${(c.providers || []).map((p) => `<option value="${esc(p.id)}" ${p.id === c.provider ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
        <div class="ai-f"><span>API key</span><div class="ai-row"><div class="ai-key"><input class="cs-num ai-in" data-ai="key" type="${st.reveal ? "text" : "password"}" autocomplete="off" spellcheck="false" placeholder="${hasKey ? `Saved key ending in ${esc(c.keyHint)}. Paste a new one to replace it` : "Paste the key"}" value="${esc(st.key)}"><button class="ai-eye" data-ai="eye" title="${st.reveal ? "Hide" : "Show"} what you typed">${I.eye}</button></div><button class="btn ai-test" data-ai="test">Test</button></div></div>
        <label class="ai-f"><span>Model</span><select class="cs-num ai-in" data-ai="model" ${st.models ? "" : "disabled"}>${models}</select></label>
        <div class="ai-status ${st.tone}">${esc(st.status)}</div>
        <label class="cs-chk"><input type="checkbox" data-ai="context" ${st.context ? "checked" : ""}><span class="cs-box"></span><span>Share the chart with AskCharts AI</span></label>
        <div class="ai-sub">Sends the symbol, interval, last bar, indicator values and what's in view with each question.</div>
        <label class="cs-chk"><input type="checkbox" data-ai="askFirst" ${st.askFirst ? "checked" : ""}><span class="cs-box"></span><span>Ask before each change</span></label>
        <div class="ai-sub">Off: it makes the changes you ask for and lists each one with Undo. It always asks before removing several things.</div>
        ${hasKey ? '<button class="ai-remove" data-ai="remove">Remove the saved key</button>' : st.remove ? '<div class="ai-sub">The saved key will be removed when you press Ok.</div>' : ""}
        <p class="ai-note">The key stays on this computer, in a file only this account can read. It's sent only to the provider, never back to the browser. Questions are billed to your provider account.</p>
      </div>`;
    },
    bind(page, redraw) {
      const key = page.querySelector('[data-ai="key"]');
      if (!key) return;
      key.oninput = () => {
        st.key = key.value;
        if (st.models) {
          st.models = null;
          st.status = "Test the new key.";
          st.tone = "";
          redraw();
          page.querySelector('[data-ai="key"]')?.focus();
        }
      };
      key.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === "Enter") page.querySelector('[data-ai="test"]')?.click();
      };
      page.querySelector('[data-ai="model"]').onchange = (e) => (st.model = e.target.value);
      page.querySelector('[data-ai="context"]').onchange = (e) => (st.context = e.target.checked);
      page.querySelector('[data-ai="askFirst"]').onchange = (e) => (st.askFirst = e.target.checked);
      page.querySelector('[data-ai="eye"]').onclick = () => {
        st.reveal = !st.reveal;
        redraw();
      };
      const rm = page.querySelector('[data-ai="remove"]');
      if (rm)
        rm.onclick = () => {
          st.remove = true;
          st.models = null;
          st.status = "";
          redraw();
        };
      page.querySelector('[data-ai="test"]').onclick = async (e) => {
        const btn = e.currentTarget;
        if (!st.key.trim() && !(st.cfg.hasKey && !st.remove)) {
          st.status = "Paste a key first.";
          st.tone = "err";
          return redraw();
        }
        btn.disabled = true;
        btn.textContent = "Testing…";
        try {
          const models = await api.post("/api/copilot/models", { provider: page.querySelector('[data-ai="provider"]').value, key: st.key.trim() });
          if (!models.length) throw new Error("The key works, but no models came back.");
          st.models = models;
          st.model = pick(models);
          st.status = `Connected. ${models.length} model${models.length === 1 ? "" : "s"} available. Pick one, then press Ok to save.`;
          st.tone = "ok";
        } catch (err) {
          st.models = null;
          st.status = err.message;
          st.tone = "err";
        }
        redraw();
      };
    },
    pending: () => (st.key.trim() && !st.models ? "Test the new AI key first (or clear it) before pressing Ok." : ""),
    // On Ok. A new key is checked again by the server before it's saved.
    async commit() {
      const c = st.cfg;
      if (!c) return "";
      const provider = c.provider || "anthropic";
      const typed = st.key.trim();
      let msg = "";
      if (st.remove && !typed) {
        await api.del("/api/copilot/key");
        msg = "Removed the AskCharts AI key.";
      }
      if (typed) {
        if (!st.models) throw new Error("Test the new key before saving it.");
        const r = await api.put("/api/copilot/config", { provider, key: typed, model: st.model, context: st.context, askFirst: st.askFirst });
        msg = `AskCharts AI connected (${r.modelName || r.model}).`;
      } else if (!st.remove && c.hasKey && (st.model && st.model !== c.model)) {
        const r = await api.put("/api/copilot/config", { provider, model: st.model, context: st.context, askFirst: st.askFirst });
        msg = `AskCharts AI now uses ${r.modelName || r.model}.`;
      } else if (!st.remove && (st.context !== (c.context !== false) || st.askFirst !== (c.askFirst === true))) {
        await api.put("/api/copilot/config", { provider, context: st.context, askFirst: st.askFirst });
      }
      await app.copilot?.refreshConfig();
      return msg;
    },
  };
}
