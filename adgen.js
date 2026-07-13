// ../../packages/protocol/dist/version.js
var PROVIDER_GLOBAL = "claude";

// ../../packages/sdk/dist/index.js
var Relay = class {
  provider;
  constructor(provider) {
    this.provider = provider;
  }
  get version() {
    return this.provider.version;
  }
  capabilities() {
    return this.provider.request({ method: "claude_capabilities" });
  }
  connect(scope) {
    return this.provider.request({ method: "claude_connect", params: scope });
  }
  /** Drop this app's connection for the current page session. The grant persists (a later connect()
   *  won't reprompt) — this is "disconnect from this tab", not "revoke". Full revoke lives in the panel. */
  disconnect() {
    return this.provider.request({ method: "claude_disconnect" });
  }
  permissions() {
    return this.provider.request({ method: "claude_permissions" });
  }
  /** The paired user's public identity (name/avatar), or null if unavailable. Convenience over
   *  capabilities().user — what the connect chip greets with ("Hi Sameep"). */
  identity() {
    return this.capabilities().then((c) => c.user ?? null).catch(() => null);
  }
  /** Synthesize speech ON-DEVICE via a local model/engine (no cloud, no connector, no credits).
   *  Returns audio as a playable data: URL, or null if no local TTS is available.
   *
   *    const clip = await relay.speak("hey, it's Maya");
   *    if (clip) new Audio(clip.audio).play();
   */
  speak(text, opts) {
    return this.provider.request({ method: "claude_speak", params: { text, voice: opts?.voice } }).catch(() => null);
  }
  listTools() {
    return this.provider.request({ method: "claude_listTools" }).then((r) => r.tools);
  }
  callTool(name, args) {
    const call = { name, arguments: args };
    return this.provider.request({ method: "claude_callTool", params: call });
  }
  complete(params) {
    return this.provider.request({ method: "claude_complete", params });
  }
  /** Streamed completion as an async iterator of deltas. Ends after a `done`/`error` delta. */
  async *stream(params) {
    const { streamId } = await this.provider.request({ method: "claude_stream", params });
    const queue = [];
    let notify = null;
    let ended = false;
    const handler = (payload) => {
      const p = payload;
      if (p.streamId !== streamId)
        return;
      queue.push(p);
      if (p.type === "done" || p.type === "error")
        ended = true;
      notify?.();
    };
    this.provider.on("delta", handler);
    try {
      while (true) {
        if (queue.length === 0) {
          if (ended)
            break;
          await new Promise((r) => notify = r);
          notify = null;
          continue;
        }
        yield queue.shift();
      }
    } finally {
      this.provider.removeListener("delta", handler);
    }
  }
  on(event2, handler) {
    this.provider.on(event2, handler);
  }
  /**
   * Per-origin local storage — a private on-disk key/value store for this app, plus `bind` to point
   * it at a real folder the user picks. Values are opaque strings (store JSON). Isolated per origin;
   * reads are free, writes need the site not to be read-only, and `bind` prompts for the exact path.
   *
   *   await relay.storage.set("workspace", JSON.stringify(data));
   *   const raw = await relay.storage.get("workspace");
   *   await relay.storage.bind("~/Documents/Projects/brandbrain/.data"); // existing files appear as records
   */
  get storage() {
    const req = (params) => this.provider.request({ method: "claude_storage", params });
    return {
      get: (key) => req({ op: "get", key }).then((r) => r.value ?? null),
      set: (key, value) => req({ op: "set", key, value }).then(() => void 0),
      delete: (key) => req({ op: "delete", key }).then((r) => r.ok),
      list: () => req({ op: "list" }).then((r) => r.keys ?? []),
      info: () => req({ op: "info" }).then((r) => r.info),
      /** Point this app's store at a real folder (triggers a path-consent click). */
      bind: (path) => req({ op: "bind", path }).then((r) => r.info)
    };
  }
  /**
   * Shared, cross-app context — your portable brand knowledge. Publish a whole context; read the one
   * the user selected for this app; or open the picker. Selection happens in the side panel, so an
   * app only ever receives the context the user chose to lend it — never the whole library.
   *
   *   await relay.context.publish({ name: "Aamras", kind: "brand", data: brand });
   *   const active = await relay.context.active();   // the brand the user loaded for this app, or null
   */
  get context() {
    const req = (params) => this.provider.request({ method: "claude_context", params });
    return {
      publish: (context) => req({ op: "publish", context }).then((r) => r.id),
      list: () => req({ op: "list" }).then((r) => r.contexts ?? []),
      active: () => req({ op: "active" }).then((r) => r.context ?? null),
      pick: () => req({ op: "pick" }).then((r) => r.context ?? null),
      /** Read ONE context listed via `list()` in full, and make it this app's selection. Needs the
       *  kind granted at connect (ScopeRequest.contextKinds) — powers in-app brand dropdowns. */
      use: (id) => req({ op: "use", id }).then((r) => r.context ?? null)
    };
  }
};
var DEFAULT_INSTALL_URL = "https://thelastprompt.ai/switchboard/";
function getRelay(opts) {
  const provider = globalThis[PROVIDER_GLOBAL];
  if (provider?.isRelay)
    return new Relay(provider);
  return { installed: false, installUrl: opts?.installUrl ?? DEFAULT_INSTALL_URL };
}
function whenRelayReady(timeoutMs = 3e3, opts) {
  const now = getRelay(opts);
  if (now instanceof Relay)
    return Promise.resolve(now);
  return new Promise((resolve) => {
    const onInit = () => {
      cleanup();
      resolve(getRelay(opts));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve({ installed: false, installUrl: opts?.installUrl ?? DEFAULT_INSTALL_URL });
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener(`${PROVIDER_GLOBAL}#initialized`, onInit);
    }
    window.addEventListener(`${PROVIDER_GLOBAL}#initialized`, onInit);
  });
}

// src/adgen.js
var $ = (id) => document.getElementById(id);
var relay = null;
function event(text) {
  const d = document.createElement("div");
  d.className = "event";
  d.textContent = text;
  $("events").append(d);
}
function onConnected(r, models) {
  relay = r;
  $("go").disabled = false;
  $("connect").disabled = true;
  $("status").textContent = `\u2014 connected \xB7 ${models?.join(", ") || "default model"}`;
}
function showInstallLink(installUrl) {
  $("status").textContent = "\u2014 sidekick not installed \xB7 ";
  const a = document.createElement("a");
  a.href = installUrl;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.textContent = "Get Switchboard \u2192";
  $("status").append(a);
}
$("connect").addEventListener("click", async () => {
  const r = await whenRelayReady();
  if (!("connect" in r)) {
    showInstallLink(r.installUrl);
    return;
  }
  try {
    const grant = await r.connect({
      reason: "generate ads from a website's brand",
      tools: ["WebFetch", "mcp__claude_ai_Higgsfield__*"]
    });
    onConnected(r, grant.models);
  } catch (err) {
    $("status").textContent = `\u2014 connect rejected (${err?.code ?? "?"})`;
  }
});
(async () => {
  const r = await whenRelayReady(2e3);
  if (!("connect" in r)) {
    showInstallLink(r.installUrl);
    return;
  }
  const grant = await r.permissions().catch(() => null);
  if (grant) onConnected(r, grant.models);
})();
$("go").addEventListener("click", async () => {
  if (!relay) return;
  const url = $("url").value.trim();
  if (!url) return;
  $("events").textContent = "";
  $("brand").textContent = "";
  $("ads").textContent = "";
  const prompt = [
    `You are an ad creative director. Target website: ${url}`,
    `1) Use WebFetch to read that page.`,
    `2) In 3-4 lines, summarize the brand: name, what it sells, tone, and 2-3 signature colors.`,
    `3) Then generate exactly 3 ads by calling the generate_image tool 3 times, each with a vivid,`,
    `   on-brand prompt (mention the brand's colors/tone) and aspect_ratio "1:1".`,
    `Keep prose short; the images are the deliverable.`
  ].join("\n");
  try {
    for await (const d of relay.stream({ prompt, agentic: true })) {
      if (d.type === "tool_proposed") {
        if (d.call.name === "WebFetch") event(`\u{1F310} reading the site\u2026 (auto-approved read)`);
        else if (d.call.name.endsWith("generate_image")) event(`\u{1F3A8} generating an ad\u2026 (awaiting your consent)`);
      } else if (d.type === "tool_result") {
        if (d.call.name.endsWith("generate_image")) renderAd(d.result);
        else if (!d.result.ok) event(`\u26D4 ${d.call.name} blocked: ${d.result.error?.message}`);
      } else if (d.type === "text") {
        $("brand").textContent += d.text;
      } else if (d.type === "error") {
        event(`[error: ${d.error.message}]`);
      }
    }
  } catch (err) {
    event(`[stream failed: ${err?.code ?? "?"}]`);
  }
});
function renderAd(result) {
  if (!result.ok) {
    event(`\u26D4 generation blocked: ${result.error?.message}`);
    return;
  }
  const text = (result.content ?? []).map((c) => c.text ?? "").join("");
  let data = {};
  try {
    data = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
  } catch {
  }
  if (!data.url) return;
  const card = document.createElement("div");
  card.className = "ad";
  const img = document.createElement("img");
  img.src = data.url;
  img.alt = data.prompt ?? "generated ad";
  const cap = document.createElement("div");
  cap.className = "cap";
  cap.textContent = data.prompt ? data.prompt.slice(0, 120) : "";
  card.append(img, cap);
  $("ads").append(card);
}
//# sourceMappingURL=adgen.js.map
