# Structured Extractor Agent Spec

This is the spec to give the **agent-builder** so the matrx-extend Showcase
"AI Extract" sub-tab works end-to-end.

The extension calls this agent via the existing `/ai/agent/{agent_id}` route
through `useAiExtraction` ([src/hooks/use-ai-extraction.ts](../src/hooks/use-ai-extraction.ts)).
It accumulates the streamed response text and JSON-parses it on `done`.

## Agent name

**`structured-extractor`** (or any name containing "extract" — the tab's
agent picker prefers it but falls back to the user's first agent).

## Variables

In addition to `user_input`, the extension passes these in `variables`:

| Name | Type | Description |
|---|---|---|
| `page_url` | string | URL of the page being extracted from. |
| `page_text` | string | Cleaned visible text content (≤50KB), pulled from `main`/`article`/`body`. Already stripped of script/style. |
| `page_metadata` | object | `{ description, author, lang, og, twitter, json_ld, truncated }` — already-parsed metadata so the agent doesn't re-derive it. |
| `output_schema` | object | JSON schema (subset: `{ type: "object", properties: { fieldName: { type: "string"|"number"|... } } }`) describing one row's shape. May be `{}` if the user didn't specify a schema. |

## User input

Natural-language description of what to extract:

> Every concert listing on this page — name, date, venue, ticket URL, price.

## Required response shape (JSON)

```json
{
  "rows": [
    { /* one object per extracted row, matching output_schema */ }
  ],
  "confidence": "high",
  "notes": "string — anything the user should know (optional)",
  "inferred_schema": { /* only if output_schema was empty */ }
}
```

The extension's parser also accepts:
- The whole response wrapped in a ```` ```json ... ``` ```` fence
- Leading/trailing prose (it greps the outermost `{...}` or `[...]`)
- A bare JSON array (treated as `{ rows: [...] }`)

## Behavior expectations

- **Never invent data.** If a field is missing from the page, set it to `null`
  and mention it in `notes`.
- Skip ads, navigation, footer.
- For lists with many items (>50): return the first 50 and add
  `truncated to 50` to `notes`.
- If `output_schema` is `{}`: infer it from the user's description and
  include the inferred shape in `inferred_schema`.

## Storage

Saved patterns of `kind='ai_extract'` store
`config = { description, output_schema, agent_id }` in `wbx_pattern.config`,
plus optional `target_user_table_id`. The backend cron worker re-runs them
on schedule by re-rendering the page and calling this same agent.
