# matrx-extend-tool-display — CustomComponent

## The CustomComponent escape hatch

When the config isn't expressive enough — e.g. you want a chart, a comparison view, or per-tool interactive elements — pass a full React component:

```tsx
import type { ToolTimelineEntry } from '../ToolTimelineRow';

function MyTool({ entry, kind }: { entry: ToolTimelineEntry; kind: 'server' | 'client' }) {
  // entry.args, entry.output, entry.phase, entry.startedAt, etc.
  return <div className="rounded-md border bg-card/60 p-2">…your UI…</div>;
}

// in registry.tsx:
my_tool: { CustomComponent: MyTool }
```

When `CustomComponent` is set, `inline`/`args`/`results` config is **ignored** — your component owns the entire visual. If your component throws on render, `ToolDisplayBoundary` catches it and the row falls back to the default rendering (with a console warning).

You're responsible for the outer card / styling — match `kind === 'server'` vs `kind === 'client'` if you want surface consistency. See `ConfigurableToolRow` for examples of the existing card classes.

## When to reach for `CustomComponent`

The config-driven path covers ~90% of tools. Use `CustomComponent` when the tool needs **interactive** UI — not just a richer display, but inputs the user fills in and submits. Examples:

- **`interaction_ask`** — server-side multi-question questionnaire (radio + toggle inputs). The args carry the spec; the card renders the form, collects answers, and posts them back as a regular user chat message via `useChatStream().send()`. Submission state is persisted per `callId` in a small Zustand store inside the card so the form doesn't reappear after scrolling away. See [InteractionAskCard.tsx](../../../src/features/chat/tool-display/InteractionAskCard.tsx) as the reference implementation for "tool that asks for input".

The pattern for "answer goes back to the agent" tools without a dedicated SSE response channel: format the answer as a chat message and `void send(text, { agentId, conversationId })`. The next agent turn sees it like any other user message.
