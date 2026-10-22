// AskCharts AI: the model behind the AI panel. You bring your own API key. It is kept on
// this computer in data/copilot.json (readable by this account only, never in git, never sent to
// the browser) and is only ever sent to its provider, in a request header.
//
// The chat streams: the browser posts the conversation, this server adds the help guide (and,
// if you allow it, what's on the chart) and relays the provider's answer as it's written.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store.js";
import { systemBlocks } from "./copilot-guide.js";

const FILE = path.join(DATA_DIR, "copilot.json");
// QT_AI_BASE points the provider at a stand-in server, for tests only (they never use a real key).
export const PROVIDERS = [{ id: "anthropic", name: "Anthropic (Claude, hosted)", base: process.env.QT_AI_BASE || "https://api.anthropic.com" }];
const API_VERSION = "2023-06-01";
const MAX_TOKENS = 2048;
const MAX_TURNS = 20;
const MAX_CHARS = 8000;
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

let cfg = load();
function load() {
  try {
    return { provider: "anthropic", key: "", model: "", modelName: "", context: true, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch {
    return { provider: "anthropic", key: "", model: "", modelName: "", context: true };
  }
}
function save() {
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  fs.chmodSync(FILE, 0o600);
}
const providerOf = (id) => PROVIDERS.find((p) => p.id === (id || "anthropic")) || null;

// What the browser may see: never the key, only that there is one and its last four characters.
export function publicConfig() {
  return {
    provider: cfg.provider,
    providers: PROVIDERS.map(({ id, name }) => ({ id, name })),
    model: cfg.model,
    modelName: cfg.modelName,
    context: cfg.context !== false,
    askFirst: cfg.askFirst === true,
    hasKey: !!cfg.key,
    keyHint: cfg.key ? cfg.key.slice(-4) : "",
  };
}

// For the server only (lib/agent.js): where to send, and with what. Never sent to the browser.
export const agentConfig = () => ({ base: providerOf(cfg.provider)?.base, key: cfg.key, model: cfg.model, modelName: cfg.modelName, context: cfg.context !== false });

// The provider's error, without ever repeating the key.
export function apiError(status, body, key) {
  const msg = body?.error?.message || `HTTP ${status}`;
  const clean = key ? String(msg).split(key).join("…") : String(msg);
  if (status === 401) return `Anthropic didn't accept that key (${clean}).`;
  if (status === 403) return `That key isn't allowed to do this (${clean}).`;
  if (status === 429) return `Anthropic says slow down: rate limit or spend limit reached (${clean}).`;
  if (status === 529 || body?.error?.type === "overloaded_error") return "Anthropic is overloaded right now. Try again in a minute.";
  return `Anthropic replied: ${clean}`;
}

// The models a key can use, newest first: the key just typed, or the saved one.
export async function listModels({ provider, key } = {}, fetchImpl = fetch) {
  const p = providerOf(provider);
  if (!p) throw bad("Pick a provider.");
  const k = String(key || "").trim() || cfg.key;
  if (!k) throw bad("Paste an API key first.");
  let r;
  try {
    r = await fetchImpl(`${p.base}/v1/models?limit=100`, {
      headers: { "x-api-key": k, "anthropic-version": API_VERSION },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw bad(`Couldn't reach Anthropic: ${e.message}`, 502);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw bad(apiError(r.status, body, k), r.status === 401 || r.status === 403 ? 400 : 502);
  return (body.data || [])
    .filter((m) => m && m.type === "model" && m.id && m.lifecycle !== "retired")
    .map((m) => ({ id: m.id, name: m.display_name || m.id, created: m.created_at || "", deprecated: m.lifecycle === "deprecated" }));
}

// Save the settings. A new key is checked against the provider first and the model must be one
// it offers, so a typo can't be saved.
export async function setConfig(input = {}, fetchImpl = fetch) {
  const p = providerOf(input.provider);
  if (!p) throw bad("Pick a provider.");
  const key = String(input.key || "").trim();
  const next = { ...cfg, provider: p.id };
  if (typeof input.context === "boolean") next.context = input.context;
  if (typeof input.askFirst === "boolean") next.askFirst = input.askFirst;
  if (key || input.model !== undefined) {
    if (!key && !cfg.key) throw bad("Paste an API key first.");
    const models = await listModels({ provider: p.id, key }, fetchImpl);
    const model = input.model || cfg.model;
    const m = models.find((x) => x.id === model);
    if (!m) throw bad(model ? `That key can't use ${model}. Test the key and pick a model from the list.` : "Pick a model.");
    next.model = m.id;
    next.modelName = m.name;
    if (key) next.key = key;
  }
  cfg = next;
  save();
  return publicConfig();
}

export function removeKey() {
  cfg = { ...cfg, key: "", model: "", modelName: "" };
  save();
  return publicConfig();
}

// The conversation from the browser: plain text turns, user first, alternating, the last N only.
function cleanMessages(list) {
  if (!Array.isArray(list)) throw bad("Send the conversation as a list.");
  let out = list
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  out = out.slice(-MAX_TURNS);
  while (out.length && out[0].role !== "user") out.shift();
  const merged = [];
  for (const m of out) {
    const prev = merged.at(-1);
    if (prev && prev.role === m.role) prev.content += `\n\n${m.content}`;
    else merged.push({ ...m });
  }
  if (!merged.length || merged.at(-1).role !== "user") throw bad("Ask a question first.");
  return merged;
}

// One answer at a time (one person uses this terminal); Stop or a closed tab ends it upstream too.
let busy = false;
export async function chat(input, res, fetchImpl = fetch) {
  const p = providerOf(cfg.provider);
  if (!cfg.key) throw bad("Add an API key in Settings, AskCharts AI first.");
  if (!cfg.model) throw bad("Pick a model in Settings, AskCharts AI first.");
  const messages = cleanMessages(input?.messages);
  if (busy) throw bad("AskCharts AI is still answering. Wait for it, or press Stop.", 429);
  busy = true;
  const ac = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) ac.abort();
  });
  try {
    let r;
    try {
      r = await fetchImpl(`${p.base}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": cfg.key, "anthropic-version": API_VERSION, "content-type": "application/json" },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: MAX_TOKENS,
          system: systemBlocks(cfg.context !== false ? input?.context : null),
          messages,
          stream: true,
        }),
        signal: ac.signal,
      });
    } catch (e) {
      if (ac.signal.aborted) return;
      throw bad(`Couldn't reach Anthropic: ${e.message}`, 502);
    }
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw bad(apiError(r.status, body, cfg.key), r.status === 429 ? 429 : 502);
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    send({ t: "start", model: cfg.modelName || cfg.model });
    let stop = null,
      usage = {};
    try {
      await readEvents(r.body, (type, data) => {
        if (type === "content_block_delta" && data.delta?.type === "text_delta") send({ t: "text", v: data.delta.text });
        else if (type === "message_start") usage = { ...usage, ...(data.message?.usage || {}) };
        else if (type === "message_delta") {
          stop = data.delta?.stop_reason || stop;
          usage = { ...usage, ...(data.usage || {}) };
        } else if (type === "error") send({ t: "error", message: apiError(0, data, cfg.key) });
      });
    } catch (e) {
      if (!ac.signal.aborted) send({ t: "error", message: `The answer broke off: ${e.message}` });
    }
    if (!res.writableEnded) {
      send({ t: "done", stop, usage: { input: usage.input_tokens || 0, output: usage.output_tokens || 0, cached: usage.cache_read_input_tokens || 0 } });
      res.end();
    }
  } finally {
    busy = false;
  }
}

// Server-sent events from the provider: "event: x" and "data: {...}" lines, a blank line between.
export async function readEvents(stream, on) {
  const dec = new TextDecoder();
  let buf = "";
  const flush = (block) => {
    let type = "",
      data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let obj;
    try {
      obj = JSON.parse(data);
    } catch {
      return;
    }
    on(type || obj.type, obj);
  };
  for await (const chunk of stream) {
    buf += dec.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      flush(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
  }
  if (buf.trim()) flush(buf);
}
