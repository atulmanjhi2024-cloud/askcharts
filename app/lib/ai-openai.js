// AskCharts AI on OpenAI and xAI (Grok). The conversation comes in Anthropic's form, already cleaned and
// paired by lib/agent.js (toAnthropic) or lib/copilot.js, and goes out in the provider's own: OpenAI's
// Responses API (its newer models won't use tools while they think over chat completions), and chat
// completions for xAI. The answer streams back as the same events the page reads from Anthropic: text,
// the tools the model wants run, then done.

// Reasoning models (gpt-5, the o-series, Grok's) count their thinking in this limit, and with a small one
// they can spend it all before writing a word.
export const MAX_TOKENS = 16000;
export const THOUGHT_OUT = "The model used its whole allowance thinking and wrote nothing. Try again, or pick a faster model in Settings, AskCharts AI.";
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const NO_PICTURES = "\n(A picture of the chart was taken, but this model doesn't take pictures.)";

const responses = (c) => c.provider.id === "openai";

// The guide and the chart snapshot, one system text
export const systemText = (blocks) => blocks.map((b) => b.text).join("\n\n");

// The tool catalog as functions: flat for Responses (not strict: the inputs have optional fields), nested
// for chat completions
export const toolsFor = (specs, c) =>
  specs.map(({ name, description, input_schema }) =>
    responses(c) ? { type: "function", name, description, parameters: input_schema, strict: false } : { type: "function", function: { name, description, parameters: input_schema } },
  );

// A turn's typed text, its tool calls, its tool results
const parts = (m) => {
  const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content || [];
  return {
    typed: blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n\n"),
    calls: blocks.filter((b) => b.type === "tool_use"),
    results: blocks.filter((b) => b.type === "tool_result"),
  };
};
// A result's words, and its chart pictures (if any)
const result = (b) => {
  if (!Array.isArray(b.content)) return { text: typeof b.content === "string" ? b.content : "", pics: [] };
  return {
    text: b.content
      .filter((x) => x.type === "text")
      .map((x) => x.text)
      .join("\n"),
    pics: b.content.filter((x) => x.type === "image"),
  };
};
const dataUrl = (im) => `data:${im.source.media_type};base64,${im.source.data}`;

// Chat completions (xAI): a tool's result is a "tool" message straight after the call (every one of them
// before anything else); a chart picture can't go in one, so it follows in a user message, with what was
// typed. Plain chat turns (content a string) pass through.
export function fromAnthropic(messages, { images = true } = {}) {
  const out = [];
  for (const m of messages) {
    const { typed, calls, results } = parts(m);
    if (m.role === "assistant") {
      const tc = calls.map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
      out.push({ role: "assistant", content: typed || null, ...(tc.length ? { tool_calls: tc } : {}) });
      continue;
    }
    const pics = [];
    for (const b of results) {
      let { text, pics: p } = result(b);
      for (const im of p) {
        if (images) {
          pics.push(im);
          text += "\n(The picture follows, in the next message.)";
        } else text += NO_PICTURES;
      }
      out.push({ role: "tool", tool_call_id: b.tool_use_id, content: `${b.is_error ? "Error: " : ""}${text || "Done."}` });
    }
    if (pics.length)
      out.push({
        role: "user",
        content: [
          { type: "text", text: pics.length > 1 ? "The chart pictures the tools took." : "The chart picture the tool took." },
          ...pics.map((im) => ({ type: "image_url", image_url: { url: dataUrl(im) } })),
          ...(typed ? [{ type: "text", text: typed }] : []),
        ],
      });
    else if (typed) out.push({ role: "user", content: typed });
  }
  return out;
}

// The Responses API (OpenAI): the model's text, then each call as a function_call item (no item id: with
// nothing stored at OpenAI there's no earlier item for it to point to), each result as a
// function_call_output with the chart picture inside it, then what was typed.
export function toResponses(messages, { images = true } = {}) {
  const out = [];
  for (const m of messages) {
    const { typed, calls, results } = parts(m);
    if (m.role === "assistant") {
      if (typed) out.push({ role: "assistant", content: typed });
      for (const b of calls) out.push({ type: "function_call", call_id: b.id, name: b.name, arguments: JSON.stringify(b.input || {}) });
      continue;
    }
    for (const b of results) {
      const { text, pics } = result(b);
      const words = `${b.is_error ? "Error: " : ""}${text || (pics.length ? "A picture of the chart." : "Done.")}`;
      const output =
        pics.length && images
          ? [{ type: "input_text", text: words }, ...pics.map((im) => ({ type: "input_image", image_url: dataUrl(im), detail: "auto" }))]
          : `${words}${pics.length ? NO_PICTURES : ""}`;
      out.push({ type: "function_call_output", call_id: b.tool_use_id, output });
    }
    if (typed) out.push({ role: "user", content: typed });
  }
  return out;
}

// One request. OpenAI: nothing stored on its side, and usage comes at the end anyway. xAI documents
// max_tokens, and nothing more is sent.
export function request(c, { system, messages, tools, images = true }) {
  const headers = { authorization: `Bearer ${c.key}`, "content-type": "application/json" };
  if (responses(c)) {
    const body = { model: c.model, instructions: systemText(system), input: toResponses(messages, { images }), stream: true, store: false, max_output_tokens: MAX_TOKENS };
    if (tools) body.tools = toolsFor(tools, c);
    return { url: `${c.base}/v1/responses`, headers, body };
  }
  const body = { model: c.model, messages: [{ role: "system", content: systemText(system) }, ...fromAnthropic(messages, { images })], stream: true, max_tokens: MAX_TOKENS };
  if (tools) body.tools = toolsFor(tools, c);
  return { url: `${c.base}/v1/chat/completions`, headers, body };
}

// The calls, handed over at the end with their arguments read. The page sends the id back with the result:
// one it can't carry gets a plain one of ours.
function hand(calls, call) {
  for (const [i, c] of [...calls].sort((a, b) => a[0] - b[0])) {
    let input = {};
    try {
      input = c.args.trim() ? JSON.parse(c.args) : {};
    } catch {
      input = { _unreadable: true };
    }
    call({ id: ID.test(c.id) ? c.id : `call_${i}_${Date.now().toString(36)}`, name: c.name, input });
  }
}

// The answer as it streams, from either API: text as it's written, the tool calls put together and handed
// over at the end. Returns the stop reason and usage as the page counts them (input without the cached
// part, which is counted on its own).
export async function read(c, stream, readEvents, { text, call, error }) {
  const calls = new Map();
  let stop = null,
    usage = null,
    wrote = false;
  const say = (v) => {
    if (typeof v === "string" && v) {
      wrote = true;
      text(v);
    }
  };
  if (responses(c)) {
    let ended = null;
    await readEvents(stream, (type, d) => {
      const t = d?.type || type;
      if (t === "response.output_text.delta") say(d.delta);
      else if ((t === "response.output_item.added" || t === "response.output_item.done") && d.item?.type === "function_call") {
        const was = calls.get(d.output_index) || { id: "", name: "", args: "" };
        // the finished item's arguments are the whole of them
        const args = t === "response.output_item.done" && typeof d.item.arguments === "string" ? d.item.arguments : was.args || d.item.arguments || "";
        calls.set(d.output_index, { id: d.item.call_id || was.id, name: d.item.name || was.name, args });
      } else if (t === "response.function_call_arguments.delta") {
        const was = calls.get(d.output_index);
        if (was) was.args += d.delta || "";
      } else if (t === "response.completed" || t === "response.incomplete") {
        usage = d.response?.usage || null;
        ended = t === "response.incomplete" ? d.response?.incomplete_details?.reason || "incomplete" : "done";
      } else if (t === "response.failed") error({ error: { message: d.response?.error?.message || "The answer failed." } });
      else if (t === "error") error({ error: { message: d.message || d.error?.message || "The answer failed.", type: d.code } });
    });
    hand(calls, call);
    stop = calls.size ? "tool_use" : ended === "max_output_tokens" ? "max_tokens" : ended && ended !== "done" ? ended : "end_turn";
    const cached = usage?.input_tokens_details?.cached_tokens || 0;
    return { stop, usage: { input: Math.max(0, (usage?.input_tokens || 0) - cached), output: usage?.output_tokens || 0, cached }, empty: !wrote && !calls.size };
  }
  await readEvents(stream, (_type, d) => {
    if (d?.error) return error(d);
    for (const ch of d?.choices || []) {
      say(ch.delta?.content);
      // the id and name may come once or on every piece, the arguments in pieces, calls told apart by index
      for (const [pos, tc] of (ch.delta?.tool_calls || []).entries()) {
        const i = Number.isInteger(tc.index) ? tc.index : pos;
        const was = calls.get(i) || { id: "", name: "", args: "" };
        if (tc.id) was.id = tc.id;
        if (tc.function?.name) was.name = tc.function.name;
        if (tc.function?.arguments) was.args += tc.function.arguments;
        calls.set(i, was);
      }
      if (ch.finish_reason) stop = ch.finish_reason;
    }
    if (d?.usage) usage = d.usage;
  });
  hand(calls, call);
  const cached = usage?.prompt_tokens_details?.cached_tokens || 0;
  return {
    stop: { stop: "end_turn", tool_calls: "tool_use", length: "max_tokens" }[stop] || stop,
    usage: { input: Math.max(0, (usage?.prompt_tokens || 0) - cached), output: usage?.completion_tokens || 0, cached },
    empty: !wrote && !calls.size,
  };
}

// OpenAI lists every model it has: the chat ones that can use tools only (no speech, pictures, embeddings,
// ChatGPT's own, coding or research agents), newest first.
const CHAT = /^(gpt-|o\d)/i,
  NOT_CHAT = /(audio|realtime|tts|transcribe|search|image|instruct|embedding|moderation|dall-e|whisper|codex|computer-use|-pro\b|deep-research|gpt-3\.5|o1-mini|o1-preview)/i;
export const openaiModels = (body) =>
  (body.data || [])
    .filter((m) => m && m.id && CHAT.test(m.id) && !NOT_CHAT.test(m.id))
    .sort((a, b) => (b.created || 0) - (a.created || 0))
    .map((m) => ({ id: m.id, name: m.id, created: m.created || 0 }));
// xAI's language models, with whether each takes pictures
export const xaiModels = (body) =>
  (body.models || body.data || [])
    .filter((m) => m && m.id && (!Array.isArray(m.output_modalities) || m.output_modalities.includes("text")))
    .sort((a, b) => (b.created || 0) - (a.created || 0))
    .map((m) => ({ id: m.id, name: m.id, created: m.created || 0, images: Array.isArray(m.input_modalities) ? m.input_modalities.includes("image") : true }));
