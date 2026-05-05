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


---

## Processed

<!-- Audit trail. Agents append here; never delete. Format: [done|moved YYYY-MM-DD] "<paraphrase>" → outcome -->

- [done 2026-04-30] "Build a system and set of instructions that will make this work really well" → Created `AGENT_INSTRUCTIONS.md`, `AGENT_TASKS.md`, and reorganized this file as a clean inbox. Logged as TASK-001.



--- User Notes ---

