# Conversation plans and tasks

## Runtime contract

The Chat and Pilot surfaces each own exactly one `useListsSubscriber` call while their tab is visible. `TaskPanel` and `TaskPanelChip` are renderers over the shared Zustand state; they must never create their own subscriptions.

Each active conversation owns one Supabase Realtime channel named `chat-agent-task:{conversationId}`. The channel registers a single `postgres_changes` callback with `event: '*'` before `subscribe()` and refreshes the task slice after inserts, updates, or deletes.

This ordering is load-bearing. Supabase rejects callbacks added after `subscribe()`, and duplicate subscribers previously crashed the first guest Chat turn inside the panel error boundary.

## Change log

- 2026-08-17 — Moved subscription ownership to Chat/Pilot, removed duplicate subscriptions from the panel and chip, and collapsed three task-table callbacks into one pre-subscribe wildcard callback.
