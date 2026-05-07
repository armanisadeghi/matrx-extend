# Agent Tasks

Active worklist managed by agents. **See `AGENT_INSTRUCTIONS.md` for rules** — especially around task format, condensation, and when to ask the user.

> Quick scan order for arriving agents:
> 1. **Needs Clarification** below (questions waiting on the user)
> 2. **Blocked** (waiting on external)
> 3. **Active** (`ready` and `in-progress`)
> 4. **Completed** (recent context, condensed)

---

## Needs Clarification

### TASK-004: Cloud-sync guidance metadata
- **Status:** needs-clarification
- **Created:** 2026-05-06
- **Source:** "Cloud sync of guidance metadata (currently local-only — only the artifact bytes go to cld_files). Or pushed to the database, unless we're only talking about the files here"

**Goal**
Persist guidance metadata to the cloud so it survives across machines / installs, not just the artifact bytes.

**Notes**
- User asked their own follow-up: are we syncing metadata to the DB, or is this only about the file artifacts?
- Need to look at current guidance pipeline to answer: where does metadata live now, what's already in `cld_files`, and what's the gap.
- **Open question for user:** are we adding a Supabase table for guidance metadata, or is this just about ensuring the file-side sync covers everything?

---

## Blocked

_(none)_

## Active

### TASK-002: Voice input + multilingual TTS in chat
- **Status:** in-progress
- **Created:** 2026-05-06
- **Source:** "Add audio recording capability to get the microphone in the input working. Groq for STT, Cartesia for TTS, translation including Spanish, French, Persian, English, Chinese, Russian"

**Goal**
Mic icon in the chat input becomes functional: user holds/clicks → speech captured → transcribed → text appears in the input. Agent responses can be spoken back via TTS. Optionally translates speech-out to a chosen language.

**Why**
Voice loop is one of the frontier capabilities listed in CLAUDE.md (deferred from initial roadmap). User wants parity with the Next.js app's audio settings.

**Decisions (2026-05-06, user-confirmed)**
- STT/TTS endpoints: hit existing matrx-frontend routes at `https://aimatrx.com/api/cartesia` and `/api/audio/transcribe[-url]`. Auth via Supabase Bearer token using `getAccessToken()` from `src/lib/auth/flow.ts`.
- Translation: STT → on-device Gemini Nano `ai_translate` (free, local) → Cartesia TTS with target `language`. Server-translation fallback only if Nano unavailable.
- Voice prefs: new zustand slice persisted via `chrome.storage.sync` so they follow the user across installs.
- UI: mic in `ChatView` Composer (already has placeholder at line 967), speaker on agent message bubbles, language picker in chat header.

**Subtasks**
- [x] **002a**: Port audio + tts hook stack into `src/lib/audio/` and `src/lib/tts/`. Added `@cartesia/cartesia-js@^2.2.9` (matches matrx-frontend; the SDK had breaking changes in 3.x). Auth via `getAccessToken()`, endpoints absolute to `${ENV.FRONTEND_URL}` (default `https://aimatrx.com`). New `useVoicePrefsStore` (zustand → chrome.storage.local) for `voice/language/speed`. Frontend host added to `wxt.config.ts`. **2026-05-08**
- [x] **002b**: Mic button in `ChatView` Composer wired to `useRecordAndTranscribe`. Streams transcript into the textarea live (preserving any baseline text), red pulse + audio-level glow while recording, spinner while finishing. **2026-05-08**
- [x] **002b-fix**: Initial port hit `NotAllowedError` because Chrome MV3 side panels can't reliably get mic permission. Refactored capture into the existing offscreen document with reason `USER_MEDIA`. New `MIC_REQUEST → MIC_RUN → MIC_EVENT` messaging flow: sidepanel sends MIC_REQUEST to SW, SW ensures offscreen + forwards as MIC_RUN, offscreen runs MediaRecorder + analyser and broadcasts MIC_EVENT (chunks as ArrayBuffer, audio levels, lifecycle). Hook is now a thin client that subscribes and transcribes incoming chunks. **2026-05-08** — *Typecheck + catalog regen still clean. Needs browser test next.*
- [x] **002c**: Speaker button on each agent message bubble (`SpeakerButton.tsx`) — `Volume2` idle / `Loader2` while connecting / `Pause` while playing / `VolumeX` on error or paused. Reads message text via `parseMarkdownToText`, plays through `useCartesiaSpeaker` with the active language from `useVoicePrefsStore`; errors surface via the hook's `onError` callback into a 4s aria/title flash (no toast wrapper yet per 002 notes). Click while playing stops playback. Sits next to the existing CopyMenu inside the message bubble's hover-reveal toolbar. Language picker (`LanguagePicker.tsx`) lives in the chat header next to the agent picker / refresh icon — six-language set (en/es/fr/fa/zh/ru), `Languages` icon trigger, native names plus English in the dropdown, no flag emojis. Bound to and persisted via the existing `useVoicePrefsStore` so the pick immediately steers TTS for every speaker bubble. **2026-05-08**
- [ ] **002d**: Cross-check all 6 languages end-to-end (record en → translate → speak out es/fr/fa/zh/ru).

**Notes**
- The Next.js fallback path (`audioFallbackUpload`) uses Redux + `cld_files` upload. Extension can stub this — IndexedDB safety net still preserves audio for crash recovery. Add server fallback later if chunk failures show up in practice.
- Strip the auto-persist-to-transcripts block (lines 192–235 of `useChunkedRecordAndTranscribe`) — that's matrx-frontend's transcripts feature, not relevant here.
- `useCartesiaSpeaker` toasts via `sonner`; no toast wrapper in the extension yet, so route errors through `onError` callbacks instead.

---

---

## Completed

- [ENH] CLAUDE.md #9 Pilot tab: PilotView clone of ChatView with `surface: 'pilot'` ([src/features/chat/PilotView.tsx](../src/features/chat/PilotView.tsx)) wired to `usePilotChatStream` ([src/hooks/use-pilot-chat-stream.ts](../src/hooks/use-pilot-chat-stream.ts)) and `usePilotChatStore` ([src/state/pilot-chat.ts](../src/state/pilot-chat.ts)) so the pilot conversation is isolated from the assistant's. Pilot session state ([src/state/pilot.ts](../src/state/pilot.ts)) creates / colors / tears down a Chrome tab group via `chrome.tabs.group` + `chrome.tabGroups.update` (blue, titled "Pilot"). Dispatcher group scoping ([src/lib/tools/dispatch.ts](../src/lib/tools/dispatch.ts) `enforcePilotGroupScope`) rejects action / privileged calls whose `assignedTabId` is outside the active session's group with a structured `pilot_group_violation` error. `parallel_for_each_tab` ([src/lib/tools/handlers/parallel.ts](../src/lib/tools/handlers/parallel.ts)) enforces the same up front. SW lifecycle listeners ([src/lib/background/bootstrap.ts](../src/lib/background/bootstrap.ts) `registerPilotLifecycleListeners`) reset the persisted session when the group is dissolved externally (last tab closed, ungrouped). New `pilot` sidepanel tab registered admin-only with a Crosshair icon ([src/entrypoints/sidepanel/App.tsx](../src/entrypoints/sidepanel/App.tsx)). Catalog regen clean (168 tools, no count change). 2026-05-07
- [ENH] CLAUDE.md #6 cross-tab parallel: `parallel_for_each_tab` admin tool ([src/lib/tools/handlers/parallel.ts](../src/lib/tools/handlers/parallel.ts)) fans out N child agent streams (max 8) via the same offscreen STREAM_RUN path; each sub-run pinned to its tab via `recordAssignedTab` before the SSE opens; `Promise.allSettled` semantics; per-sub-run timeout aborts via STREAM_KILL; three merge strategies (`per_tab`, `concat`, `json_array`). New PARALLEL_RUN_EVENT channel ([src/lib/messaging/schemas.ts](../src/lib/messaging/schemas.ts)) carries lifecycle events to the sidepanel. Sidepanel-side store ([src/state/parallel-runs.ts](../src/state/parallel-runs.ts)) + status panel ([src/features/tasks/ParallelRunsPanel.tsx](../src/features/tasks/ParallelRunsPanel.tsx)) mounted at the top of the Tasks tab — shows X-of-N running / done / failed with expandable per-sub-run output. Catalog regen clean (168 tools, +1). 2026-05-07 (94e26cf)
- [ENH] Manifest hygiene (CLAUDE.md roadmap item #10): moved `<all_urls>` from base `host_permissions` to `optional_host_permissions` with a Settings → Advanced → "All sites access" toggle ([src/lib/permissions/optional.ts](../src/lib/permissions/optional.ts), [src/features/settings/AdvancedAgentCapabilities.tsx](../src/features/settings/AdvancedAgentCapabilities.tsx)). Persistent content script now registered dynamically via `chrome.scripting.registerContentScripts` when the grant flips on ([src/lib/permissions/content-scripts.ts](../src/lib/permissions/content-scripts.ts), wired into [src/lib/background/bootstrap.ts](../src/lib/background/bootstrap.ts)). Added a `build:manifestGenerated` WXT hook in [wxt.config.ts](../wxt.config.ts) to strip WXT's auto-add of `<all_urls>` from base host_permissions (otherwise WXT promotes runtime-CS matches back into base). New handler flag `requires_broad_host_access` ([src/lib/tools/types.ts](../src/lib/tools/types.ts)); dispatcher gates 15 page-DOM tools (read_active_page, read_page, find, get_page_text, query_elements, find_text_on_page, get_page_links, get_computed_style, get_element_at_point, inspect_element, get_element_details, click_element, type_into_element, scroll_page, wait_for) and returns a structured remediation error when the URL isn't covered. Added `system.cpu`, `system.memory`, `system.display`, `declarativeNetRequestWithHostAccess` to base permissions per CLAUDE.md (preemptive — no consumers yet, install dialog impact zero). Catalog regen clean (167 tools, +1 field `requires_broad_host_access`). 2026-05-07
- [TASK-003] Video capture (user feature + admin agent tool). Tab capture via `chrome.tabCapture.getMediaStreamId` resolved in the SW, MediaRecorder lives in the existing offscreen document (reused USER_MEDIA reason from TASK-002), uploads to `cld_files` via `uploadFile` (same path as `record_gif` / `take_screenshot`). New `record_tab_video` action-tier admin-only tool ([src/lib/tools/handlers/video.ts](../src/lib/tools/handlers/video.ts)) requires the new `tabCapture` optional permission. Sidepanel UI added as a third sub-tab ("Recorder") inside the existing Tools view ([src/features/tools/RecorderPane.tsx](../src/features/tools/RecorderPane.tsx)) with duration input, audio toggle, live red-dot timer, and persistent recordings list keyed in `chrome.storage.local`. New VIDEO_REQUEST/VIDEO_RUN/VIDEO_EVENT channels ([src/lib/messaging/schemas.ts](../src/lib/messaging/schemas.ts)) mirror the mic protocol. `tabCapture` toggle auto-appears in Settings → Advanced via the existing `OPTIONAL_PERMISSION_LABELS` registry. Catalog regen clean (167 tools, +1). 2026-05-07 (ba762f8)
- [TASK-005] Per-page screenshot history tab — gallery view in side panel, captures share `take_screenshot` handler, persists to cld_files + new `wbx_screenshot` table keyed by canonical URL ([src/features/screenshots/ScreenshotsView.tsx](../src/features/screenshots/ScreenshotsView.tsx), [src/lib/screenshot/persist.ts](../src/lib/screenshot/persist.ts), [migrations/2026_05_08_wbx_screenshot.sql](../migrations/2026_05_08_wbx_screenshot.sql)) — 2026-05-07 (5614394)
- [TASK-010] BUG: Sidepanel re-opens previous conversation. Dropped `selectedConversationId` from `useChatStore`'s persisted slice and added a `merge` hook that force-nulls it on every rehydration ([src/state/chat.ts](../src/state/chat.ts)). Storage key kept as `matrx.chat.v1` so other persisted prefs (agent, draft, vars, permission mode) survive. 2026-05-06
- [TASK-009] BUG: Tools follow Chrome's active tab instead of the agent's assigned tab. Added `assignedTabId` to `ToolContext` ([src/lib/tools/types.ts](../src/lib/tools/types.ts)) latched at message-send via STREAM_START ([src/hooks/use-chat-stream.ts](../src/hooks/use-chat-stream.ts) → [src/lib/stream/offscreen-proxy.ts](../src/lib/stream/offscreen-proxy.ts) → [src/lib/background/bootstrap.ts](../src/lib/background/bootstrap.ts) → `recordAssignedTab` in [src/lib/tools/dispatch.ts](../src/lib/tools/dispatch.ts)). New shared helper [src/lib/tools/handlers/_active-tab.ts](../src/lib/tools/handlers/_active-tab.ts) replaces every per-handler `activeTab()` / `activeTabId()`; refactored 16 handler files. Falls back to Chrome's focused tab when no assignment is recorded (Tools-tab "Run", agenda runs without page context). Typecheck + catalog regen clean (166 tools, 16 categories). 2026-05-06
- [TASK-007] BUG: `computer.action='key'` args[2] unserializable — `press_keys` was passing `args.delay_ms` undefined (canonical merger bypassed Zod default). Fixed in `src/lib/tools/handlers/keyboard.ts` (defensive `?? 30`) + `canonical.ts` (full PressKeysArgs shape). 2026-05-08
- [TASK-006] BUG: `read_active_page` flaky on stale tabs — switched handler to `captureWithFallback` so missing content scripts auto-inject + structured failure reasons. `src/lib/tools/handlers/read.ts`. 2026-05-08
- [TASK-008] Logged: server trace shows zero surface rejections / no-executor errors / loop blocks across 57 dispatches in this session — 2026-05-06 (informational, no code change)
- [TASK-001] Bootstrapped task system: instructions, inbox, worklist — 2026-04-30 (`.matrx/`)
