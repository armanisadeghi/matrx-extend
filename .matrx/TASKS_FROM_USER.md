# Tasks from User

Drop anything here — bullets, prose, half-thoughts, voice-transcribed ramblings. No format required. An agent will pick it up, structure it, and either do it now or move it to `AGENT_TASKS.md`.

**Rules of the road:** see `AGENT_INSTRUCTIONS.md`. The short version:
- Write whatever you want under `## Inbox`.
- Agents move each item to `## Processed` once handled, with a pointer to what happened.
- Anything still under `## Inbox` is unprocessed.

---

## To Test

<!-- Short, one-line test instructions for fixes that just landed. Move to Processed once you've verified them. -->

- **Scroll fix (Task 7):** Open Chat, send a long-streaming message, scroll up using the scrollbar, keyboard, OR mouse wheel — auto-scroll should stop instantly and not yank you back; scrolling to within ~8px of the bottom should re-engage follow.
- **Refresh agents (Task 3):** Edit an agent in the dashboard, click the new circular-arrow icon in the chat header next to the agent picker — list should re-fetch (icon spins briefly).
- **Dispatcher fix (Task 8):** In any conversation that calls a server-side tool (e.g. `load_browser_tools`, `ctx_get`), confirm the trace no longer contains a `"Tool 'X' is not registered in this extension"` error row alongside the successful result.
- **read_active_page fix (TASK-006):** From any conversation, ask the agent to "read this page" on a regular site (e.g. Wikipedia). Should return article markdown. Bonus test: do the same on a tab that was already open BEFORE the extension was reloaded — should still work (auto-inject path).
- **computer key fix (TASK-007):** From any conversation, ask the agent to press Enter (or Tab/Escape) on a focused input — should round-trip without `args index 2 unserializable`. Try `Enter`, `Return`, `Tab`, `cmd+a`.
- **Voice input (TASK-002a/b):** Sign in, open Chat. Click the mic icon in the composer — Chrome should prompt for mic permission. Speak; live transcript should appear in the textarea within ~3s and continue updating as you speak. Click mic again to stop; final text stays in the input ready to send. Edge cases: type some text first then click mic — your typed text should be preserved at the front. Click mic again on a totally empty input — recording starts cleanly. Failure path: sign out and click mic — should alert "Not signed in".
- **Tab assignment (TASK-009):** Open two tabs (A and B). Make tab A active and ask the agent to "summarize this page" or "click the first link". While the agent is mid-execution, switch to tab B. The agent should keep reading / clicking / screenshotting tab A — its tool results should reference tab A's URL. Send the next message while tab B is active and the agent should now operate on tab B (re-assignment happens on user-message-send). Edge case: close tab A while the agent is working — next tool call should fall back gracefully and report a real error rather than crashing.
- **New chat on open (TASK-010):** Have a conversation, close the sidepanel, reopen it. Chat should be empty with your last-used agent pre-selected (NOT the previous conversation). Open the chat-header history picker — your previous conversation should still be there to re-select. Edge case: switch between sidepanel tabs (Chat → Tools → Chat) without closing — the in-memory chat session for THIS open session should persist; only a fresh sidepanel open resets it.

## Inbox

<!-- Write new tasks below. Anything goes. Bullets, paragraphs, links, screenshots — agents will sort it out. -->



---

## Processed

<!-- Audit trail. Agents append here; never delete. Format: [done|moved YYYY-MM-DD] "<paraphrase>" → outcome -->

- [moved 2026-05-06] (2) "Audio recording / mic input — Groq for TTS, Cartesia for TTS, multilingual translation (es/fr/fa/en/zh/ru)" → TASK-002
- [moved 2026-05-06] (4) "Video capture via MediaRecorder / chrome.tabCapture (user feature + agent tool)" → TASK-003
- [moved 2026-05-06] (5) "Cloud sync of guidance metadata — currently local-only, only artifact bytes go to cld_files" → TASK-004 (needs-clarification, user's own follow-up question carried into task notes)
- [moved 2026-05-06] (6) "Tab showing every screenshot taken of the current page; user can also take new ones" → TASK-005
- [moved 2026-05-06] (11) "BUG: read_active_page handler runs in SW context where document is undefined" → TASK-006 (active, ready)
- [moved 2026-05-06] (12) "BUG: computer.action='key' with text Enter / Return — args index 2 unserializable" → TASK-007 (active, ready)
- [done 2026-05-06] (13) "FYI: server trace shows zero surface rejections / no-executor / loop blocks across 57 dispatches in the session" → Logged as TASK-008 in AGENT_TASKS.md Completed (informational, no code change).
- [done 2026-04-30] "Build a system and set of instructions that will make this work really well" → Created `AGENT_INSTRUCTIONS.md`, `AGENT_TASKS.md`, and reorganized this file as a clean inbox. Logged as TASK-001.
- [done 2026-05-05] "Dispatcher fires for non-delegated tools" → `src/lib/tools/dispatch.ts` now gates handler execution on `tool_delegated` instead of `tool_started`; server-side tools no longer produce "not registered" errors.
- [done 2026-05-05] "Align client-side loop heuristic to 5" → Audited; no client-side loop detector exists (only the `max_iterations` admin-flag passthrough). Nothing to change.
- [done 2026-05-05] "Template `tl_executor` insert for new tools" → Added the executor row + full seed-block template to `docs/MATRX_EXTEND_MIGRATION_GUIDE.md` so future tool additions can't skip it.
- [done 2026-05-05] "Eliminate markdown auto-scroll once the user resists" (Task 7) → `src/features/chat/ChatView.tsx` now follows the stream only while pinned to bottom (any scroll method un-pins); switched to instant scroll to avoid smooth-scroll race.
- [done 2026-05-05] "Refresh agents button" (Task 3) → Added a refreshing icon button next to the agent picker in the chat header; re-fetches `fetchUserAgents` on click.
- [already-shipped 2026-05-05] "Notes tab" (Task 1) → Already implemented in `src/features/notes/NotesView.tsx` (list, search, folder picker, create, editor). No further work needed.



--- User Notes ---

