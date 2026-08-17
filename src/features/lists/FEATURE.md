# Conversation plans and tasks

## Runtime contract

The Chat and Pilot surfaces each own exactly one `useListsSubscriber` call while their tab is visible. `TaskPanel` and `TaskPanelChip` are renderers over the shared Zustand state; they must never create their own subscriptions.

Each mounted active-conversation subscriber owns one Supabase Realtime channel named `chat-agent-task:{conversationId}:{subscriberInstanceId}`. The per-mount suffix is load-bearing: Supabase reuses channels by topic, while React StrictMode remounts effects before asynchronous channel removal can finish. A unique topic prevents the remount from receiving an already-subscribed channel. The conversation row filter remains authoritative.

This ordering is load-bearing. Supabase rejects callbacks added after `subscribe()`, and duplicate subscribers previously crashed the first guest Chat turn inside the panel error boundary.

## Change log

- 2026-08-17 — Moved subscription ownership to Chat/Pilot, removed duplicate subscriptions from the panel and chip, and collapsed three task-table callbacks into one pre-subscribe wildcard callback.
- 2026-08-17 — Made each effect mount's Realtime topic unique so React StrictMode cleanup/remount cannot reuse a channel that is still subscribed.
