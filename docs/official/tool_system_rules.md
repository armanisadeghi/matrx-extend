# Tool System Rules — MOVED (this was a stale mirror)

> **The canonical doc is [`/Users/armanisadeghi/code/aidream/docs/official/tool_system_rules.md`](../../../aidream/docs/official/tool_system_rules.md).**
> aidream owns the tool-system schema and its rules. Read it there. Do not
> re-copy it here.

## Why this file is a stub

Until 2026-08-09 this path held a **verbatim copy** of aidream's doc, taken
2026-05-27 and never updated. aidream's grew to 388 lines; the copy stayed at
257. Anything reading this path got a frozen snapshot that was missing:

- **S11** — tool naming and description conventions.
- **Part 5.5** — request-time toolset resolution and injection precedence.
- The **2026-07-26** consolidation (which absorbed `TOOL_ROUTING_RULES.md` and
  `TOOL_NAMING.md`, both since archived).
- The **2026-08-09 vocabulary hardening** — *registered* vs *inline* tools,
  **Arming**, R16, R17, and the correction of the false claim that the database
  is the only source of truth for tools.

A stale mirror is worse than no doc. Every agent working in this repo treats
these words as spec, so a frozen copy silently teaches a vocabulary the platform
has already moved past — which is precisely the drift the 2026-08-09 ruling
exists to stop.

## The vocabulary, in one screen

Copy this from the canonical doc verbatim when you need it; do not paraphrase.

| Term | Means | Lives in |
|---|---|---|
| **Tool** | A named, versioned contract | `tool.definition` (registered) or the request (inline) |
| **Registered tool** | A tool with a durable `tool.definition` row | `tool.definition` |
| **Inline tool** | Declared on the request, no DB row — for tools authored at runtime. **Permanently supported** | the request |
| **Executor** | An addressable runtime that can dispatch tool calls | `tool.executor` |
| **Binding** | This executor can run this tool. Nothing else, ever | `tool.binding` |
| **Client** | The application hosting surfaces | `ui.ui_client` |
| **Surface** | A page or panel within a client | `ui.ui_surface` |
| **Surface defaults** | Per-surface include/exclude rules | `tool.surface_defaults` |
| **Arming** | Turning a tool on for one conversation, at runtime, from the component holding the state it needs | request `client_tools` |
| **Bundle** | A labeled tool collection; a shortcut in surface defaults | `tool.bundle` |
| **Gate** | A boolean function deciding if a tool may run | name in `tool.definition.gating`, code in `matrx_ai.tools.gates.*` |

**Two paths to existence:** registered (durable) · inline (runtime-authored).
Both permanent. Durability decides which: *did this tool exist before the request
arrived?* No → inline. Yes → register it.

**Three questions about reach, never conflated:** *where can the code run?* →
Executor · *where is it offered?* → Surface · *is it live right now?* → Arming.

## What this repo is, in those terms

matrx-extend is the **`chrome-extension` executor** — one dispatcher
([src/lib/tools/dispatch.ts](../../src/lib/tools/dispatch.ts)), one handler
registry, ~80 active `tool.binding` rows. It hosts two **surfaces**,
`chrome-extension/assistant` and `chrome-extension/pilot`. Two panels sharing one
dispatcher are one executor with two surfaces — not two executors.

Repo-specific rules that are genuinely ours live in
[TOOL_SOURCE_OF_TRUTH.md](../TOOL_SOURCE_OF_TRUTH.md) (registered-tool contract +
drift-guard spec) and [SURFACE_INTEGRATION_TODO.md](../SURFACE_INTEGRATION_TODO.md)
(live-verified SQL for touching the registry).
