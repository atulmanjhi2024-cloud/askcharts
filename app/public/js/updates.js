// Settings, Updates: this version, the newest release with its notes, Check now and Update now, and a dot on
// the Settings gear when there's a newer one. AskCharts' runner does the work (update.mjs beside it): a
// release's signature and every file are checked before anything stops, and the installer keeps the old
// version until the new one answers. On a server (Docker) the page shows the commands instead.
import { api, esc } from "./api.js";

const DOCKER = "git pull && docker compose up -d --build";
// a command to copy, with its button
const cmd = (text) => `<div class="md-add"><input class="cs-num ai-in" readonly value="${esc(text)}"><button class="btn" data-up="copy" data-text="${esc(text)}">Copy</button></div>`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const state = (tone, text) => `<div class="md-state ${tone}"><i></i><span>${esc(text)}</span></div>`;
// the release notes: the changelog's lines, as a list
const notes = (text) =>
  `<ul class="up-notes">${text
    .split(/\n(?=- )/)
    .map((l) => l.replace(/^- /, "").replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .map((l) => `<li>${esc(l)}</li>`)
    .join("")}</ul>`;

export function updatesPage() {
  const st = { s: null, err: "", waiting: 0, flash: "", slow: false };
  const page = {
    async load() {
      try {
        st.s = await api.get("/api/updates");
        st.err = "";
      } catch (e) {
        st.err = e.message;
      }
      return st.s;
    },
    html() {
      const h = ['<div class="cs-sec">UPDATES</div><div class="md-keys">'];
      const s = st.s;
      if (!s) return `${h[0]}<div class="cs-l span">${st.err ? `Updates aren't available here: ${esc(st.err)}` : "Loading…"}</div></div>`;
      h.push(`<p class="ai-lead">This is AskCharts ${esc(s.version)}.</p>`);
      // how the last update went, for a week (the installer writes it)
      const r = s.result;
      if (r?.at && Date.now() - Date.parse(r.at) < 7 * 86400e3)
        h.push(r.ok ? state("ok", `Updated from ${r.from || "an earlier version"} to ${r.to} on ${day(r.at)}.`) : state("err", `The update to ${r.to || "the new version"} didn't work: ${r.reason}. AskCharts is still on ${s.version}.`));
      const busy = s.state !== "idle" || st.waiting;
      if (s.state === "downloading") h.push(state("busy", "Downloading the update and checking its signature and every file…"));
      else if (s.state === "installing" || st.waiting)
        h.push(state("busy", st.slow ? "This is taking longer than it should. Reload the page in a minute; if AskCharts doesn't come back, start it again." : `Installing ${s.target || s.latest?.version || "the update"}. AskCharts restarts, and this page comes back by itself.`));
      else if (s.state === "checking") h.push(state("busy", "Checking…"));
      else if (s.error) h.push(state("err", `That didn't work: ${s.error}`));
      else if (s.latest) h.push(s.newer ? state("warn", `AskCharts ${s.latest.version} is out (${s.latest.date}).`) : state("ok", `This is the latest version (checked ${day(s.checkedAt)}).`));
      else h.push(state("warn", "Not checked yet."));
      if (s.newer && s.latest?.notes) h.push(notes(s.latest.notes));
      const check = `<button class="btn" data-up="check" ${busy ? "disabled" : ""}>Check now</button>`;
      if (s.kind === "desktop" && s.updatable) {
        h.push(`<div class="md-acts">${check}${s.newer ? `<button class="btn" data-up="install" ${busy ? "disabled" : ""}>Update to ${esc(s.latest.version)}</button>` : ""}</div>`);
        h.push("<div class=\"ai-sub md-tight\">Before anything stops, the update's signature and every file are checked. Your charts, settings and keys stay. If the new version doesn't start, the old one comes back by itself.</div>");
      } else if (s.kind === "desktop") {
        // Windows, until Update now has been tried there
        h.push(`<div class="md-acts">${check}</div><div class="ai-sub md-tight">On Windows, Update now comes once it has been tested there. To update, paste the install line from the README into PowerShell again; your charts and settings stay.</div>`);
      } else if (s.kind === "docker") {
        // a server can't rebuild its own container: the steps, with the folder it was started from when known
        h.push(`<div class="md-acts">${check}</div><p class="ai-lead">To update this server:</p><ol class="up-steps">`);
        h.push("<li>Sign in to the server AskCharts runs on (usually with <code>ssh</code>), the way you set it up.</li>");
        h.push(`<li>Go to the AskCharts folder, the one <code>git clone</code> made${s.folder ? "" : " (<code>~/askcharts</code> if you followed the server guide from your home folder)"}:${cmd(`cd ${s.folder || "~/askcharts"}`)}<span class="ai-sub">Not sure where it is? <code>docker compose ls</code> shows it, under CONFIG FILES.</span></li>`);
        h.push(`<li>Update it and start it again:${cmd(DOCKER)}<span class="ai-sub">It takes a minute or two. Your charts, settings, keys and passkeys stay: they're in the <code>askcharts-data</code> volume, not in that folder.</span></li>`);
        h.push("<li>Reload this page. It says the new version.</li></ol>");
      } else {
        h.push(`<div class="md-acts">${check}</div><div class="ai-sub md-tight">This AskCharts can't update itself here. To update, paste the install line from the README again (into PowerShell on Windows); your charts and settings stay.</div>`);
      }
      h.push(`<label class="cs-chk"><input type="checkbox" data-up="auto" ${s.autoCheck ? "checked" : ""}><span class="cs-box"></span><span>Check for updates once a day</span></label>`);
      h.push("<div class=\"ai-sub md-tight\">The check downloads the newest release's version and notes from GitHub, which sees the request, as with any download. Nothing about you or your charts is sent.</div>");
      if (st.flash) h.push(`<div class="ai-status ok">${esc(st.flash)}</div>`);
      return `${h.join("")}</div>`;
    },
    bind(el, redraw) {
      const act = async (body) => {
        try {
          st.s = await api.post("/api/updates", body);
          st.err = "";
        } catch (e) {
          st.s = { ...st.s, error: e.message };
        }
        redraw();
      };
      for (const b of el.querySelectorAll("[data-up]")) {
        const k = b.dataset.up;
        if (k === "check") b.onclick = () => act({ action: "check" }).then(() => settle(redraw));
        if (k === "install")
          b.onclick = () => {
            if (!confirm(`Update to AskCharts ${st.s.latest.version}?\n\nAskCharts restarts. Your charts, settings and keys stay.`)) return;
            st.waiting = Date.now();
            st.slow = false;
            // the result on file now: a different one is this update's
            st.before = JSON.stringify(st.s?.result ?? null);
            act({ action: "install" }).then(() => back(redraw));
          };
        if (k === "copy")
          b.onclick = async () => {
            await navigator.clipboard?.writeText(b.dataset.text).catch(() => {});
            st.flash = `Copied: ${b.dataset.text}`;
            redraw();
          };
        if (k === "auto") b.onchange = (e) => act({ action: "autoCheck", on: e.target.checked });
      }
    },
  };
  // a check: a few looks until the runner is done
  async function settle(redraw) {
    for (let i = 0; i < 30 && st.s?.state !== "idle"; i++) {
      await sleep(1000);
      await page.load();
      redraw();
    }
  }
  // an update: AskCharts stops, swaps and starts again; when it answers with the installer's result (or the
  // runner says the download failed and nothing stopped), the page loads again on whatever is running now
  async function back(redraw) {
    for (let i = 0; i < 120; i++) {
      await sleep(2000);
      const s = await api.get("/api/updates").catch(() => null);
      // the installer's result from this update: any other than the one on file before the click
      if (s?.result && JSON.stringify(s.result) !== st.before) return location.reload();
      if (s?.state === "idle" && s.error) {
        st.waiting = 0;
        st.s = s;
        return redraw();
      }
      if (i === 60) {
        st.slow = true;
        redraw();
      }
    }
  }
  return page;
}

// The dot on the Settings gear: a newer version is out (looked up when the page opens, then hourly)
export function watchUpdates(button) {
  const look = async () => {
    const s = await api.get("/api/updates").catch(() => null);
    button?.classList.toggle("has-update", !!s?.newer);
  };
  look();
  setInterval(look, 3600e3);
}
