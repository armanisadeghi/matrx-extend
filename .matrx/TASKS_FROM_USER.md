# Tasks from User

Drop anything here — bullets, prose, half-thoughts, voice-transcribed ramblings. No format required. An agent will pick it up, structure it, and either do it now or move it to `AGENT_TASKS.md`.

**Rules of the road:** see `AGENT_INSTRUCTIONS.md`. The short version:
- Write whatever you want under `## Inbox`.
- Agents move each item to `## Processed` once handled, with a pointer to what happened.
- Anything still under `## Inbox` is unprocessed.

---

## Inbox

<!-- Write new tasks below. Anything goes. Bullets, paragraphs, links, screenshots — agents will sort it out. -->

1) Incorporate Notes (public.notes) and give the user a simple tab where they can choose from their notes, create new notes, etc.
2) Add audio recording capability to get the microphone in the input working.
    - Groq for TTS (use same settings as we already have in Next.js app)
    - Caretesia for text to speech
    - Translation that invoves speech coming out in another language (must include Spanish, French, Persian, English, Chinese, Russian)
3) Add a simple button to refresh your agents since engineers often working on editing their agent and then want to test it out and don't want to get the stale ones.
4) Video capture via MediaRecorder / chrome.tabCapture (as feature for the user and tool for assistant)
5) Guidance feature updates: Cloud sync of guidance metadata (currently local-only — only the artifact bytes go to cld_files) (Or pushed to the database, unless we're only talking about the files here)
6) Add a tab that shows all screenshots we have of the given page. Any time the agent takes a screnenshot, it's saved here and let's give the user the ability to do it as well. 
7) Eliminate markdown auto-scroll when the user resists it once. 

8) **Extension dispatcher fires for tools it doesn't handle — server tools surfacing as "not registered" errors in the trace** (logged from server-side investigation 2026-05-05)

   Repro: any conversation that calls a server-side tool (e.g. `load_browser_tools`, `ctx_get`, `ctx_patch`, MCP tools, etc.) shows two records in `cx_tl_call`:
   - The correct successful result (server-side handler ran, `result` is populated)
   - A second "error" entry with message:
     `Tool 'load_browser_tools' is not registered in this extension. Did you mean: list_browser_tools? Or call list_browser_tools to see what's available.`

   What's happening on the server side:
   - `load_browser_tools.function_path = matrx_ai.tools.implementations.browser_discovery.load_browser_tools` — runs in matrx-ai, never delegates.
   - `ctx_get.function_path = ai.tools.implementations.ctx.ctx_get` — same deal, server-side.
   - Neither tool has a `delegated=true` row in `tl_executor` (verified live against the DB).
   - Server emits the standard `tool_started` / `tool_completed` events for these so the UI can render the timeline. **It is not asking the extension to dispatch them.**

   What the extension dispatcher [src/lib/tools/dispatch.ts](file:///Users/armanisadeghi/code/matrx-extend/src/lib/tools/dispatch.ts) is doing wrong:
   - It listens for `STREAM_CHUNK → tool_started` and tries to resolve EVERY tool name against its local handler registry. When the resolution fails, it errors and posts an error result back.
   - It should only dispatch tools that target *this extension* — i.e. tools the server explicitly delegated. The marker on the wire is the existing event-payload fields the server already sets when a tool is client-delegated (`delegated: true` / `tool_started` carries a `delegate_to: 'matrx-extend.browser'` style hint). Confirm with the server team if you need the exact field name; today it reads `client_tools` / `tool_delegated` — only those should fire your dispatcher.
   - Suggested fix: in `dispatch.ts`, gate the `lookup(name)` step behind `event.delegate === true || event.delegate_target === 'matrx-extend.browser'`. If the event isn't asking you to handle it, render the timeline entry only — do NOT call lookup, do NOT post a result back.

   Impact: every server-side tool call generates a noisy "not registered" error in the trace, which (a) misleads the model into thinking real tools failed and (b) clutters the conversation log.

9) **Loop-detection tuning, FYI** (server-side change, no extension work needed)

   Server's loop-detection guardrail was firing at 3 same-tool calls; user asked for 5. Already bumped server-side. Mentioning here so if extension has its own client-side loop heuristic somewhere, it should align (5, not 3).

10) **9 new matrx-extend tools added today (2026-05-05) lacked executor rows in the DB** (`save_guidance_note`, `list_guidance`, `get_guidance_item`, `delete_guidance_item`, `record_demo`, `replay_demo`, `describe_demo`, `list_demos`, `delete_demo`). I auto-fixed by re-running the executor concretizer on the server side, so these now route correctly. No extension work needed — but: when the extension team adds new tools to the DB (via SQL seed or admin API), the seed pass must also insert `tl_executor` rows under `surface='matrx-extend.browser'` with `delegated=true, priority=50` per the redesign spec. The live-DB invariant tests in matrx-ai (`test_browser_tools_db_invariants.py`) catch this drift, but only after the fact. Consider templating the insert so it's harder to forget.


---

## Processed

<!-- Audit trail. Agents append here; never delete. Format: [done|moved YYYY-MM-DD] "<paraphrase>" → outcome -->

- [done 2026-04-30] "Build a system and set of instructions that will make this work really well" → Created `AGENT_INSTRUCTIONS.md`, `AGENT_TASKS.md`, and reorganized this file as a clean inbox. Logged as TASK-001.



--- User Notes ---

