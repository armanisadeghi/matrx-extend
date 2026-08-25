# How to add a page kind to matrx-extend (without breaking anything)

This guide is for any agent (or human) adding a new page-kind detector
or a new dynamic context bundle to the matrx-extend Surface. Follow the
pattern and you cannot break the existing system; deviate and you can
silently corrupt every prompt that references existing keys.

If you only read three sentences:

1. **Keys are public API.** Engineers template `{{key}}` and `{{key.subkey}}`
   into their prompts. Adding is safe; renaming, removing, or changing the
   shape of an existing key is a breaking change.
2. **Add new files, don't edit the probe lightly.** Detection lives in a
   new file (`detect-<thing>.ts` or similar); v2-bundled wires it in
   alongside the existing parallel set.
3. **Confidence-gate everything.** A bundle that's wrong is worse than no
   bundle. Return `null` rather than guess.

---

## Where to look for what's next

Three sources of truth, in priority order:

1. **[`.research/page-kinds-roadmap.md`](../.research/page-kinds-roadmap.md)** —
   the canonical catalog. Items marked 🔨 (quick win), 📋 (planned), or
   🔮 (future). Pick from there. Snapshot at top tells you what's already
   ✅. The roadmap is also a reasoning surface — open it, write down a new
   page kind, propose it for the next sprint.
2. **[`.research/2026-04-30-browser-agent-frontier.md`](../.research/2026-04-30-browser-agent-frontier.md)** —
   competitive intelligence and capability gaps. Shows what other harnesses
   surface that we don't.
3. **The chat itself** — when an agent struggles ("I had to call read_page
   four times to figure out…"), that's a signal a bundle is missing. The
   answer is usually a new context key, not a new tool.

---

## The pattern (read this once, follow it forever)

### Step 1 — Decide what kind of contribution this is

Three flavors of contribution, in order of how often you'll do them:

| Flavor | When to use it | Example |
|---|---|---|
| **Per-kind dynamic bundle** | Add data the agent needs only on certain pages | `pull_request`, `email_inbox`, `ticket` |
| **Cross-cutting field on `page_brief`** | A signal that applies to *every* page | Banner inventory, page-ready, dismissibles |
| **New on-demand context key** | Always-available, server fetches by name | `page_seo_audit`, `page_full_content` |

Most new work is the first. The questions to ask yourself:

- Does this matter on every page? → cross-cutting
- Does this matter only when X? → per-kind dynamic
- Is this a category of the existing scrape data? → on-demand

### Step 2 — Create your detector file

Naming convention:

- `src/lib/chat/context/detect-<thing>.ts` for per-kind detectors
- `src/lib/chat/context/check-<thing>.ts` for cross-cutting signals
- `src/lib/chat/context/discover-<thing>.ts` when the data is "all the X
  on this page" (forms, links, etc.)

Boilerplate:

```ts
// src/lib/chat/context/detect-foo.ts
import { log } from '@/lib/debug/log';

export interface FooBundle {
  // Be opinionated about the shape. Big rich values beat shallow keys.
  // ALWAYS bundle by mental concept, never by source-system structure.
}

const FOO_URL_RE = /^https?:\/\/(?:www\.)?example\.com\/...$/;

/** Cheap URL-gate so we don't run heavy work where it doesn't apply. */
export function isFooUrl(url: string): boolean {
  return FOO_URL_RE.test(url);
}

export async function detectFoo(
  tabId: number,
  url: string,
): Promise<FooBundle | null> {
  if (!isFooUrl(url)) return null;
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (): FooBundle | null => {
        // Synchronous DOM walk inside the page context.
        // Return null gracefully if the page didn't match expectations.
      },
    });
    return (first?.result as FooBundle | null) ?? null;
  } catch (err) {
    log.warn('scrape', 'detectFoo failed', err);
    return null;  // never throw — context build must always succeed
  }
}
```

### Step 3 — Wire it into the v2 builder

Open [`src/lib/chat/context/v2-bundled.ts`](../src/lib/chat/context/v2-bundled.ts).

1. Import `detectFoo` and `isFooUrl`.
2. Add it to the parallel `Promise.all` block — it should fire
   simultaneously with the probe and other detectors, never sequentially.
3. Attach the result as a context key in the dynamic-keys section, only
   when the detector returned non-null.

```ts
// In the imports
import { detectFoo, isFooUrl } from './detect-foo';

// In the parallel block
const tasks = tabId !== null
  ? Promise.all([
      probeActivePage(tabId),
      // ...existing detectors...
      isFooUrl(url) ? detectFoo(tabId, url) : Promise.resolve(null),
    ])
  : Promise.resolve([null, ..., null] as const);
const [probe, ..., foo] = await tasks;

// In the dynamic-keys section
if (foo) {
  ctx.foo = foo;  // ← key name = file's primary export
}
```

### Step 4 — Update the kind enum (if applicable)

Only if your detector is a new `kind` for `page_brief.kind`:

1. Add the literal to the union in
   [`src/lib/chat/context/probe.ts`](../src/lib/chat/context/probe.ts) under
   `BriefBlock.kind`.
2. Add detection logic to the kind cascade in the same file.
3. The v1-flat builder doesn't need updating; it uses a separate flow.

If your detector is just a dynamic bundle, **don't touch `kind`**. The
bundle itself signals presence.

### Step 5 — Update the key catalog in /Users/armanisadeghi/code/common-docs/systems/clients/extension/WIRE_CONTRACT.md

In /Users/armanisadeghi/code/common-docs/systems/clients/extension/WIRE_CONTRACT.md §2, find the conditional-keys table and add
your key under the right section:

- "Always-attached" if every page gets it
- "Available on demand" if it's part of the menu but not auto-loaded
- "Dynamic" if it's only attached when detected

For dynamic keys, write one sentence on what triggers attachment.

### Step 6 — Update the roadmap

In [`.research/page-kinds-roadmap.md`](../.research/page-kinds-roadmap.md):

- Find the matching entry (or add one if your kind isn't listed).
- Flip the status from 📋/🔨/🔮 to ✅.
- Document the shipped shape inline.
- Link to the file you created.
- Update the snapshot section at the top.

### Step 7 — Test on a real page

1. Reload the extension (`chrome://extensions` → reload).
2. Open a page that should match your detector.
3. Open the sidepanel chat and submit any message.
4. Check the **Debug tab** — the context-build log line shows the keys
   that were sent.
5. Flip to v1-flat in the Debug tab "context" dropdown to compare.

---

## Conventions you must follow

### Bundling

- **Bundle by mental concept, not by source system.** "user identity"
  becomes one `user` key, not three (`user_id`, `user_email`,
  `user_full_name`).
- **One source of truth per fact.** Title in `page_brief.title`,
  nowhere else. Don't duplicate; the model gets confused and the
  payload bloats.
- **Big rich values are encouraged.** A 4KB SEO audit costs the same in
  the model's advertised-keys menu as a 20-byte field.
- **No shallow keys for empty things.** `images_count: 0` is the
  anti-pattern. Counts go inside their bundle, never as standalone keys.

### Detection

- **URL-gate per-domain detectors.** The v2 builder must not run a Gmail
  scraper on github.com. Pre-check URL with a regex and resolve to `null`
  fast. Saves an executeScript round trip on every irrelevant page.
- **Run in parallel.** All detectors fire from the same `Promise.all`.
  Total chat-send latency is the slowest detector, not the sum.
- **Confidence-gated content.** Add a confidence field. When confidence
  is low (CAPTCHA, blocked, partial scrape), drop the heavy fields. Better
  to send less than to mislead.
- **Never throw from a detector.** Return `null` on any failure. Context
  build must always succeed.

### DOM scraping

- **Selectors break.** Lean on roles + aria-labels first, classes only
  if there's no alternative. When you must use class names, prefer ones
  that look semantic (`data-testid`, `data-tagsearch-path`) over hashes
  (`.x1n2onr6`).
- **Cap output sizes.** Return at most ~30 items in any list. Truncate
  text to 200–400 chars. The agent can drill in via tools.
- **Stable IDs over refs.** When refs would recycle (virtualized scroll),
  prefer URL-derived or id-attribute identifiers.

### Naming

- **Keys are forever.** Once a key ships, renaming it breaks every prompt
  that templated `{{key}}`. Pick names you'll still like in a year.
- **Snake case for keys.** `page_brief`, not `pageBrief` or `page-brief`.
- **Singular for single bundles, plural for collections.** `pull_request`
  (singular), `email_thread` (singular conversation),
  `email_inbox.threads` (plural inside a singular bundle).
- **Match the file name.** `detect-pull-request.ts` exports the bundle
  named `pull_request`.

### What NOT to do

- Don't add a new tool when a context key would do. Tools cost full
  schema in every prompt; keys cost one menu line.
- Don't move data out of context to "save tokens" — the menu cost is
  the same and you've made the data harder to template.
- Don't edit `v1-flat.ts` for new features. It's frozen; new work goes
  in v2.
- Don't extend the probe with per-domain logic. Site-specific detectors
  belong in their own files.
- Don't break sample fixtures. Run any sample-based tests; if a key's
  shape changed, update the sample (and call it out explicitly — it's
  a breaking change).
- Don't add `_count` suffix keys. If a count matters, put it inside the
  bundle.

---

## Anti-patterns we've already lived through

| Anti-pattern | What broke | What we do now |
|---|---|---|
| 65 flat keys with massive duplication | Title appeared 5 times; OG image URL × 4 | Bundled into `page_brief` + `page_meta`. v1-flat preserved as toggle. |
| `images_count: 0` standalone keys | Wasted menu space; model confused by emptiness | Counts live inside bundles, only when > 0. |
| `chrome.scripting.executeScript({args: [undefined]})` | Chrome rejected entire call: `Value is unserializable` | Coerce undefined to null at call site; type inner func params as `string \| null`. |
| Warm-session optimization without feature detection | Doubled work on Chromes without `clone()` | Plain create+destroy until we have proper detection. |
| Cache TTL too short | `find` re-ran `read_page` every time agent paused to think | 60s TTL + URL-change invalidation. |
| Single probe doing more and more | Heavy walks on every chat send | Parallel detectors via `Promise.all`. |

---

## Examples to learn from (live in the repo)

| Pattern | File |
|---|---|
| Cross-cutting field on `page_brief` | [`check-page-ready.ts`](../src/lib/chat/context/check-page-ready.ts) |
| Per-domain detector (single provider) | [`detect-pull-request.ts`](../src/lib/chat/context/detect-pull-request.ts) |
| Per-domain detector (multi-provider routing) | [`detect-email.ts`](../src/lib/chat/context/detect-email.ts) |
| Inventory across the page | [`discover-forms.ts`](../src/lib/chat/context/discover-forms.ts) |
| Embedded inside the probe | [`probe.ts`](../src/lib/chat/context/probe.ts) — dismissibles, result_list |

When in doubt, copy the closest one and rename. The conventions are
already baked in.

---

## When you ship something new

Reply with:

- A 1-sentence summary of what was added
- The new file path(s)
- The key name(s) attached to context
- A link to the roadmap entry you flipped to ✅
- Whether you updated /Users/armanisadeghi/code/common-docs/systems/clients/extension/WIRE_CONTRACT.md
