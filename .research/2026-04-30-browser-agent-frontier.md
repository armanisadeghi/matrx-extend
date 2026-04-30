# Frontier Capabilities Research — 2026-04-30

> Researched against the current `wxt.config.ts` of `matrx-extend` (commit `7a29e34`), Chrome 147 stable / 148 beta, WXT 0.20.25, React 19.2, Tailwind 4.2, MCP roadmap 2026, and the public surfaces of Operator/Atlas, Claude for Chrome, Browser Use 0.x, Stagehand v3, Skyvern 2.0, and Manus.

## TL;DR — the seven highest-impact additions

1. **Add `debugger` permission and build a CDP client.** Three quarters of the things competitors do and matrx-extend cannot — full network body capture, accessibility-tree dumps, fault-tolerant click-via-coordinates, full-page screenshots without scroll-stitching, JS-heap snapshots — collapse into a single `chrome.debugger.attach` call. This is the single biggest leverage point in the entire research.
2. **Adopt WebMCP (`navigator.modelContext.registerTool`) early.** Chrome 146 shipped it in February 2026; nobody outside Google's demos is shipping production tools against it yet. matrx-extend can both *call* registered tools the page exposes *and* register its own tools to expose to other agents — making it the universal client.
3. **Wire `chrome.ai` Prompt API (Gemini Nano on-device) into the agent loop.** Local triage classifier, screenshot OCR fallback, summarization on giant DOMs, and a guard-rail layer for prompt-injection detection — all free, offline, and no backend round-trip. Already stable in Chrome 138+.
4. **Ship a self-healing selector layer with deterministic replay.** Skyvern 2.0 is the only competitor doing AI-fallback + Playwright codegen replay; matrx-extend can do the same with `chrome.scripting` MAIN-world scripts, store generated selectors in `@wxt-dev/storage` with version migrations, and replay at zero cost when the DOM is stable.
5. **Cross-tab parallel orchestration.** Claude Code does it for code agents but no browser extension does it for tabs — let the user say "compare these 5 tabs," fan out, materialize results in the side panel.
6. **Privileged tier for `cookies` + `pageCapture` + `history` + `bookmarks` + `userScripts`** — these unlock workflows competitors fundamentally cannot execute (Operator/Atlas run in throwaway sandboxes without the user's session).
7. **Verifiable run receipts (cryptographic attestation).** A signed log of every tool call + screenshot hash + timestamp, stored locally and exportable. Nobody ships this. It is the killer feature for compliance / regulated workflows where the auditor needs to know exactly what the agent did.

---

## 1. Chrome MV3 frontier APIs

### 1.1 `chrome.debugger` — the master key

**Summary.** Attaches the Chrome DevTools Protocol to a tab. Every domain DevTools itself uses (Network, Page, Runtime, Accessibility, DOMSnapshot, Emulation, Performance, Profiler, Tracing, Input, Fetch, Overlay, Storage, WebAuthn, WebAudio…) is reachable. While attached, Chrome shows a "is debugging this browser" banner — that is the only friction.

**Browser support.** Chrome stable since 2014 (rev. CDP 1.3); Edge identical. Firefox has a partial equivalent. Safari does not.

**Manifest permission.** `"debugger"` (warning string: "Read and change all data on the websites you visit").

**Tool ideas.**
- `agent.network.subscribe({ tabId, urlPattern })` — calls `Network.enable` then streams `Network.responseReceived` + `Network.getResponseBody` to the agent. Gives every fetch URL, status code, and body the page loads. Devastating for SPAs that hide data behind XHR.
- `agent.dom.snapshot({ tabId, includePaintOrder })` — `DOMSnapshot.captureSnapshot` returns the entire DOM + computed styles + layout boxes in one binary blob, deduplicated against a string table. ~10x faster than serializing `document.documentElement.outerHTML`.
- `agent.a11y.tree({ tabId, depth })` — `Accessibility.getFullAXTree`. Cleaner than DOM for vision-free agents. Each node has `role`, `name`, `value`, `description`, `properties`. Use this *instead of* DOM for agent reasoning when accessible-name coverage is good.
- `agent.input.click({ tabId, x, y })` — `Input.dispatchMouseEvent`. Bypasses every event-handler shadow that `element.click()` runs into. The only reliable way to click into shadow DOMs and OOPIFs.
- `agent.input.type({ tabId, text })` — `Input.insertText` + `Input.dispatchKeyEvent`. Fires `beforeinput`/`input`/`compositionend` correctly so React controlled inputs accept the value.
- `agent.page.screenshot({ tabId, fullPage, format })` — `Page.captureScreenshot` with `captureBeyondViewport: true` and `clip` from `Page.getLayoutMetrics`. No scroll stitching. Returns base64 webp/png in one call.
- `agent.page.printToPDF({ tabId })` — `Page.printToPDF` returns a clean PDF; no need to use `chrome.printing` (which is ChromeOS-locked).
- `agent.emulate.device({ tabId, preset })` — `Emulation.setDeviceMetricsOverride` + `Emulation.setUserAgentOverride`. Run "view this page as iPhone Safari" without leaving the user's window.
- `agent.emulate.geolocation({ tabId, lat, lng })` — `Emulation.setGeolocationOverride`. Test geo-fenced pages.
- `agent.perf.metrics({ tabId })` — `Performance.getMetrics`. Returns `{ Documents, Frames, JSHeapUsedSize, LayoutCount, RecalcStyleCount, ScriptDuration, TaskDuration, … }`. Useful when the agent's last action triggered re-layout chaos.
- `agent.network.intercept({ tabId, urlPattern, replaceWith })` — `Fetch.enable` + `Fetch.continueRequest`. Mock specific endpoints to replay deterministic data.

**Risk / tier.** **Privileged** (must be ask-user with a clear "agent is requesting debug access — Chrome will show a banner" disclosure). Once attached, it is essentially a remote-control session.

**Why competitors skip it.** The yellow "is being debugged" banner spooks users and the warning string in the install dialog is alarming. Operator/Atlas don't need it because they already control the entire browser. Claude for Chrome avoids it for the same UX reason. *That is the opening.* Make the banner experience graceful — auto-detach when idle, visible badge in the side panel, single-click "stop" — and you ship capabilities they can't.

**Sample stub.**
```ts
// src/lib/cdp/client.ts
export async function attach(tabId: number) {
  await chrome.debugger.attach({ tabId }, '1.3');
  await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
  await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
}
chrome.debugger.onEvent.addListener(async (src, method, params) => {
  if (method === 'Network.responseReceived' && src.tabId) {
    const { body, base64Encoded } = await chrome.debugger.sendCommand(
      { tabId: src.tabId },
      'Network.getResponseBody',
      { requestId: (params as any).requestId },
    );
    bus.emit('network', { url: (params as any).response.url, body, base64Encoded });
  }
});
```

Sources: [chrome.debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger), [CDP](https://chromedevtools.github.io/devtools-protocol/), [Accessibility tree blog](https://developer.chrome.com/blog/full-accessibility-tree).

### 1.2 `chrome.declarativeNetRequest` (DNR)

**Summary.** The MV3-blessed replacement for blocking webRequest. Modify request/response headers, redirect, block, and (Chrome 128+) match on response headers via dynamic rules without a service-worker fetch listener.

**Browser support.** Chrome stable; Firefox partial (no redirect for some types).

**Manifest permission.** `"declarativeNetRequest"` (or `"declarativeNetRequestWithHostAccess"` to scope to host_permissions). Use the `WithHostAccess` flavor — it does not show the "block content on all sites" warning.

**Tool ideas.**
- `agent.net.injectAuthHeader({ urlPattern, name, value })` — let the agent inject `Authorization` headers when a workflow requires it (e.g., proxying a private API).
- `agent.net.blockTracker({ pattern })` — silence ad/tracker noise during automation runs so screenshots and network logs are clean.
- `agent.net.replayMode({ urlPattern, mockUrl })` — redirect a real endpoint to a local mock for deterministic regression of saved workflows.
- `agent.net.spoofUserAgent({ urlPattern, ua })` — header-based UA override per-request without paying for full CDP attach.

**Risk / tier.** **Action**, with explicit per-rule approval — modifying headers is a CSRF / token-leak vector.

**Why competitors skip.** Most agents run in a clean cloud browser where there's nothing to block; matrx-extend runs in the user's browser where header injection unlocks "log into my work SSO using my session, then make this private API call" — Operator/Atlas literally cannot do that.

**Sample stub.**
```ts
await chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [],
  addRules: [{
    id: 4711,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'x-matrx-agent-run', operation: 'set', value: runId }],
    },
    condition: { urlFilter: 'https://server.app.matrxserver.com/*', resourceTypes: ['xmlhttprequest'] },
  }],
});
```

Sources: [chrome.declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest), [Replace blocking webRequest](https://developer.chrome.com/docs/extensions/develop/migrate/blocking-web-requests).

### 1.3 `chrome.cookies`

**Summary.** Programmatic reads and writes of HTTP cookies — including `httpOnly`, including for hosts the user is logged into.

**Browser support.** Chrome, Firefox, Edge.

**Manifest permission.** `"cookies"` plus host_permissions for the relevant origin.

**Tool ideas.**
- `agent.cookies.read({ origin })` — for "log me into this dashboard you have no API for" and bring-your-own-cookie automation.
- `agent.cookies.export({ origin, format: 'netscape' | 'puppeteer' })` — export to feed a backend headless run.
- `agent.cookies.clear({ origin })` — for fresh-session evaluation.

**Risk / tier.** **Privileged** — gates auth tokens. Always ask-user, always log to the run receipt.

**Why competitors skip.** Operator/Atlas don't have access to the user's real cookie jar. Claude for Chrome has it but doesn't expose `cookies.export` because the security review failed. matrx-extend can guard it behind an explicit prompt and ship it.

**Sample stub.**
```ts
const cookies = await chrome.cookies.getAll({ domain: 'github.com' });
const header = cookies.map(c => `${c.name}=${c.value}`).join('; ');
```

Sources: [chrome.cookies](https://developer.chrome.com/docs/extensions/reference/api/cookies).

### 1.4 `chrome.sidePanel` — per-tab and dynamic

**Summary.** Already in the manifest. Underused. Chrome 141+ added `close()`, `onOpened`, `onClosed`. Chrome 140 added `getLayout()` for left/right awareness. `setOptions({ tabId, path, enabled })` lets you serve a *different HTML entrypoint per tab*.

**Browser support.** Chrome 114+.

**Manifest permission.** `"sidePanel"` (already declared).

**Tool ideas.**
- `agent.ui.openTaskPanel({ tabId, taskId })` — switch the side panel into a task-execution view bound to that tab. Different from the home panel.
- `agent.ui.openComparePanel({ tabIds })` — open a custom path that talks to N tabs in parallel.
- `agent.ui.close()` — close on completion (Chrome 141+).
- `agent.ui.layout()` — query left/right, mirror gestures correctly for RTL users.

**Risk / tier.** Read.

**Why competitors skip.** Most extensions ship one side-panel entrypoint and treat it as a singleton. Per-tab paths let you build context-aware UIs (e.g., on Gmail show inbox tools; on Linear show ticket tools).

**Sample stub.**
```ts
chrome.tabs.onUpdated.addListener(async (tabId, _info, tab) => {
  if (tab.url?.startsWith('https://github.com/')) {
    await chrome.sidePanel.setOptions({ tabId, path: 'sidepanel-github.html', enabled: true });
  }
});
```

Sources: [chrome.sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).

### 1.5 `chrome.userScripts` — CSP-exempt user code

**Summary.** Lets the extension execute user-authored JS in a third execution world (`USER_SCRIPT`) that is exempt from the page's CSP. As of Chrome 135 ships `userScripts.execute()` for one-shot injection (formerly only `register`). Chrome 138+ migrated existing extensions onto a separate user-facing toggle in `chrome://extensions`.

**Browser support.** Chrome 120+; Firefox 102+ for `register`.

**Manifest permission.** `"userScripts"`. Requires the user to enable the toggle.

**Tool ideas.**
- `agent.macro.recordAndReplay({ steps })` — run user-recorded scripts (skill replay) without the page's strict CSP rejecting `eval`.
- `agent.scrape.runUserExtractor({ tabId, code })` — let advanced users author their own DOM extractors that ship inside their workspace and run on demand.
- `agent.skill.injectThirdParty({ url })` — run third-party "skill packs" (jQuery-style helpers, Mozilla Readability v2, etc.) without the manifest needing to bake them in.

**Risk / tier.** **Privileged** — arbitrary code execution.

**Why competitors skip.** It is a relatively new API and most extensions don't ship "user-authored code" features. matrx-extend's pitch as a *programmable* agent makes this perfect.

**Sample stub.**
```ts
await chrome.userScripts.register([{
  id: 'matrx-skill-readability',
  js: [{ code: USER_AUTHORED_SOURCE }],
  matches: ['<all_urls>'],
  world: 'USER_SCRIPT', // CSP-exempt
  runAt: 'document_idle',
}]);
```

Sources: [chrome.userScripts](https://developer.chrome.com/docs/extensions/reference/api/userScripts), [user scripts proposal](https://github.com/w3c/webextensions/blob/main/proposals/user-scripts-api.md).

### 1.6 Offscreen document — every reason matters

**Summary.** Already declared. The full reason list as of 2026: `BLOBS`, `AUDIO_PLAYBACK`, `IFRAME_SCRIPTING`, `DOM_SCRAPING`, `CLIPBOARD`, `DOM_PARSER`, `USER_MEDIA`, `DISPLAY_MEDIA`, `WORKERS`, `WEB_RTC`, `LOCAL_STORAGE`, `MATCH_MEDIA`, `BATTERY_STATUS`, `GEOLOCATION`, `TESTING`. Chrome 116+ allows the service worker to call `chrome.tabCapture.getMediaStreamId` and pass the resulting opaque id to the offscreen page that calls `getUserMedia`.

**Browser support.** Chrome 109+ (reasons added incrementally).

**Manifest permission.** `"offscreen"` (already declared).

**Tool ideas.**
- `agent.media.recordTab({ tabId, withMicrophone })` — mix tab audio + mic in offscreen, dump WebM to `chrome.downloads`. Killer feature for "transcribe my Zoom call" workflows.
- `agent.media.captureTabFrame({ tabId })` — grab a single frame as a Blob via `MediaStreamTrack.grabFrame`. Cheaper than a CDP screenshot for streaming.
- `agent.audio.tts({ text, voice })` — `SpeechSynthesisUtterance` in offscreen so it survives the SW dying mid-utterance.
- `agent.audio.continuousSTT({ langs })` — continuous `webkitSpeechRecognition` in an `AUDIO_PLAYBACK` offscreen — the user can speak commands hands-free.
- `agent.workers.spawn({ scriptUrl })` — spin a real Web Worker in offscreen for CPU-heavy tasks (DOM diffing, embedding inference) without blocking the SW.

**Risk / tier.** Action / privileged depending on reason (display_media = privileged; audio_playback = action).

**Why competitors skip.** Most extensions barely use offscreen at all. The pattern of "SW gets streamId, offscreen does the recording" is the only way to record across navigations in MV3 and very few are doing it.

**Sample stub.**
```ts
// background.ts
async function startTabRecording(tabId: number) {
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.DISPLAY_MEDIA],
    justification: 'Recording active tab for the agent run receipt.',
  });
  chrome.runtime.sendMessage({ type: 'start-recording', streamId });
}
```

Sources: [chrome.offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen), [tabCapture in MV3](https://developer.chrome.com/docs/extensions/reference/api/tabCapture).

### 1.7 `chrome.commands` — user-bound shortcuts

**Summary.** The agent should be invocable from the keyboard. Up to 4 default shortcuts; the user can rebind any number more at `chrome://extensions/shortcuts`. `_execute_action` is a magic command that opens the popup; pair with `chrome.action.openPopup()` to open without click.

**Browser support.** All MV3 browsers.

**Manifest permission.** Declared via top-level `"commands"` in manifest, no separate permission.

**Tool ideas.**
- `Ctrl+Shift+M` → "summon agent on current tab"
- `Ctrl+Shift+Space` → "voice mode"
- `Ctrl+Shift+S` → "screenshot + ask"
- `_execute_action` → open popup

**Risk / tier.** Read.

**Why competitors skip.** Many AI extensions have bad keyboard ergonomics — they live in the URL bar / icon click only. Power users want hotkeys.

**Sample stub (manifest fragment).**
```ts
commands: {
  'summon-agent': {
    suggested_key: { default: 'Ctrl+Shift+M', mac: 'Command+Shift+M' },
    description: 'Open Matrx side panel for the active tab',
  },
  'voice-mode': {
    suggested_key: { default: 'Ctrl+Shift+Space' },
    description: 'Toggle continuous listening',
  },
}
```

Sources: [chrome.commands](https://developer.chrome.com/docs/extensions/reference/api/commands).

### 1.8 `chrome.action.openPopup` (no user gesture)

**Summary.** Chrome has dropped the user-gesture requirement. Extensions can now show their popup programmatically — e.g., when an alarm fires, when an agent finishes a task, when push notification arrives.

**Browser support.** Chrome 127+; Firefox 149+ also no-gesture.

**Manifest permission.** None (uses `action`).

**Tool ideas.**
- `agent.notify.openPopup({ reason })` — for "your task finished, here is the result."
- Auto-popup at end of long-running run.

**Risk / tier.** Read.

Sources: [chrome.action.openPopup](https://developer.chrome.com/docs/extensions/reference/api/action), [Oliver Dunk: openPopup](https://oliverdunk.com/2022/11/13/extensions-open-popup).

### 1.9 `chrome.pageCapture.saveAsMHTML`

**Summary.** Saves an entire tab to a single MHTML file (HTML + all subresources). Works on JS-rendered pages because it captures the *current* DOM, not the original HTML.

**Browser support.** Chrome 116+ (MV3-compatible).

**Manifest permission.** `"pageCapture"`.

**Tool ideas.**
- `agent.archive.snapshotPage({ tabId })` — store the exact rendered page so the agent can re-analyze it offline / weeks later. Killer for legal/compliance use cases.
- `agent.evidence.bundle({ runId })` — bundle MHTML + screenshots + network log into a zip and surface as a download.

**Risk / tier.** Action.

**Why competitors skip.** It's an oddly old API that most don't know about. MHTML preserves the *exact* visual state — no scraping reconstruction.

**Sample stub.**
```ts
const blob = await chrome.pageCapture.saveAsMHTML({ tabId });
const url = URL.createObjectURL(blob);
await chrome.downloads.download({ url, filename: `run-${runId}.mhtml` });
```

Sources: [chrome.pageCapture](https://developer.chrome.com/docs/extensions/reference/api/pageCapture).

### 1.10 `chrome.idle` + `chrome.system` (cpu/memory/storage)

**Summary.** `chrome.idle` fires `active` / `idle` / `locked`. `chrome.system.cpu`, `chrome.system.memory`, `chrome.system.display`, `chrome.system.storage` give raw hardware state.

**Browser support.** Chrome.

**Manifest permission.** `"idle"`, `"system.cpu"`, `"system.memory"`, `"system.display"`, `"system.storage"`.

**Tool ideas.**
- `agent.lifecycle.runWhileAway({ taskId })` — start a long-running task only when the user has been idle for >5 minutes (saves their CPU during active hours).
- `agent.system.healthCheck()` — refuse to start a 10-tab parallel run if free memory <2GB.
- `agent.system.displays()` — for "open this preview on my second monitor" workflows.

**Risk / tier.** Read.

**Why competitors skip.** Cloud agents have no notion of "user is at the keyboard" or "this laptop is hot." Local awareness is matrx-extend's edge.

Sources: [chrome.idle](https://developer.chrome.com/docs/extensions/reference/api/idle), [SystemInfo APIs](https://www.chromium.org/developers/design-documents/extensions/proposed-changes/apis-under-development/systeminfo/).

### 1.11 `chrome.sessions` (recently closed)

**Summary.** Lists recently closed tabs/windows, lets you restore.

**Manifest permission.** `"sessions"`.

**Tool ideas.**
- `agent.history.recentlyClosed({ limit })` — "what did the user just close?" for "I lost a tab" recovery.
- `agent.recover.reopen({ sessionId })`.

**Risk / tier.** Read.

Sources: [chrome.sessions](https://developer.chrome.com/docs/extensions/reference/api/sessions).

### 1.12 `chrome.runtime.onInstalled` + first-run flows

**Summary.** Already standard but make sure to use the `details.reason === 'install'` path to open a welcome side panel that walks through approval tiers, OAuth login, and skill setup. Only ~20% of extensions do this well.

### 1.13 `chrome.proxy`

**Summary.** Set proxy settings programmatically. ChromeOS-leaning but works everywhere.

**Manifest permission.** `"proxy"`.

**Tool ideas.**
- `agent.proxy.setForRun({ host, port, scheme, runId })` — route a specific automation through a proxy (e.g., region-locked content testing).
- `agent.proxy.clear()`.

**Risk / tier.** **Privileged** — clearly disclosed.

**Why competitors skip.** This is a power user feature. Most ignore it.

Sources: [chrome.proxy](https://developer.chrome.com/docs/extensions/reference/api/proxy).

### 1.14 Built-in AI: `LanguageModel` / Prompt API + Summarizer / Writer / Rewriter / Proofreader

**Summary.** Chrome 138+ ships the Prompt API in stable for extensions. Gemini Nano on-device, ~22GB download, multimodal (image + audio in, text out), supports `responseConstraint` (JSON Schema), streaming, sessions with `clone()`, `contextUsage` tracking. No cost, no network.

**Browser support.** Chrome 138+ desktop (Win 10+, macOS 13+, Linux, ChromeOS). Edge follows. Firefox/Safari no.

**Manifest permission.** None — but enable origin trial token if you need sampling parameter customization (Chrome 148 OT).

**Tool ideas.**
- `agent.local.classify({ text, labels })` — route the user's free-text request to the right backend tool with zero round-trip.
- `agent.local.guard({ untrustedText })` — quick prompt-injection scan before passing scraped content to the cloud LLM. *This is the cheapest defense layer money can't buy because it's free.*
- `agent.local.summarize({ longText })` — summarize a 100KB page locally instead of paying Anthropic 50K input tokens.
- `agent.local.ocr({ imageBlob })` — multimodal Prompt API takes an image, returns text. No external OCR dependency.
- `agent.local.embedLocal({ text })` — for vector memory without round-trip (Gemini Nano embedding addon coming).

**Risk / tier.** Read.

**Why competitors skip.** Most pay-per-token vendors haven't internalized that the user's GPU is free compute. Use it as a *first-pass* before falling back to remote models. Cost reduction of 70%+ is plausible for routine tasks.

**Sample stub.**
```ts
// src/lib/ai/local.ts
export async function classifyIntent(text: string) {
  const session = await LanguageModel.create({
    initialPrompts: [{ role: 'system', content: 'Classify into one of: scrape, seo, chat, task, navigate, unknown. Respond with one word.' }],
  });
  return (await session.prompt(text, {
    responseConstraint: { type: 'string', enum: ['scrape', 'seo', 'chat', 'task', 'navigate', 'unknown'] },
  })).trim();
}
```

Sources: [Prompt API](https://developer.chrome.com/docs/ai/prompt-api), [Built-in AI](https://developer.chrome.com/docs/ai/built-in).

### 1.15 Manifest hygiene: `host_permissions` granularity

`<all_urls>` is in the current manifest. That triggers the "Read and change all your data" warning. For Web Store install conversion, consider:
- Move to `optional_host_permissions: ['<all_urls>']` and request grant via `chrome.permissions.request` after the user approves.
- Keep the explicit per-host permissions for the trusted Matrx domains.

This is a soft win — it doesn't add capability, but improves the install funnel materially. Operator and Claude-for-Chrome both went this route.

---

## 2. Modern web APIs invokable via `chrome.scripting` (page-context)

### 2.1 File System Access API

**Summary.** `showOpenFilePicker`, `showSaveFilePicker`, `showDirectoryPicker`. Read/write user files with persistent handles you can re-acquire (via IndexedDB) on later sessions.

**Browser support.** Chromium only (Chrome 86+, Edge). Firefox/Safari unsupported (Safari has `showOpenFilePicker` only on iPadOS 18+).

**Manifest permission.** None — but pickers must be invoked in a **user gesture** chain. From an extension: open a popup or side panel, user clicks, then call.

**Tool ideas.**
- `agent.fs.openFile({ types })` — read structured data (CSV, JSON) the user selects.
- `agent.fs.saveResult({ suggestedName, blob })` — save extraction results directly to the user's filesystem.
- `agent.fs.openWorkspace({ name })` — request a directory handle once, persist it, write multiple files into it across sessions ("save all my scrapes to ~/matrx/").

**Risk / tier.** Action — handle persistence is **privileged** (re-acquire requires `requestPermission`).

**Why competitors skip.** Operator/Atlas don't have filesystem access. matrx-extend does — and that means "save 10 product images to a folder" works without leaving the browser.

**Sample stub.** (must run in side panel / popup, not SW)
```ts
const dirHandle = await window.showDirectoryPicker({ id: 'matrx-workspace', mode: 'readwrite' });
const file = await dirHandle.getFileHandle('result.json', { create: true });
const writable = await file.createWritable();
await writable.write(JSON.stringify(payload));
await writable.close();
// Persist handle in IndexedDB; re-acquire later with handle.requestPermission({ mode: 'readwrite' }).
```

Sources: [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).

### 2.2 Web Locks

**Summary.** Coordinate work across tabs, windows, the offscreen doc, and the SW. `navigator.locks.request(name, fn)` blocks others with the same name.

**Browser support.** All major browsers.

**Tool ideas.**
- `agent.lock.exclusive(name, fn)` — only one tab runs the "extract everything from Linkedin" job at a time.
- `agent.lock.shared(name, fn)` — multiple readers, one writer (cache invalidation patterns).

**Risk / tier.** Read.

### 2.3 Speech Recognition / Speech Synthesis (Web Speech API)

**Summary.** `webkitSpeechRecognition` for STT, `SpeechSynthesisUtterance` for TTS. Continuous mode with interim results.

**Browser support.** Chrome strong; Safari ok; Firefox shaky.

**Tool ideas.**
- `agent.voice.startContinuous({ lang, onPartial, onFinal })` — voice loop. User speaks → command → agent → voice response.
- `agent.voice.speak({ text, voice, rate })`.
- Combine with `chrome.commands` so `Ctrl+Shift+Space` opens a hotmic.

**Risk / tier.** Action (mic prompt) → privileged (continuous).

**Why competitors skip.** Operator/Atlas can't hear you. Local extensions can. *Voice loop is one of the moonshots.*

### 2.4 MediaRecorder + tabCapture in offscreen

Already covered in 1.6.

### 2.5 WebGPU / WebHID / WebUSB / WebSerial / Web Bluetooth / Web MIDI

**Summary.** Hardware access from the page context. WebGPU is now stable in *all* major browsers (April 2024 milestone hit). WebHID/USB/Serial/Bluetooth are Chromium-only.

**Tool ideas.**
- `agent.device.scanBLE()` — pair "log my BLE thermometer to a Google Sheet."
- `agent.device.midiKeyboardCapture()` — niche but novel.
- `agent.gpu.runEmbedding({ tensor })` — use WebGPU + transformers.js or onnx-runtime-web for in-browser embedding inference. With WebGPU, 384-dim MiniLM runs ~10× faster than WASM. Pair with the Prompt API for a fully-local RAG layer.

**Risk / tier.** Privileged for hardware; read for WebGPU compute.

**Why competitors skip.** No cloud agent has access. This is uniquely local-extension territory.

Sources: [WebGPU stable](https://web.dev/blog/webgpu-supported-major-browsers).

### 2.6 FedCM

**Summary.** Browser-mediated federated login UI replacing cookies-and-popups OAuth. `navigator.credentials.get({ identity: { providers: [...] } })`.

**Browser support.** Chromium stable; Firefox in progress; Safari no.

**Tool ideas.**
- `agent.auth.fedcmSignIn({ providers })` — replace the long OAuth dance with one tap. matrx-extend's existing `identity` permission gives a serviceable OAuth, but FedCM is one-tap, browser-trusted, and works for "sign into this third-party tool the agent encountered."

**Risk / tier.** Action.

**Sample stub.**
```ts
const cred = await navigator.credentials.get({
  identity: { providers: [{ configURL: 'https://accounts.example.com/config.json', clientId: '...' }] },
});
```

Sources: [FedCM API](https://developer.chrome.com/docs/identity/fedcm/overview).

### 2.7 View Transitions API (cross-document)

**Summary.** Smooth navigation animations between two same-origin pages or between SPA states. Native, no JS lib needed for the animation itself.

**Browser support.** Chrome 126+, Edge 126+, Safari 18.2+; Firefox no.

**Tool ideas.** UX polish for the side panel: navigating between agent steps animates instead of flashing. Helps when the agent rapidly transitions between "thinking" → "acting" → "result".

**Risk / tier.** Read.

### 2.8 Web Animations + native Popover API

**Summary.** Tailwind 4 has anchor-positioning utilities (and the Toolwind plugin for declarative usage). Combined with the native `popover=""` HTML attribute, you can build tooltips/menus with zero JS.

**Tool ideas.** Use for the tool-call disclosure UI ("click here to see what the agent is about to do"). Anchor-positioned popovers are accessible by default and survive scroll/clip without `position: fixed` hacks.

Sources: [Anchor positioning](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Anchor_positioning).

### 2.9 Storage Buckets

**Summary.** Multiple named storage areas (each contains its own IndexedDB / Cache). Fine-grained eviction priorities.

**Browser support.** Chrome 122+; Firefox/Safari planned.

**Tool ideas.**
- Bucket per agent run: `agent.bucket.openRun(runId)` — keep run artifacts isolated, evict old runs first.
- Bucket per skill so user can wipe a single skill's cache.

### 2.10 Compute Pressure API

**Summary.** Coarse signal (`nominal` / `fair` / `serious` / `critical`) about CPU/thermal pressure.

**Browser support.** Chrome 125+ stable.

**Tool ideas.**
- Throttle local model usage if `state === 'serious'`; cancel background inferring if `'critical'`.
- Refuse to start a new fan-out parallel run.

**Sample stub.**
```ts
const observer = new PressureObserver(records => {
  for (const r of records) if (r.state === 'critical') agent.pause('thermal');
});
observer.observe('cpu');
```

Sources: [Compute Pressure API](https://developer.chrome.com/docs/web-platform/compute-pressure).

### 2.11 Wake Lock API

**Summary.** `navigator.wakeLock.request('screen')` keeps the screen on.

**Tool ideas.**
- `agent.session.wake()` during a long voice loop or a multi-step run the user is supervising.

### 2.12 Push API + notification permission

**Summary.** Web push from your backend can wake the SW even when idle. The extension's existing `notifications` permission handles surfacing.

**Tool ideas.** Long-running task on Matrx server finishes → push → SW wakes → opens popup. *Only competitor's cloud agents have a "task done" channel; matrx-extend can match it.*

### 2.13 Trusted Types

**Summary.** CSP directive forcing every `innerHTML` assignment to go through a typed policy. Serves as defense-in-depth against agent-output XSS.

**Recommendation.** Add `trusted-types` to the production CSP for the side panel and offscreen doc. The agent's HTML rendering pipeline (`react-markdown` → DOMPurify) should produce TrustedHTML.

### 2.14 Clipboard API (images + files)

**Summary.** `navigator.clipboard.read()` returns ClipboardItems with mime types — including `image/png` and (since 2024) richer types.

**Tool ideas.**
- `agent.clipboard.readImage()` — paste a screenshot from the OS clipboard into the agent context.
- `agent.clipboard.writeFiles({ blobs })` — emit results to clipboard for paste-anywhere.

### 2.15 Dynamic `import()` from extension origin

**Summary.** MV3 CSP allows `import('chrome-extension://<id>/skills/foo.js')`. So skill bundles can ship as separate chunks, lazy-loaded.

**Tool ideas.**
- `agent.skill.lazy({ name })` — keep the main bundle small; download skill code only when first invoked. Good for the 63 tool catalog.

### 2.16 Origin trials worth tracking (April 2026)

- **WebMCP** (Chrome 146+) — covered in §6 below.
- **WebGPU `f16`** stable in 147 — half-precision tensor inference.
- **`Document Picture-in-Picture`** stable — pop the agent UI out as a floating window.
- **`AudioSession` API** for foreground audio routing.

---

## 3. WXT 0.20 → 1.0 + module ecosystem

### 3.1 Versions seen as of 2026-04-30

`wxt@0.20.25` is the latest 0.20 series; v1.0 has not been cut yet but the team is calling 0.20.x the RC line. Recent releases were small (Firefox `actionKey` fixes, port-change bugs, native-Node `dotenv` replacement, theme_icons auto-discovery).

### 3.2 `@wxt-dev/storage`

The current API surface (v1.2.x):

- Prefixed keys: `local:foo`, `session:foo`, `sync:foo`, `managed:foo`.
- `defineItem<T>('local:k', { fallback, init, version, migrations })` — type-safe + migrations.
- `getItem` / `setItem` / `removeItem`, batched: `getItems` / `setItems` / `removeItems`.
- `watch(key, callback)` — change subscription.
- `getMeta` / `setMeta` / `removeMeta` for sidecar metadata (e.g., `lastSyncedAt`).

**Recommendation for matrx-extend.** Replace any direct `chrome.storage.*` usage with `defineItem` shapes per feature. Add migrations now — once you ship to thousands of users you cannot retroactively fix a v1 schema typo.

```ts
// src/lib/storage/runs.ts
export const lastRun = storage.defineItem<RunRecord>('local:lastRun', {
  fallback: null,
  version: 2,
  migrations: {
    2: (v1: RunRecordV1) => ({ ...v1, evidenceMHTML: undefined }),
  },
});
```

Sources: [WXT storage](https://wxt.dev/storage).

### 3.3 `@wxt-dev/i18n`

Type-safe wrapper around `browser.i18n.getMessage`. Supports YAML/JSON5/TOML, transpiles to `_locales/<lang>/messages.json` at build. Worth adopting before international users land — much cleaner than raw `chrome.i18n`.

Sources: [WXT i18n](https://github.com/wxt-dev/wxt/tree/main/packages/i18n).

### 3.4 `@wxt-dev/analytics`

Module exists but lightweight; does not replace a real product analytics layer. Reasonable to use it for opt-in dev-error reporting; for product metrics, ship to Matrx server with the existing TanStack Query / Supabase pipeline.

### 3.5 `browser.*` polyfill vs raw `chrome.*`

WXT exposes a vendor-correct `browser` global. Use it instead of `chrome.*` to keep the Firefox build green (which is already in `package.json` scripts). The codebase appears to use raw `chrome.*` — this is fine on Chrome but a porting tax.

### 3.6 Auto-icons + ImagePicker / GenericIcon

WXT's `auto-icons` feature accepts a single `icon.png` (or SVG) and generates the size set. The current setup hard-codes 16/32/48/128 — switching saves maintenance.

### 3.7 React 19.2 + `@wxt-dev/module-react`

Already wired. Worth knowing about now:
- **Activity** (`<Activity mode="hidden">`) — pre-render and keep components alive but not paint. Good for the side panel: keep the full agent thread mounted but in `hidden` mode when on a different tab, no re-init cost.
- **`useActionState`** — pair with the chat composer for submitting prompts (built-in pending/error states).
- **`use(promise)`** — reads promises in render, plays nicely with `Suspense`. Use for streaming the agent's tool-call list.
- **React Compiler v1.0** (October 2025 stable) — auto-memo. Add `babel-plugin-react-compiler` via `vite-plugin-babel` in `wxt.config.ts`. Drop `useMemo` / `useCallback` boilerplate. Compatible with WXT/Vite.

Sources: [React 19.2 release](https://react.dev/blog/2025/10/01/react-19-2), [React Compiler v1](https://react.dev/blog/2025/10/07/react-compiler-1).

### 3.8 Tailwind 4.2 specifics

- Container queries are first-class (`@sm:`, `@md:`). Use for the side panel which has variable width.
- Anchor positioning supported via the Toolwind plugin or hand-rolled `@utility` rules.
- Native `<dialog>` and `[popover]` work without JS — drop the Radix popover for simple cases (it stays useful where you need controlled state).

---

## 4. Vite + React 19.2 patterns specific to extensions

- **Server Components** are not workable in MV3 extensions (no Node runtime, CSP forbids remote code). Skip.
- **Suspense + use(promise)** for the streaming chat body: the message list reads a TanStack Query promise via `use()`, no manual loading state.
- **`useDeferredValue`** for the live token stream — render trailing tokens at lower priority so the input never lags.
- **React Compiler** can run the compiler in *opt-in* mode per directory; safe to enable on `src/components` first.

---

## 5. Tailwind 4.2 specifics — already covered above.

---

## 6. Agent / LLM integration techniques

### 6.1 OpenAI Operator / ChatGPT Atlas

- **Architecture (Atlas, OWL).** Vision-only loop. Screenshot → CUA (computer-using-agent model) → action (`click(x, y)`, `type`, `scroll`, `key`, `wait`, `screenshot`). Custom or built-in; environment is "browser" / "mac" / "windows" / "ubuntu".
- **Tool surface.** `computer_use_preview` type with `display_width`, `display_height`, `environment`. Plus generic function-calling tools alongside.
- **Atlas-specific.** Sidebar assistant, browser memories, agent mode. January 2026: tab groups + "Auto" mode (search-vs-LLM routing). March 2026: unified desktop superapp.
- **Gaps for matrx-extend to exploit.** Atlas runs in its own Chromium fork — no live cookies in the user's main Chrome, no extension ecosystem, no Supabase backend integration. matrx-extend's *advantage* is that it is local to the user's existing browser session.

Sources: [Computer Use docs](https://developers.openai.com/api/docs/guides/tools-computer-use), [Atlas](https://openai.com/index/introducing-chatgpt-atlas/), [OWL architecture](https://openai.com/index/building-chatgpt-atlas/).

### 6.2 Anthropic computer-use beta + Claude for Chrome

- **Tool definitions.** `computer_use_20250124` (Claude 3.5) → `computer_use_20250429` (Claude 4.x). Actions: `screenshot`, `left_click`, `right_click`, `middle_click`, `double_click`, `triple_click`, `left_mouse_down`, `left_mouse_up`, `mouse_move`, `key`, `hold_key`, `type`, `scroll`, `wait`, `cursor_position`. Token cost: ~466-499 system + 735 tool definition + screenshots.
- **Claude for Chrome (beta).** Anthropic's own extension. Records workflows, replays them. Available to Pro ($17/mo) & Max ($100/mo). Pro is restricted to Haiku 4.5; Max gets Sonnet/Opus 4.5. Safety: 23.6% → 11.2% prompt-injection success rate after mitigations.
- **Tool surface (matrx-extend should at minimum match).** `screenshot`, `click(x,y)`, `type`, `key`, `scroll`, `wait`, `navigate`, `go_back`, `tab_new`, `tab_close`, `tab_focus`, `extract`, `observe`.
- **Gaps to exploit.** Claude for Chrome is a *passive* agent — it does not do cross-tab, does not have programmable user-script injection, does not have persistent vector memory across runs (only "memory" within a run). Pricing locks free users out.

Sources: [Anthropic computer use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool), [Claude for Chrome](https://www.anthropic.com/news/claude-for-chrome), [Anthropic prompt-injection mitigations](https://www.anthropic.com/research/prompt-injection-defenses).

### 6.3 Browser Use (open-source)

- **Tool surface.** Registered actions include `click_element_by_index`, `input_text`, `extract_content`, `scroll_down`, `scroll_up`, `go_to_url`, `go_back`, `done`, `open_tab`, `switch_tab`, `close_tab`, `wait`, `press_keys`, `hover`, `dblclick`, `rightclick`. The library indexes elements by integer (`[0] button`, `[1] input`) and the LLM acts on indices.
- **Architecture.** Python + Playwright. ~50K GitHub stars. Distinguished by element-index abstraction (cheap tokens), and by being open source.
- **Gaps to exploit.** No cookie persistence, no extension model, no user-side privacy story. Index-based indexing is fragile when the page mutates between observation and action.

### 6.4 Stagehand v3 (Browserbase)

- **Primitives.** `act()` (actions in plain English), `extract()` (structured Zod-validated extraction), `observe()` (lists actionable items on the page), `agent()` (multi-step autonomous).
- **v3 architecture.** Direct CDP-native; dropped Playwright dependency for 44% perf gain. Caches LLM-discovered actions for deterministic 10–100× replay with zero tokens. Supports MCP.
- **Gaps to exploit.** Cloud-first, not user-session-first. Stagehand cache is per-script not per-user.

Sources: [Stagehand](https://github.com/browserbase/stagehand), [Stagehand vs Browser Use](https://scrapfly.io/blog/posts/stagehand-vs-browser-use).

### 6.5 Skyvern 2.0

- **Distinctive feature.** Self-healing automations: agent generates Playwright code on first run, replays code deterministically thereafter, falls back to vision LLM when the code fails (DOM changed), then *rewrites the code automatically*. 2.7× cheaper, 2.3× faster vs v1.
- **Gap to match.** matrx-extend should ship the same pattern in-extension: cache generated DOM-action plans (selectors + JS code) keyed by URL pattern, replay deterministically, fall back to AI when replay fails.

Sources: [Skyvern](https://github.com/Skyvern-AI/skyvern), [Layout-Resistant Automation](https://www.skyvern.com/blog/layout-resistant-browser-automation-tools/).

### 6.6 Manus / MultiOn / agent.exe

- **Manus.** Multi-agent research + content. Now part of Meta. Browser Operator extension turns any browser into AI browser; plans/navigates/clicks autonomously. Supports premium platforms via local sessions.
- **MultiOn.** "Motor cortex layer." Personal automations via proprietary ACE (vision + language + interaction).
- **agent.exe.** Lightweight Anthropic-API-based developer toolkit; very thin layer.

### 6.7 MCP and WebMCP — alignment strategy

- **MCP.** Model Context Protocol. 2026 roadmap: transport scalability, agent-to-agent (A2A), governance, enterprise (audit + SSO + gateways). OpenAI added native MCP in early 2026; Google followed for Gemini. **Recommendation:** ship matrx-extend's tool catalog as an MCP-compatible server. The 63 tools become reachable from Claude desktop, Cursor, etc.
- **WebMCP** (Chrome 146, Feb 2026). `navigator.modelContext.registerTool({ name, description, inputSchema, handler })`. The page registers tools; the browser mediates calls. **Two huge plays:**
  - matrx-extend can *call* WebMCP tools that pages expose (Gmail, Linear, etc.) — getting structured access without DOM scraping.
  - matrx-extend can *register* its own WebMCP tools (e.g., from a content script in MAIN world) so other agent extensions can interop.
  - This is the alignment with W3C nobody else is shipping production tooling for yet.

```ts
// content script in MAIN world
navigator.modelContext.registerTool({
  name: 'matrx_summarize_page',
  description: 'Returns a 200-word summary of the current page using local Gemini Nano',
  inputSchema: { type: 'object', properties: { focus: { type: 'string' } } },
  handler: async ({ focus }) => {
    const article = await defuddleExtract(document);
    return await summarizeLocal(article.content, { focus });
  },
});
```

Sources: [WebMCP / Chrome 146](https://bug0.com/blog/webmcp-chrome-146-guide), [2026 MCP roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/), [WebMCP Standard](https://webmcp.link/).

---

## 7. What competitors DO ship that we DON'T

| Capability | Operator/Atlas | Claude for Chrome | Browser Use | Stagehand | Skyvern | matrx-extend (today) |
|---|---|---|---|---|---|---|
| Vision-first action loop (click x,y on screenshot) | yes | yes | partial | yes | yes | **no** |
| Network response body capture | yes (own browser) | partial | yes | yes (CDP) | yes | **no** |
| Accessibility-tree dump | yes | yes | no | yes | partial | **no** |
| DOM snapshot via CDP | yes | yes | no | yes | partial | **no** |
| Self-healing replay (code generation + AI fallback) | partial | partial (record) | no | yes | **best** | **no** |
| Cross-tab orchestration | yes | partial | partial | yes | yes | **no** |
| Persistent vector memory | partial | run-scope only | no | partial | partial | **no** |
| Workflow recording | yes | yes (Apr 2026 update) | no | partial | yes | **no** |
| MCP server interop | yes | yes | yes | yes | partial | **no** |
| WebMCP client | partial | no | no | partial | no | **no** (opportunity) |
| Voice loop (continuous) | no | no | no | no | no | **no** (opportunity) |
| Deterministic replay cache | partial | no | no | yes | yes | **no** |
| Verified attestation / signed receipts | **no** | **no** | **no** | **no** | **no** | **no** (opportunity) |
| Local Gemini Nano integration | no | no | no | no | no | **no** (opportunity) |

The right column is the punch list. Five of the rows are also empty for *every* competitor — that is where the moonshots live.

---

## 8. What WE could ship that NOBODY does yet

Ranked by leverage:

### 1. Verifiable agent-run receipts (cryptographic attestation)
Sign every tool call: `{ runId, tool, args, resultHash, screenshotHash, timestamp }` with an extension-managed keypair. Export as a `.matrxrun` bundle (JSON + MHTML + screenshots, all hashed in a Merkle tree). Auditors / compliance teams can verify "the agent did exactly these actions on these pages at these times." Nobody ships this. Sells itself for legal, healthcare, finance.

### 2. Local Gemini Nano as the cost / latency / safety layer
Use the Prompt API as: (a) an intent classifier before paid LLM calls, (b) a prompt-injection guard between scraped content and the cloud model, (c) a summarizer for huge DOMs, (d) an OCR fallback. Cost reduction of 50-80% on routine ops. Free latency win.

### 3. WebMCP-first tool catalog
Register all 63 tools via `navigator.modelContext.registerTool` from a content script. Suddenly any agent (Claude for Chrome, Atlas, third-party MCP clients) can call matrx-extend's tools. Becomes the *default* extension that other agents talk through.

### 4. Self-healing selector + Playwright codegen replay
Skyvern does it server-side; nobody does it in-extension. Persist selectors keyed by `(URL pattern, accessibility name, role, near-text)` plus a generated MAIN-world JS replay function in `@wxt-dev/storage`. On replay, run the JS first; on failure, fall back to vision/AX-tree LLM. Auto-rewrite the JS once recovered.

### 5. Voice loop (continuous listening → action → speech)
Continuous `webkitSpeechRecognition` in offscreen + intent classifier (local Gemini Nano) + agent action + `SpeechSynthesisUtterance`. Hotword optional (web speech doesn't natively wake-word, but you can run a 50KB Porcupine WebAssembly model in WebGPU). Hands-free agent for accessibility / driving / cooking workflows.

### 6. Cross-tab orchestration ("compare these 5 tabs")
Open N tabs, attach via debugger or content script, run the same observe-extract pipeline against each, materialize a comparison table in the side panel. Nobody in the extension space does this; Claude Code does it for code. Differentiator for power users.

### 7. Timeline scrubbing / agent-state rewind
Persist every `(step, screenshot, DOM hash, network log)` tuple. Side panel surfaces a horizontal timeline; user drags to scrub. Show the page state, agent reasoning, and DOM at that step. Cloudflare Browser Run does it for headless cloud; nobody ships it in-extension.

### 8. Skill / macro recording
User clicks "record," does a 10-step manual workflow once. Extension records: click coordinates + accessibility names + scrolls + typed input. On "save," the local Gemini Nano rewrites it into a parameterized "skill" (with prompts for variable inputs). Skills are stored in the user's storage and exposed as new tools. Claude for Chrome shipped a recording feature in March 2026 — match it but make recordings *editable* (an LLM rewrites the recording into clean code on demand).

### 9. Vision-first navigation mode toggle
Most agents do DOM-first with vision fallback. Add a one-toggle "vision-only" mode that uses the local Gemini Nano (multimodal!) for screenshot reasoning when DOM is hopeless (canvas-based apps, SPA shadow-DOM jungles). Tradeoff: latency ↑, brittleness ↓.

### 10. "Replay against my current cookies" backend tier
Send the recorded skill to the Matrx server, which ssh-tunnels back through the extension's `chrome.cookies.export` to run authenticated headless replays at server scale. Nobody else can do this because their agents run in throwaway sandboxes without the user's session.

---

## 9. Recommended permission additions to `wxt.config.ts`

Add (with careful UX and just-in-time approval where possible):

| Permission | Why | Tier | Notes |
|---|---|---|---|
| `debugger` | Network bodies, AX tree, DOM snapshots, robust input, full-page screenshots | privileged | Most impactful single addition. Show a clear sticky banner in side panel while attached. |
| `cookies` | Read auth cookies for "log into my dashboard" workflows | privileged | Already in some `host_permissions`; needs the explicit `cookies` permission. |
| `pageCapture` | MHTML evidence bundles | action | Cheap to add; pairs with the receipt feature. |
| `userScripts` | CSP-exempt skill replay; user-authored extractors | privileged | Requires user toggle in `chrome://extensions`. |
| `system.cpu` + `system.memory` + `system.display` | Health-check before parallel runs; multi-monitor | read | Tiny warning copy. |
| `sessions` | "Reopen the tab I just closed" | read | Trivial. |
| `proxy` | Region-locked content / corp networks | privileged | Only request on demand. |
| `declarativeNetRequest` *or* `declarativeNetRequestWithHostAccess` | Header injection / mock replay | action | Use `WithHostAccess` flavor — far gentler install warning. |
| `declarativeNetRequestFeedback` | (dev only) See which DNR rules matched | dev | Not for production. |

Optional but valuable:
| Permission | Why |
|---|---|
| `topSites` | "Suggest a tool based on the user's actual habits" |
| `management` | Detect conflicting agent extensions; allow user to pause them during a run |
| `webRequest` (non-blocking) | Telemetry of in-flight requests if DNR isn't enough |
| `desktopCapture` | Screen sharing into agent context |
| `tabCapture` | Already implied via `tabs`; add if doing tab-only audio |
| `chrome://favicon/*` | (Edge case — for surfacing favicons in cross-tab compare UI) |

Convert at least `debugger`, `cookies`, `proxy`, `userScripts` to **optional** permissions (`optional_permissions`). Request via `chrome.permissions.request` only when the user enables the feature that needs them. This keeps the *initial* install warning manageable.

```ts
// proposed additions to wxt.config.ts manifest()
permissions: [
  // existing...
  'pageCapture',
  'sessions',
  'system.cpu',
  'system.memory',
  'system.display',
  'declarativeNetRequestWithHostAccess',
],
optional_permissions: [
  'debugger',
  'cookies',
  'proxy',
  'userScripts',
  'webRequest',
  'desktopCapture',
  'topSites',
  'management',
],
```

---

## 10. Implementation order (suggested)

1. **CDP client wrapper** (`src/lib/cdp/client.ts`) + `debugger` as `optional_permissions`. Build the seven tools listed in §1.1. *Highest leverage week of work in the codebase.*
2. **Local Gemini Nano integration** (`src/lib/ai/local.ts`). Wire as the default first-pass classifier and prompt-injection guard.
3. **WebMCP registration** in a MAIN-world content script. Expose the existing 63 tools through `navigator.modelContext.registerTool`.
4. **Replay cache** (`src/lib/skills/replay.ts`) — `defineItem` with version migrations for cached selectors + JS replay snippets.
5. **Cookies / pageCapture** features behind explicit user toggles → unlock evidence bundles + auth-bearing automations.
6. **Run receipts** (`src/lib/receipts/sign.ts`) — generate keypair on first run, sign every tool call, expose export.
7. **Voice loop** in offscreen — continuous STT + local intent → existing tool catalog → TTS.
8. **Cross-tab orchestration** — fan-out runner, comparison renderer in side panel.
9. **Timeline scrubber UI** — driven by the receipt log.
10. **Skill recorder** — record clicks/keys, generate parameterized skill via Prompt API.

---

## Sources

### Chrome / web platform
- [chrome.debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [chrome.declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- [chrome.sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [chrome.userScripts](https://developer.chrome.com/docs/extensions/reference/api/userScripts)
- [chrome.offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [chrome.cookies](https://developer.chrome.com/docs/extensions/reference/api/cookies)
- [chrome.commands](https://developer.chrome.com/docs/extensions/reference/api/commands)
- [chrome.action.openPopup](https://developer.chrome.com/docs/extensions/reference/api/action)
- [chrome.pageCapture](https://developer.chrome.com/docs/extensions/reference/api/pageCapture)
- [chrome.idle](https://developer.chrome.com/docs/extensions/reference/api/idle)
- [chrome.tabCapture in MV3](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- [chrome.proxy](https://developer.chrome.com/docs/extensions/reference/api/proxy)
- [chrome.sessions](https://developer.chrome.com/docs/extensions/reference/api/sessions)
- [What's new in Chrome extensions](https://developer.chrome.com/docs/extensions/whats-new)
- [Full accessibility tree in DevTools](https://developer.chrome.com/blog/full-accessibility-tree)
- [Replace blocking webRequest](https://developer.chrome.com/docs/extensions/develop/migrate/blocking-web-requests)
- [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Compute Pressure API](https://developer.chrome.com/docs/web-platform/compute-pressure)
- [Storage Buckets origin trial](https://developer.chrome.com/blog/storage-buckets-origin-trial/)
- [WebGPU all major browsers (web.dev)](https://web.dev/blog/webgpu-supported-major-browsers)
- [FedCM API](https://developer.chrome.com/docs/identity/fedcm/overview)
- [View Transitions API](https://developer.chrome.com/docs/web-platform/view-transitions/)
- [Anchor positioning (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Anchor_positioning)

### Built-in AI
- [Chrome Prompt API](https://developer.chrome.com/docs/ai/prompt-api)
- [Built-in AI overview](https://developer.chrome.com/docs/ai/built-in)

### WebMCP / MCP
- [WebMCP standard](https://webmcp.link/)
- [WebMCP Chrome 146 guide (bug0)](https://bug0.com/blog/webmcp-chrome-146-guide)
- [Chrome ships WebMCP (VentureBeat)](https://venturebeat.com/infrastructure/google-chrome-ships-webmcp-in-early-preview-turning-every-website-into-a)
- [WebMCP tutorial (DataCamp)](https://www.datacamp.com/tutorial/webmcp-tutorial)
- [2026 MCP roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)

### WXT / React / Tailwind
- [WXT releases](https://github.com/wxt-dev/wxt/releases)
- [WXT storage docs](https://wxt.dev/storage)
- [WXT i18n](https://github.com/wxt-dev/wxt/tree/main/packages/i18n)
- [React 19 release](https://react.dev/blog/2024/12/05/react-19)
- [React 19.2 release](https://react.dev/blog/2025/10/01/react-19-2)
- [React Compiler v1.0](https://react.dev/blog/2025/10/07/react-compiler-1)
- [Tailwind container queries (SitePoint)](https://www.sitepoint.com/tailwind-css-v4-container-queries-modern-layouts/)
- [Toolwind anchors plugin](https://github.com/toolwind/anchors)

### Agent frameworks
- [OpenAI Computer Use docs](https://developers.openai.com/api/docs/guides/tools-computer-use)
- [Introducing Operator](https://openai.com/index/introducing-operator/)
- [Introducing ChatGPT Atlas](https://openai.com/index/introducing-chatgpt-atlas/)
- [OWL architecture (Atlas)](https://openai.com/index/building-chatgpt-atlas/)
- [Anthropic Computer Use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
- [Claude for Chrome announcement](https://www.anthropic.com/news/claude-for-chrome)
- [Anthropic prompt-injection defenses](https://www.anthropic.com/research/prompt-injection-defenses)
- [Stagehand](https://github.com/browserbase/stagehand)
- [Stagehand vs Browser Use vs Playwright (NxCode)](https://www.nxcode.io/resources/news/stagehand-vs-browser-use-vs-playwright-ai-browser-automation-2026)
- [Stagehand v3 architecture (Browserbase)](https://www.browserbase.com/blog/ai-web-agent-sdk)
- [Skyvern repo](https://github.com/Skyvern-AI/skyvern)
- [Skyvern: Layout-Resistant Automation](https://www.skyvern.com/blog/layout-resistant-browser-automation-tools/)
- [Manus Browser Operator](https://manus.im/blog/manus-browser-operator)
- [Cloudflare Browser Run](https://blog.cloudflare.com/browser-run-for-ai-agents/)

### Security / prompt injection
- [Hardening Atlas against prompt injection (OpenAI)](https://openai.com/index/hardening-atlas-against-prompt-injection/)
- [Prompt injections in the wild (Help Net)](https://www.helpnetsecurity.com/2026/04/24/indirect-prompt-injection-in-the-wild/)
- [AI threats in the wild (Google)](https://blog.google/security/prompt-injections-web/)

### Memory / vector / agentic browsers
- [Memory Palace agentic RAG (Medium)](https://medium.com/@venkatareddya91/memory-palace-part-2-i-built-a-chrome-extension-and-made-my-second-brain-portable-f466ecadcd03)
- [Top 5 agentic browsers 2026 (Seraphic)](https://seraphicsecurity.com/learn/ai-browser/top-5-agentic-browsers-in-2026-capabilities-and-security-risks/)
- [The agentic browser landscape 2026 (No Hacks)](https://nohacks.co/blog/agentic-browser-landscape-2026)
