# Safari Port — Gap Analysis & Action Plan

> Generated 2026-05-03. Audit-only document. Nothing in `src/` or `wxt.config.ts`
> changes as a result of this — it's a worklist for a future Safari branch.
>
> **Bottom line:** the analysis in `docs/safari-analysis.md` was right that the
> code-level cost is modest *for a typical extension*. For **this** extension
> it's larger than that, because the agent harness leans on three Chrome-only
> APIs that Safari does not implement: `sidePanel`, `offscreen`, and
> `debugger` (CDP). Mac Safari is still feasible — but it needs an alternate
> UI surface and a redesigned long-running-stream strategy, not just a
> recompile.

---

## 1. Where we already are

| Signal | State | Why it helps Safari |
|---|---|---|
| WXT 0.20.17 build system | ✅ | First-class `-b safari` target; emits Safari-shaped manifest. |
| Firefox build (`build:firefox`) | ✅ | Safari uses the same `browser.*` shape; cross-browser shims already validated by the FF build. |
| Pure web-stack deps (React 19, Radix, Tailwind 4, Zustand, TanStack Query, Supabase, Readability, Defuddle, Turndown, DOMPurify, Zod, Shiki) | ✅ | Browser-agnostic; all run unchanged in Safari WebKit. |
| `@webext-core/messaging` | ✅ | Cross-browser by design. |
| Optional permissions already gated through `src/lib/permissions/optional.ts` | ✅ | We already ship a "graceful unavailable" path; trivial to extend it for Safari-missing APIs. |
| Tools auto-feature-detect (`onbox-ai/client.ts`, `cdp/client.ts`, `webmcp/register.ts`) | ✅ | Tools that touch APIs Safari doesn't have already return `{ ok: false, reason: 'unavailable' }` rather than throwing. |
| Hardcoded extension `key` in `wxt.config.ts:28` | ⚠️ | Chrome-only field — harmless to Safari (it ignores it) but noise during review; can be conditionalized on `manifest.browser`. |

**One thing worth flagging now:** the codebase calls `chrome.*` directly in
86 files. That works in Firefox (Mozilla aliases `chrome → browser`) and in
Safari (Apple does the same), so this is **not a porting blocker**, just a
hygiene issue. Do not refactor as a precondition — only swap to `browser.*`
where Safari/Firefox needs the promise-returning shape and Chrome's callback
shape doesn't cut it. In practice that's nearly nothing today.

---

## 2. What actually breaks on Safari (the gap list)

Ordered by blast radius. The first three are real architectural gaps.

### 2.1 🔴 BLOCKER — `chrome.sidePanel` unsupported

**What we use it for**
- The entire primary UI is `src/entrypoints/sidepanel/`. Chat, Tasks, Scrape,
  Data, SEO, Tools, Settings, Debug — everything ships through the side panel.
- Background opens it on action click via `chrome.sidePanel.setPanelBehavior`
  (background.ts:27) and `chrome.sidePanel.open` (referenced in 2 sites).
- Manifest declares `side_panel.default_path: 'sidepanel.html'` and the
  `sidePanel` permission.

**Safari status:** the `sidePanel` API does not exist in Safari Web
Extensions (and, structurally, Safari has no in-window side-panel host —
Apple didn't ship the matching Tab Group sidebar widget that Chrome does).

**Mitigation options, ranked**
1. **Re-host the same React tree in a popup.** Safari's `browser_action`
   popup is bigger and more flexible than Chrome's, and our `sidepanel.html`
   is just a React mount — wire it as the popup entry on Safari. Loses the
   "sticky next to the page" feel but keeps the entire feature set. Best
   first-pass option.
2. **Re-host as a window/tab.** Open `sidepanel.html` as a chrome.windows
   popup window (Safari supports `windows.create`). Persists across page
   navigations, behaves like a mini-app. Better for long agent runs.
3. **Inject as a content-script overlay.** Highest fidelity to the current
   "always next to the page" UX, but runs into iframe-isolation and
   per-site CSP headaches. Avoid for v1.

**Action items**
- [ ] Add `safari` build target to `wxt.config.ts` and conditionally drop
      `side_panel` block + `sidePanel` permission when `manifest.browser ===
      'safari'`.
- [ ] Add a Safari-only popup entrypoint (`src/entrypoints/popup/`) that
      renders the same root component as `sidepanel`.
- [ ] Replace `chrome.sidePanel.open` calls with a branched helper
      (`openSurface()`) that either opens the panel (Chrome), the popup
      (Safari), or a `windows.create` popup window (fallback).
- [ ] Audit any UI assumption that the surface stays open across tab nav
      (popups close when focus moves) — promote to `windows.create` if it
      breaks.

---

### 2.2 🔴 BLOCKER — `chrome.offscreen` unsupported

**What we use it for**
- `src/entrypoints/offscreen/main.ts` holds long-running SSE streams for
  agent runs and scrape responses. The SW pre-resolves auth, then handoff to
  offscreen (`STREAM_RUN`) so the stream survives SW termination after 30s.
- Created at `src/lib/stream/offscreen-proxy.ts:25` via
  `chrome.offscreen.createDocument({ reasons: ['BLOBS'] })`.

**Safari status:** offscreen documents do not exist in Safari Web Extensions.

**Mitigation options**
1. **Hold the stream in the popup/window UI surface (Safari only).** Since
   we're already swapping the side panel for a popup or window (§2.1), the
   UI surface itself becomes the long-lived context. As long as the popup is
   open the stream stays open; if the popup closes mid-run we abort and
   resume from server state on reopen. This is the simplest path and aligns
   with how most Safari extensions handle long work.
2. **Persistent background page.** Safari MV3 supports a non-persistent
   background but its lifecycle is even more aggressive than Chrome's, so
   pinning everything to the background is worse, not better.
3. **Ship the worker on the desktop bridge (`com.matrx.local`).** We
   already have a native messaging path for desktop work; for Mac users the
   long-running stream could live there. This is a heavier rework but
   ultimately the most robust on Safari + iOS.

**Action items**
- [ ] Branch `streamRun()` so on Safari it executes inside the popup
      surface and forwards `STREAM_CHUNK` directly to the React tree
      (skip the SW round-trip).
- [ ] Make stream consumers idempotent against surface restart — pull
      `conversationId` + last-event-id and resume from the server.
- [ ] Decide whether iOS Safari needs an even more conservative path
      (likely yes — see §3).

---

### 2.3 🔴 BLOCKER (admin only) — `chrome.debugger` / CDP unsupported

**What we use it for**
- 10 admin-only tools in `src/lib/cdp/client.ts` and
  `src/lib/tools/handlers/debug.ts`: full-page screenshot, accessibility
  tree, network capture (start/drain/stop/get_body), coordinate clicks,
  type-text, print-PDF, perf metrics, device emulation, console messages.
- Manifest has `debugger` as a *required* permission (not optional —
  comment at `wxt.config.ts:48` notes Chrome rejects it from
  `optional_permissions`).

**Safari status:** the `debugger` API and the underlying CDP attach point
don't exist in Safari Web Extensions. Safari uses the WebKit Inspector
Protocol internally and does not expose it to extensions.

**Mitigation**
- These are admin-tier debug capabilities, not core. Filter them out of the
  Safari catalog entirely; the registry already has `admin_only` machinery
  we can re-use to add a `safari_unsupported` flag.
- A subset (`cdp_full_page_screenshot`) can be re-implemented via
  `tabs.captureVisibleTab` + scroll-stitching — worth it if users miss it.

**Action items**
- [ ] Drop `debugger` from manifest permissions on Safari builds.
- [ ] Drop `debugger` group + `read_console_messages` from
      `assistantToolNames` / `pilotToolNames` when `import.meta.env.BROWSER ===
      'safari'`.
- [ ] Optional: native screenshot stitching fallback for the one tool we
      actually miss.

---

### 2.4 🟡 MODERATE — `chrome.tabGroups` unsupported

**What we use it for**
- 6 tools: `create_tab_group`, `add_tabs_to_group`, `remove_tabs_from_group`,
  `update_tab_group`, plus reads in `get_tab_groups` and `list_open_tabs`.
- `pin_tab` (no group dependency) is fine.

**Safari status:** Safari has tab groups in the UI (since macOS Monterey)
but does not expose them to extensions.

**Action items**
- [ ] Tools already null-coerce; add the `safari_unsupported` flag and
      filter from advertised tool list on Safari builds.
- [ ] Drop `tabGroups` permission from Safari manifest.

---

### 2.5 🟡 MODERATE — On-device AI (`chrome.aiOriginTrial` / `window.ai`)

**What we use it for**
- 9 `ai_*` tools in `src/lib/onbox-ai/client.ts`. Gemini Nano + Summarizer +
  Translator + LanguageDetector + Proofreader + multimodal.
- Already feature-detected; returns `{ ok: false, availability:
  'unavailable' }` when missing.

**Safari status:** Apple Foundation Models (the on-device model that ships
with macOS 15 / iOS 18) is **not** exposed to Web Extensions. There is an
emerging `window.ai` standard discussion but Safari has not shipped it.

**Action items**
- [ ] No code change strictly needed — graceful unavailable already wired.
- [ ] Consider routing the same surface to a Foundation Models call from
      the wrapping macOS app via native messaging in a later phase.
- [ ] Filter `ai` category from advertised list on Safari to avoid the
      agent burning a turn calling and being told "unavailable".

---

### 2.6 🟡 MODERATE — `chrome.identity.launchWebAuthFlow`

**What we use it for**
- `src/lib/auth/flow.ts:184` — Supabase OAuth 2.1 PKCE flow.
- Redirect URI is `chrome.identity.getRedirectURL()` →
  `https://<extension-id>.chromiumapp.org/`.

**Safari status:** Safari Web Extensions **do** implement
`browser.identity.launchWebAuthFlow` (since Safari 14.1). However:
- The redirect URL format on Safari is
  `https://<bundle-id>.safariwebext.apple/` (different scheme + host
  per-platform).
- The redirect target must be added to Supabase's allowed redirect list.
- macOS will pop a system-level "Allow this extension to use the website
  ___" dialog the first time.

**Action items**
- [ ] Compute redirect URI per browser at runtime (already lazy in
      `getRedirectUri()` — verify it returns the right value under Safari).
- [ ] Register the Safari redirect URI in the Supabase project's allowed
      redirect URI list before first-run testing.
- [ ] Capture the actual URI shape on first build (Safari only finalizes
      the bundle ID at conversion time).

---

### 2.7 🟢 MINOR — `chrome.pageCapture` (MHTML save)

**What we use it for**
- One admin tool, `save_page_as_mhtml`, gated by an optional permission.

**Safari status:** Not implemented. Extension can still hit "Web Archive"
via a native helper, but it's not an extension API.

**Action item:** filter from Safari manifest + tool list.

---

### 2.8 🟢 MINOR — `chrome.nativeMessaging` (desktop bridge)

**What we use it for**
- `desktop_run_command` tool + `src/lib/desktop/native.ts`. Connects to
  `com.matrx.local`.

**Safari status:** Native messaging exists, but the host **must be bundled
inside the containing macOS app** (Safari does not load
`~/Library/Application Support/.../NativeMessagingHosts/*.json` the way
Chrome does). The host is invoked via NSExtension XPC, not stdin/stdout
JSON pipes.

**Action items**
- [ ] Phase 2 only. For v1 Safari, mark `desktop_run_command` as
      unavailable.
- [ ] If we want it on Safari, ship `com.matrx.local` as a helper inside
      the wrapping `.app` and adapt `connectNative` → Safari XPC bridge
      (entirely different code path).

---

### 2.9 🟢 MINOR — `host_permissions: ['<all_urls>']` review risk

**What we use it for**
- Required for the agent to read/scrape arbitrary pages, plus listed Matrx
  backend hosts.

**Safari status:** Apple reviewers scrutinize this far more than Google.
Expect a "why does this need every site?" question on first submission.

**Action items**
- [ ] Draft a clear justification for review notes (we already have one
      implicitly — the agent operates on whatever site the user is on).
- [ ] Consider gating `<all_urls>` behind `optional_host_permissions` on
      Safari (already in the roadmap as Phase 10 / "manifest hygiene").
      Safari supports per-site grants well via `activeTab`.

---

### 2.10 🟢 MINOR — Manifest `key` field

**What we use it for**
- Pinning the Chrome extension ID for OAuth redirect stability
  (`wxt.config.ts:28`).

**Safari status:** Safari ignores it. Bundle ID comes from the Xcode
project. Harmless, but noisy.

**Action item:** strip `key` from the Safari manifest variant in the
`defineConfig` callback.

---

### 2.11 🟢 MINOR — Types

**What we have:** `@types/chrome` only.

**Action item:** for Safari + Firefox typing fidelity, add
`@types/firefox-webext-browser` (or `webextension-polyfill-ts`). Not strictly
required — WXT's `wxt/browser` type covers most call sites once we use it.

---

## 3. iOS Safari (Phase 2 only)

The Mac Safari port gives us iOS automatically as a build target, but the
runtime constraints are tighter:

- Background lifecycle is even more aggressive (assume sub-second).
- No popup; UI is launched as a full-screen web extension surface.
- Touch-only — the popup-width chat layout, code blocks, and form-heavy
  Tasks/Data views need a 390px viewport pass.
- `chrome.scripting.executeScript` works but with stricter timing/CSP.
- No native messaging at all on iOS.
- App must ship through App Store with associated app entitlements.

Defer until Mac is shipping cleanly. Two-week estimate from `safari-analysis.md`
holds, but the layout work is the bulk of it for a feature-dense extension
like ours.

---

## 4. Action plan (sequenced)

> Each item is independent of the live extension — the checklist is for a
> branch (`safari-spike`), not main. Nothing here touches the Chrome
> production build.

### Phase 0 — One-afternoon spike (decide-or-defer)
- [ ] `pnpm add -D wxt-module-safari-xcode`
- [ ] Add `safari` to `wxt.config.ts` build matrix on the spike branch
- [ ] Run `pnpm wxt build -b safari`
- [ ] Run `xcrun safari-web-extension-converter` (the WXT module wraps this)
- [ ] Open in Xcode, sign with personal team, install locally
- [ ] Catalog the actual API/permission warnings the converter prints
- [ ] Compare reality vs. this gap list — confirm or correct

### Phase 1 — UI surface swap (largest piece)
- [ ] Conditional manifest: drop `side_panel`, `sidePanel`, `offscreen`,
      `debugger`, `tabGroups`, `pageCapture` permissions on Safari
- [ ] New `src/entrypoints/popup/` (or `windows.create`-launched window)
      that mounts the existing sidepanel root component
- [ ] `openSurface()` helper that branches per browser
- [ ] Verify the React tree, Zustand stores, and TanStack Query persistence
      all behave identically in the popup context (storage layer is the
      same; should be a non-event)

### Phase 2 — Streaming without `offscreen`
- [ ] On Safari, route `streamFetch` directly from the popup surface
- [ ] Add resume-from-server-state on surface reopen
- [ ] Smoke test: 5-minute agent run with multiple tool calls + permission
      gates — does it survive popup focus loss? Does it survive popup close
      + reopen?

### Phase 3 — Tool catalog filtering
- [ ] Add `safari_unsupported: true` flag in tool registry metadata
- [ ] Filter from `assistantToolNames` / `pilotToolNames` on Safari
- [ ] Update catalog generators (`pnpm catalog:tools`) to emit a
      Safari-specific catalog file alongside the main one

### Phase 4 — Auth
- [ ] Confirm `chrome.identity.getRedirectURL()` shape on Safari
- [ ] Add the Safari redirect URI to Supabase
- [ ] End-to-end OAuth test on Safari

### Phase 5 — App Store submission
- [ ] Ship icons, screenshots, privacy nutrition labels for the wrapper app
- [ ] Privacy policy URL (we have one already on aimatrx.com — verify it
      covers Safari extension data handling)
- [ ] Justify `<all_urls>` in review notes
- [ ] Plan for 1–3 review cycles

### Phase 6 — Polish (post-ship)
- [ ] Native screenshot stitching for the one CDP tool we miss
- [ ] Foundation Models bridge to replace `ai_*` tools (native messaging
      from inside the wrapper app)
- [ ] iOS layout pass + Phase 2 launch

---

## 5. Effort estimate (revised)

| Phase | Estimate | Confidence |
|---|---|---|
| 0 — Spike | half day | High |
| 1 — UI surface swap | 3–5 days | Medium (depends on how much sidepanel-specific behavior we have) |
| 2 — Streaming rework | 2–4 days | Medium |
| 3 — Catalog filtering | 1 day | High |
| 4 — Auth | 1 day | High |
| 5 — App Store | 1–2 days eng + calendar time for review | High |
| **Mac total** | **~2 weeks of focused work + review wait** | Medium |
| 6 — iOS | +1–2 weeks | Low (UI work is the unknown) |

This is up from the original analysis's "1–3 weeks." The delta is Phase 1+2,
which the original document underestimated because it didn't yet know we
lean on `sidePanel` + `offscreen` for the core agent UX.

---

## 6. Recommendation

Do **Phase 0** soon (it's an afternoon and produces real signal). Do
**Phase 1–5** only if either:
- (a) we see meaningful Mac/iOS demand in Matrx user signals, or
- (b) Apple/Mac becomes a positioning moat against Chrome-locked competitors.

Until then, keep this document up to date as APIs change (Safari is shipping
extension capabilities at a steady cadence) and treat the Chrome + Firefox
builds as the supported pair.
