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

## Inbox

<!-- Write new tasks below. Anything goes. Bullets, paragraphs, links, screenshots — agents will sort it out. -->

2) Add audio recording capability to get the microphone in the input working.
    - Groq for TTS (use same settings as we already have in Next.js app)
    - Caretesia for text to speech
    - Translation that invoves speech coming out in another language (must include Spanish, French, Persian, English, Chinese, Russian)
4) Video capture via MediaRecorder / chrome.tabCapture (as feature for the user and tool for assistant)
5) Guidance feature updates: Cloud sync of guidance metadata (currently local-only — only the artifact bytes go to cld_files) (Or pushed to the database, unless we're only talking about the files here)
6) Add a tab that shows all screenshots we have of the given page. Any time the agent takes a screnenshot, it's saved here and let's give the user the ability to do it as well. 

---

## Processed

<!-- Audit trail. Agents append here; never delete. Format: [done|moved YYYY-MM-DD] "<paraphrase>" → outcome -->

- [done 2026-04-30] "Build a system and set of instructions that will make this work really well" → Created `AGENT_INSTRUCTIONS.md`, `AGENT_TASKS.md`, and reorganized this file as a clean inbox. Logged as TASK-001.
- [done 2026-05-05] "Dispatcher fires for non-delegated tools" → `src/lib/tools/dispatch.ts` now gates handler execution on `tool_delegated` instead of `tool_started`; server-side tools no longer produce "not registered" errors.
- [done 2026-05-05] "Align client-side loop heuristic to 5" → Audited; no client-side loop detector exists (only the `max_iterations` admin-flag passthrough). Nothing to change.
- [done 2026-05-05] "Template `tl_executor` insert for new tools" → Added the executor row + full seed-block template to `docs/MATRX_EXTEND_MIGRATION_GUIDE.md` so future tool additions can't skip it.
- [done 2026-05-05] "Eliminate markdown auto-scroll once the user resists" (Task 7) → `src/features/chat/ChatView.tsx` now follows the stream only while pinned to bottom (any scroll method un-pins); switched to instant scroll to avoid smooth-scroll race.
- [done 2026-05-05] "Refresh agents button" (Task 3) → Added a refreshing icon button next to the agent picker in the chat header; re-fetches `fetchUserAgents` on click.
- [already-shipped 2026-05-05] "Notes tab" (Task 1) → Already implemented in `src/features/notes/NotesView.tsx` (list, search, folder picker, create, editor). No further work needed.



--- User Notes ---

