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

### TASK-003: Video capture (user feature + agent tool)
- **Status:** ready
- **Created:** 2026-05-06
- **Source:** "Video capture via MediaRecorder / chrome.tabCapture (as feature for the user and tool for assistant)"

**Goal**
The user can record video of the active tab from a UI surface; the agent can do the same via a new tool. Captured video lands somewhere referenceable (likely Supabase storage / `cld_files`).

**Subtasks**
- [ ] Decide capture API: `chrome.tabCapture` (tab-only, no permission prompt for own extension's UI) vs. `getDisplayMedia` (full screen, prompt). Likely both with different entry points.
- [ ] Build the user surface (button in side panel? Tools tab? new tab?).
- [ ] Add new tool `record_tab_video(durationMs, options)` (action tier; admin-gated initially per CLAUDE.md "Admin-only experiments" convention).
- [ ] Storage: upload to `cld_files` (consistent with existing artifacts) and return a reference the agent can pass back to chat.
- [ ] Update tool catalog (`pnpm catalog:tools:md`) and `docs/feature-tests.md`.

**Notes**
- `desktopCapture` is already in `optional_permissions` per CLAUDE.md.
- `tabCapture` may need adding to `optional_permissions` — runtime-grant from Settings.

---

---

## Completed

- [TASK-005] Per-page screenshot history tab — gallery view in side panel, captures share `take_screenshot` handler, persists to cld_files + new `wbx_screenshot` table keyed by canonical URL ([src/features/screenshots/ScreenshotsView.tsx](../src/features/screenshots/ScreenshotsView.tsx), [src/lib/screenshot/persist.ts](../src/lib/screenshot/persist.ts), [migrations/2026_05_08_wbx_screenshot.sql](../migrations/2026_05_08_wbx_screenshot.sql)) — 2026-05-07 (PENDING_SHA)
- [TASK-010] BUG: Sidepanel re-opens previous conversation. Dropped `selectedConversationId` from `useChatStore`'s persisted slice and added a `merge` hook that force-nulls it on every rehydration ([src/state/chat.ts](../src/state/chat.ts)). Storage key kept as `matrx.chat.v1` so other persisted prefs (agent, draft, vars, permission mode) survive. 2026-05-06
- [TASK-009] BUG: Tools follow Chrome's active tab instead of the agent's assigned tab. Added `assignedTabId` to `ToolContext` ([src/lib/tools/types.ts](../src/lib/tools/types.ts)) latched at message-send via STREAM_START ([src/hooks/use-chat-stream.ts](../src/hooks/use-chat-stream.ts) → [src/lib/stream/offscreen-proxy.ts](../src/lib/stream/offscreen-proxy.ts) → [src/lib/background/bootstrap.ts](../src/lib/background/bootstrap.ts) → `recordAssignedTab` in [src/lib/tools/dispatch.ts](../src/lib/tools/dispatch.ts)). New shared helper [src/lib/tools/handlers/_active-tab.ts](../src/lib/tools/handlers/_active-tab.ts) replaces every per-handler `activeTab()` / `activeTabId()`; refactored 16 handler files. Falls back to Chrome's focused tab when no assignment is recorded (Tools-tab "Run", agenda runs without page context). Typecheck + catalog regen clean (166 tools, 16 categories). 2026-05-06
- [TASK-007] BUG: `computer.action='key'` args[2] unserializable — `press_keys` was passing `args.delay_ms` undefined (canonical merger bypassed Zod default). Fixed in `src/lib/tools/handlers/keyboard.ts` (defensive `?? 30`) + `canonical.ts` (full PressKeysArgs shape). 2026-05-08
- [TASK-006] BUG: `read_active_page` flaky on stale tabs — switched handler to `captureWithFallback` so missing content scripts auto-inject + structured failure reasons. `src/lib/tools/handlers/read.ts`. 2026-05-08
- [TASK-008] Logged: server trace shows zero surface rejections / no-executor errors / loop blocks across 57 dispatches in this session — 2026-05-06 (informational, no code change)
- [TASK-001] Bootstrapped task system: instructions, inbox, worklist — 2026-04-30 (`.matrx/`)
