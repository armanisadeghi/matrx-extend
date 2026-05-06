# Matrx Extend Pending Tasks

This is a place where anyone, including developers from other projects, can leave tasks for this team to complete. Once a task is complete, it must be converted into a very short sentence that simply states the task is complete and the date.

## Inbox

_(empty)_

## Completed

- **[BUG] Sidepanel re-opens previous conversation instead of starting fresh** → fixed via TASK-010. `useChatStore`'s persisted slice no longer carries `selectedConversationId`, and a `merge` hook force-nulls it on every rehydration so any older stored value is wiped on first open. Past conversations remain accessible via the chat-header history picker. 2026-05-06.
- **[BUG] Tools follow Chrome's active tab when the user switches mid-execution** → fixed via TASK-009. New `ToolContext.assignedTabId` is latched at message-send time and threaded through STREAM_START → SW dispatcher → handler ctx. All 16 handler files now route active-tab resolution through the shared `getAssignedTab` / `getAssignedTabId` helpers in `src/lib/tools/handlers/_active-tab.ts`. Falls back to the focused tab when no assignment exists (Tools tab Run button, agenda runs). 2026-05-06.
- **[BUG] `read_active_page` — handler ran in service-worker context where `document` is undefined** → fixed via TASK-006 (`src/lib/tools/handlers/read.ts` switched to `captureWithFallback` so missing content scripts auto-inject; structured failure reasons returned). 2026-05-08.
- **[BUG] `computer.action='key'` with `text='Enter'`/`'Return'` — `chrome.scripting.executeScript` args[2] unserializable** → fixed via TASK-007 (`press_keys` was passing `args.delay_ms` undefined; canonical merger bypassed Zod default. Defensive `?? 30` in `keyboard.ts` + full `PressKeysArgs` shape in `canonical.ts`). 2026-05-08.
