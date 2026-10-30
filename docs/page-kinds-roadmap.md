# Page Kinds Roadmap

> Working catalog of page types we want to detect + the dynamic context
> bundles we'd attach for each. Not all need to ship now — the value of
> the list is so we *recognize* them when they show up and have a plan.
>
> Status legend: ✅ shipped · 🔨 quick win (implementable today) ·
> 📋 planned · 🔮 future / bigger lift
>
> **How to add a new kind without breaking anything:** see the build guide
> at [`docs/build-page-kind.md`](../docs/build-page-kind.md).

---

## 0. Snapshot of what's shipped

Cross-cutting infrastructure (everywhere):
- ✅ §2.1 Banner / modal inventory (`page_dismissibles`)
- ✅ §2.2 Form schema extractor (`form_elements`)
- ✅ §2.3 Auth state surface (`auth_state`)
- ✅ §2.4 Page-ready signal (`page_brief.snapshot.ready`)
- ✅ §2.5 Per-domain memory (`domain_memo` + `remember_for_domain` tool)

Per-kind detection + bundles:
- ✅ §3.1 `article` (`article_summary`)
- ✅ §3.2 `documentation`
- ✅ §3.3 `product` (`product_data`)
- ✅ §3.4 `product-listing` / `search-results` (`result_list`)
- ✅ §3.5 `form` (paired with `form_elements`)
- ✅ §3.8 `login-wall`
- ✅ §3.9 `inbox-list` Gmail (`email_inbox`)
- ✅ §3.10 `email-thread` Gmail (`email_thread`)
- ✅ §3.13 `code-review-pr` GitHub + GitLab (`pull_request`)
- ✅ §3.14 `ticket` GitHub Issues + Linear + Jira (`ticket`)
- ✅ §3.15 `error-page` · §3.16 `captcha` · §3.17 `spa-empty`

Failure / blocker detection: captcha, login-wall, paywall, consent-overlay,
age-gate, spa-empty, error-page, plus flags for `not_ready` and
`bot_challenge_or_block`.

Total v2 keys live: **15** always-loaded + on-demand, plus dynamic ones
that fire only when relevant (`pull_request`, `email_inbox`,
`email_thread`, `ticket`, `domain_memo`, `auth_state`, `article_summary`,
`product_data`, `page_dismissibles`, `result_list`, `form_elements`).

---

## 1. What the field tells us (Q1–Q2 2026)

Research data on real browser-agent usage in production today:

**Top user workloads, ranked by observed demand:**
1. **Multi-source research synthesis** — 5–20 tabs, cited summary. Comet,
   ChatGPT Atlas, Claude Computer Use, Manus all converge here. Implies
   we win big on `article`, `documentation`, `search-results`,
   `product-listing`.
2. **Cross-portal form filling** — insurance, procurement, healthcare
   eligibility. Skyvern's moat. **Highest documented ROI** — 30–50% cost
   reductions, 99%+ accuracy. Implies `form`, `multi-step-form`,
   `checkout`, plus per-domain memory.
3. **Personal admin (email + calendar)** — Comet's headline workflow,
   Atlas Agent Mode. Implies `inbox-list`, `email-thread`, `calendar-view`.
4. **E-commerce ordering and price comparison** — Operator's flagship.
   Implies `product-page`, `product-listing`, `cart`, `checkout`.
5. **QA / web testing** — devs use agents instead of writing Playwright.
   Implies stable refs, `console-stream`, `page-ready` signal.
6. **Document/data extraction from sites without APIs** — invoices,
   government forms, statements. Implies form-schema extraction +
   table/list row stable IDs.
7. **Content publishing into web apps** — Slides, Notion, CMSes.
   Implies `document-editor`, `presentation-editor`.

**Universal failure modes (from BrowserArena NeurIPS 2025 + Kahana 2026):**
- CAPTCHAs / bot challenges (we detect ✅)
- Pop-up banner removal (every major agent struggles — biggest gap)
- Login walls + 2FA / payment (we detect ✅, all majors hand off)
- Nested conditional forms (Atlas + Dia broken)
- Heavy SPAs with lazy content (we detect ✅, need page-ready signal)
- Infinite scroll / virtualized lists (refs get recycled by react-window)
- Iframes / shadow DOM
- Geo / IP blocks (Cloudflare, PerimeterX, DataDome)
- Hallucinated elements when stuck (model behavior, not detection)

**What top harnesses surface beyond raw DOM:**
- Accessibility tree with stable refs (we have ✅ via `read_page`)
- Set-of-Marks overlays on screenshots (vision support)
- Form schema with field types, validation, error messages
- Stable table/list row identifiers
- Thread/conversation structure (email, chat, calendar)
- Page semantic type classification (we have ✅ basic — `kind`)
- Network-idle / page-ready signal
- Banner/modal inventory with close-button refs
- Auth state per domain
- Console / error stream
- Per-domain memory (Skyvern's moat)

---

## 2. Cross-cutting infrastructure (build BEFORE per-kind logic)

These pay off across MANY page types. Higher leverage than any single
kind detector.

### 2.1 ✅ Banner/modal inventory

**Why:** BrowserArena's #2 universal failure mode. Every agent fights
cookie banners, newsletter modals, app-install prompts.

**Bundle: `page_dismissibles`** ✅ shipped — populated by the probe;
attached to context only when count > 0.
```
{
  count,
  items: [
    { kind: "consent" | "newsletter" | "app-install" | "paywall" |
            "age-gate" | "modal",
      text_excerpt: "...",
      close_selector: "...",   // CSS selector for the close button
      close_label: "Close" }
  ]
}
```

### 2.2 ✅ Form schema extractor

**Why:** highest-ROI workflow category. Agents shouldn't have to call
`get_form_fields` for the obvious case.

**Bundle: `form_elements`** ✅ shipped — runs in parallel with the page
probe; chrome-only forms (header search) are skipped unless they're the
only form.
```
{
  count,
  forms: [
    { selector, id, action, method, in_main, submit_selector,
      field_count, fields: [
        { selector, name, id, type, tag, label, placeholder,
          current_value, required, disabled,
          validation: { pattern, min_length, max_length, min, max,
                        autocomplete },
          error_message,
          options?: [{ value, label, selected }]   // for select / radio
        }
      ]
    }
  ]
}
```

### 2.3 ✅ Auth state surface

**Why:** universal "hand off on login" failure. Saves a turn per session.

**Bundle: `auth_state`** ✅ shipped — DOM-heuristic (no cookie access).
```
{
  domain,
  signed_in: "yes" | "likely" | "no" | "unknown",
  user_chip: string | null,         // visible username when extractable
  signals: {
    sign_out_link, profile_chip, avatar_image,
    sign_in_cta, login_form_visible,
  }
}
```
File: [`src/lib/chat/context/check-auth-state.ts`](../src/lib/chat/context/check-auth-state.ts)

### 2.4 ✅ Page-ready signal

**Why:** screenshots + reads firing mid-render produce false negatives
(QA/testing use case + lazy-load failure mode).

**Bundle: extends `page_brief.snapshot`** ✅ shipped — runs a 300ms
MutationObserver alongside the probe, plus instant signals.
```
ready: {
  document: "loading" | "interactive" | "complete",
  observed_idle: boolean,        // mutations < 10 + no skeletons + no images
  mutation_count: number,        // observed during 300ms window
  loading_indicators: number,    // skeletons / spinners / aria-busy
  pending_images: number,        // <img> still loading (non-lazy)
  load_event_ms: number          // 0 = load not yet fired
}
```
File: [`src/lib/chat/context/check-page-ready.ts`](../src/lib/chat/context/check-page-ready.ts)

### 2.5 ✅ Per-domain memory

**Why:** Skyvern's moat in miniature. Compounds across all sessions —
the agent's first turn on a domain it's seen before is already smarter.

**Bundle: `domain_memo`** ✅ shipped — surfaced when a memo exists for
the current domain (parent-domain memos auto-apply to subdomains).
**Tool: `remember_for_domain`** ✅ shipped — agent writes via this tool
whenever it learns something worth remembering.
```
{ domain, notes: ["..."], hints: { ... }, last_updated }
```
File: [`src/lib/chat/context/domain-memo.ts`](../src/lib/chat/context/domain-memo.ts) +
[`src/lib/tools/handlers/memory.ts`](../src/lib/tools/handlers/memory.ts)

### 2.6 🔮 Console / error stream

**Why:** SPA failures invisible to DOM scanning. Already have
`read_console_messages` (CDP, admin) — surface counts + last error in the
brief without requiring CDP.

**Bundle: `client.viewport.recent_errors_count`** + an on-demand tool
expansion. Keep cheap — full messages are large.

### 2.7 🔮 Set-of-Marks overlays

**Why:** vision-model planning. Numbered boxes on screenshots so the
model says "click 7" reliably for canvas / shadow-DOM / custom controls.

Bigger lift — needs screenshot post-processing. Defer.

---

## 3. Per-kind catalog

For each kind: detection signals (deterministic, no Nano), the dynamic
context bundle we'd attach when detected, status, notes.

### Tier 1 — build today / very soon (matches highest-demand workflows)

#### 3.1 ✅ `article` — long-form content
- Already detected (`<article>` or schema.org/Article + main text >1500 chars)
- **Bundle: `article_summary`** ✅ shipped (title, byline, excerpt)
- Notes: research synthesis is #1 workload — this kind is HOT.

#### 3.2 ✅ `documentation` — technical docs
- Already detected (`<pre>/<code>` count + `<nav>`)
- **Bundle to add 🔨: `doc_outline`** — TOC structure with anchor refs,
  code-block languages summary, cross-link counts.
- Notes: tightens research synthesis on dev-doc sites (which is most of
  what devs ask agents about).

#### 3.3 ✅ `product` — single product page
- Already detected (schema.org/Product or Offer)
- **Bundle to add 🔨: `product_data`** — partially shipped (lifts JSON-LD
  block). Extend to also extract: `price`, `availability`, `rating`,
  `review_count`, `variants` (size/color), `add_to_cart_ref`,
  `buy_now_ref`. Fall back to common selectors when no schema.
- Notes: Operator's flagship workflow. Pure leverage.

#### 3.4 ✅ `product-listing` / `search-results`
- Detection ✅ — kind detector now distinguishes `product-listing`
  (≥50% items have prices) from `search-results` (URL has `?q=`/`/search`
  or `[role="search"]` exists).
- **Bundle: `result_list`** ✅ shipped — populated by the probe whenever
  ≥5 similar siblings with link anchors are found in main, regardless of
  kind. URL is the stable per-item identifier.
  ```
  { count, items: [{ title, url, price, rating, image_alt }] }
  ```
- Notes: virtualized scroll handled by URL-as-ID. Common shopping +
  search workflow.

#### 3.5 ✅ `form` — generic form (extend with §2.2 schema)
- Already detected (single form, ≥3 inputs, in main area)
- **Bundle: `form_elements`** 🔨 quick win — see §2.2.
- Notes: highest documented ROI in the field. Land this.

#### 3.6 🔨 `multi-step-form` / `wizard`
- Detect: stepper/progress indicators (`role="progressbar"`,
  `aria-current="step"`, repeated `[data-step]`), "Next"/"Continue"
  buttons, conditional reveal patterns.
- **Bundle: `wizard_state`**
  ```
  { steps: [{ index, label, completed }], current_step, total_steps }
  ```
- Notes: directly attacks "nested conditional forms" failure (Atlas + Dia
  broken). Insurance/healthcare/procurement workflows.

#### 3.7 🔨 `checkout` — high-stakes form
- Detect: form contains password OR credit-card-like fields (`autocomplete`
  values matching `cc-*`), URL contains `/checkout` or `/cart/checkout`,
  presence of "Place Order"/"Pay" button.
- **Bundle: `checkout_state`** — order summary (line items, subtotal,
  total), payment-form schema, shipping-form schema, confirmation-cta ref.
- Notes: high-stakes — `confidence: "partial"` by default until 2FA/SCA
  signals resolve. Hand off on payment step (universal pattern).

#### 3.8 ✅ `login-wall` (already detected)
- Already detected, dropped from `structure`/`content` at low confidence.
- **Bundle to add 📋: `login_form`** — provider buttons (Sign in with
  Google/GitHub/etc.), email field, password field, "forgot password"
  link, OAuth detection.
- Notes: agent should `request_user_takeover` if no autofill source.

#### 3.9 ✅ `inbox-list` (Gmail) · 📋 Outlook / Hey / Superhuman
- Detection ✅ — domain check + presence of `tr.zA` rows.
- **Bundle: `email_inbox`** ✅ shipped — Gmail.
  ```
  { shape: "inbox", provider: "gmail", view, unread_count,
    threads: [{ sender, subject, excerpt, time, unread, has_attachment,
                thread_id }] }
  ```
- Outlook / Hey / Superhuman: provider routing is in place; rich
  extraction is TODO. Each app has its own DOM dialect.
  File: [`src/lib/chat/context/detect-email.ts`](../src/lib/chat/context/detect-email.ts)

#### 3.10 ✅ `email-thread` (Gmail) · 📋 Outlook / Hey / Superhuman
- Detection ✅ — Gmail hash route pattern (`#inbox/MSG`).
- **Bundle: `email_thread`** ✅ shipped — Gmail.
  ```
  { shape: "thread", provider: "gmail", subject, participants: [...],
    messages: [{ from, time, body_excerpt }] }
  ```
  File: [`src/lib/chat/context/detect-email.ts`](../src/lib/chat/context/detect-email.ts)

#### 3.11 🔨 `calendar-view` (Google Calendar / Outlook / Cal.com)
- Detect: domain + visible time-grid (rows of time labels), event blocks
  with positioning that reflects time slots.
- **Bundle: `calendar`**
  ```
  { provider, view: "day"|"week"|"month", visible_range: {start, end},
    events: [{ ref, title, start, end, attendees?, location? }] }
  ```
- Notes: Comet's other signature workflow. Pairs with inbox for the
  "schedule a meeting" loop.

#### 3.12 🔨 `chat-thread` (Slack / Discord / Teams / WhatsApp Web)
- Detect: domain + repeated message-row pattern (avatar + name + body +
  time), input box at bottom with `contenteditable` or message field,
  channel/conversation header.
- **Bundle: `chat_thread`**
  ```
  { app, channel_or_dm: "...", messages: [
    { ref, author, time, body_excerpt, has_thread, reactions? }
  ], compose_ref }
  ```

#### 3.13 ✅ `code-review-pr` (GitHub / GitLab PR)
- Detection ✅ — URL match `github.com/{owner}/{repo}/pull/{N}` or
  `gitlab.com/.../merge_requests/{N}`.
- **Bundle: `pull_request`** ✅ shipped — provider-aware scraper (GitHub
  full, GitLab partial). Surfaces:
  ```
  { provider, url, repo, pr_number,
    title, author, state, base_branch, head_branch,
    files_changed, additions, deletions,
    top_files: [{ path, additions, deletions }],   // sorted by churn, when on Files tab
    review_summary: { approvals, comments, requested_changes },
    on_files_tab: boolean }
  ```
- Notes: dev workflow #1. GitLab pass is light — extend later.
  File: [`src/lib/chat/context/detect-pull-request.ts`](../src/lib/chat/context/detect-pull-request.ts)

#### 3.14 ✅ `ticket` / `issue-tracker` — GitHub Issues + Linear + Jira
- Detection ✅ — URL match for `github.com/.../issues/N`,
  `linear.app/.../issue/KEY`, `*.atlassian.net/browse/KEY`.
- **Bundle: `ticket`** ✅ shipped.
  ```
  { provider, url, key, title, state, priority, assignee, reporter,
    labels, description_excerpt, comments_count,
    related: [{ key, title, url }] }
  ```
- Notes: `Asana` is the obvious next provider to add.
  File: [`src/lib/chat/context/detect-ticket.ts`](../src/lib/chat/context/detect-ticket.ts)

#### 3.15 ✅ `error-page` / `4xx`/`5xx` (already detected)
- Already detected.
- **Bundle to add 📋: `error_state`** — status, retry strategy hint
  (rate-limit cooldown via Retry-After header if available via CDP).

#### 3.16 ✅ `captcha` / `bot-challenge` (already detected)
- Already detected, dropped to `confidence: "low"`.
- Notes: directly addresses BrowserArena failure mode #1. Agent should
  call `request_user_takeover` immediately rather than burn tokens.

#### 3.17 ✅ `spa-empty` (already detected)
- Already detected.
- Notes: pair with §2.4 page-ready signal so we wait for hydration.

---

### Tier 2 — common but not top demand

#### 3.18 📋 `landing-page` (marketing / product home)
- Detect: large hero image + CTA-heavy layout + minimal article content +
  often `<section>`-heavy structure.
- **Bundle: `landing_page`** — hero text, primary CTA, secondary CTAs,
  feature list, social proof block.

#### 3.19 📋 `dashboard` / `analytics`
- Detect: many `<canvas>`/SVG charts, metric cards (large numbers in
  cards), tabular data alongside.
- **Bundle: `dashboard`** — list of detected charts (titles), metric
  cards (label + value), filters / date-range.
- Notes: charts unreadable to text models — surface the labels at minimum.
  Vision tools (`take_screenshot` + `ai_describe_image`) close the gap.

#### 3.20 📋 `spreadsheet` (Google Sheets / Airtable / Excel Web)
- Detect: domain + presence of cell grid (canvas-rendered or
  many-cells DOM).
- **Bundle: `spreadsheet`** — sheet name, visible range, column headers,
  selected cell. Heavy — large sheets need careful scoping.
- Notes: big lift. Most agents fail here.

#### 3.21 📋 `document-editor` (Google Docs / Notion / Quip)
- Detect: domain + `contenteditable` body + toolbar with formatting
  buttons.
- **Bundle: `document_editor`** — title, current cursor location (heading
  context), word count, toolbar refs (bold/italic/heading/list/insert).

#### 3.22 📋 `file-browser` (Drive / Dropbox / OneDrive / SharePoint)
- Detect: domain + grid/list of file rows with name + modified-date +
  size.
- **Bundle: `file_listing`** — current path, files: [{ ref, name, type,
  modified, size }], breadcrumb.

#### 3.23 📋 `video-watch` (YouTube / Vimeo / Twitch)
- Detect: domain + `<video>` element + transcript/chapter sidebar.
- **Bundle: `video`** — title, channel, duration, current_time, chapters
  if available, transcript availability flag.

#### 3.24 📋 `map` (Google/Apple Maps + map-based search)
- Detect: domain + `<canvas>` or large iframe + result-list pattern.
- **Bundle: `map_search`** — query, visible_results: [{ name, address,
  rating, ref }], current view bounds if extractable.

#### 3.25 📋 `booking-flow` (Booking.com / Airbnb / Expedia / OpenTable)
- Detect: domain + multi-step pattern + date/guest/room pickers.
- Effectively a typed `multi-step-form` with hotel/flight/restaurant
  schema. Could specialize per provider with per-domain memory.

#### 3.26 📋 `forum-thread` (Reddit / HN / Discourse / Stack Overflow)
- Detect: domain + nested-comment structure with vote/score elements.
- **Bundle: `forum_thread`** — title, original_post (author, body, score),
  top_comments (nested tree, capped depth + count).

---

### Tier 3 — niche or bigger lift

#### 3.27 🔮 `social-feed` (Twitter/X / LinkedIn / Threads / Mastodon)
- Detect: domain + virtualized list of post cards.
- Notes: virtualized scroll is a known failure point — refs recycle.
  Need stable post-IDs (URL-derived).

#### 3.28 🔮 `social-profile` / `social-post`
- Detect: profile route or post route on social domains.
- Bundle: profile metadata, recent posts, post + thread replies.

#### 3.29 🔮 `wiki` / `knowledge-base` (Confluence / Notion / GitBook)
- Detect: domain + page-tree sidebar + heading-heavy article body.
- Bundle: `wiki_page` — page tree position, this page's outline, related
  pages.

#### 3.30 🔮 `banking-dashboard` / `transaction-list`
- Detect: heuristic banking domains + currency-formatted columns.
- Notes: high-stakes; agent should default to read-only and require
  explicit user takeover for any action.

#### 3.31 🔮 `presentation-editor` (Slides / Pitch / Canva)
- Detect: domain + slide-thumbnail strip + canvas main area.
- Bundle: slide count, current slide, thumbnail labels.
- Notes: ChatGPT Agent's slide-generation workflow.

#### 3.32 🔮 `image-gallery` / `photo-app`
- Detect: grid of `<img>` elements with consistent dimensions.
- Bundle: image count, visible image alts, lightbox state if open.

#### 3.33 🔮 `legal-page` (TOS / Privacy / EULA)
- Detect: title + heading patterns ("Terms of Service", "Privacy Policy"),
  long body, low interactive density.
- Bundle: `legal_doc` — title, jurisdiction hints, last-updated, section
  outline. Pair with summarization (Nano).

---

### Failure / blocker states (mostly built)

| Kind | Status | Notes |
|---|---|---|
| `captcha` / `bot_challenge` | ✅ | already detected |
| `login-wall` | ✅ | already detected |
| `paywall_or_signup_wall` | ✅ flag | refine into kind |
| `consent_overlay` | ✅ flag | tied to §2.1 banner inventory |
| `age_gate` | ✅ flag | refine into kind |
| `spa-empty` | ✅ | already detected |
| `error-page` | ✅ | already detected |
| `rate-limited` | 📋 | check for 429 status, "rate limit" text |
| `region-blocked` / `geo-fence` | 📋 | "not available in your country" |
| `maintenance` | 📋 | banner + 503 |
| `cookie-required` | 📋 | "enable cookies to continue" |

---

## 4. Suggested build order

In leverage order, calibrated against research demand:

**Now:**
1. **§2.1 Banner inventory** — universal failure mode, cross-cutting.
2. **§2.2 Form schema** + `form_elements` bundle — highest documented ROI.
3. Extend `product_data` with price/availability/CTAs — Operator workflow.
4. `result_list` for `product-listing`/`search-results` with stable IDs.
5. `inbox` + `email_thread` + `calendar` — Comet's whole stack.

**Soon:**
6. `pull_request` + `ticket` — dev workflows.
7. `chat_thread` for Slack/Discord/Teams.
8. **§2.3 Auth state** + **§2.4 page-ready signal** — saves turns on
   every site.
9. `multi-step-form` / `wizard` — attacks "nested conditional forms"
   failure.
10. `checkout` with high-stakes confidence handling.
11. `doc_outline` for `documentation`.

**Later:**
12. **§2.5 Per-domain memory** — Skyvern's moat.
13. `dashboard`, `spreadsheet`, `document-editor`, `file-browser`.
14. **§2.7 Set-of-Marks** for vision pipeline.
15. Tier 3 niche kinds (`social-*`, `wiki`, `banking`, `legal`).

---

## 5. Conventions for adding a new kind

When we add a kind, follow this checklist:

1. **Detection lives in `probe.ts`** — deterministic, no Nano. Add the
   string literal to the `kind` union in `BriefBlock`.
2. **Bundle attached in `v2-bundled.ts`** — new context key, only when
   detected. Match the naming pattern (`page_*` / `*_summary` /
   `*_state`).
3. **Failure modes documented** — what does the kind look like when
   broken (rate-limit, paywall, etc.)? Confidence handling.
4. **Status entry here** — flip to ✅ in this doc and link the file.
5. **CLAUDE.md context catalog updated** — keys are public API; engineers
   templating prompts need to see them.
6. **Sample shown for the kind** — drop a redacted JSON sample in
   `.samples/page-kind-{name}.json` so it's reproducible.

---

## 6. Sources

Field research compiled from:
- The State of AI Browser Agents in 2025 — FillApp
- AI Browser Agents Compared 2026 — TURION.AI
- Best AI Browsers 2026 Tested — Kahana
- Agentic Browser Landscape 2026 — No Hacks
- BrowserArena (arXiv 2510.02418, NeurIPS 2025)
- WebArena Verified — OpenReview
- Skyvern AI Web Agents Guide (Nov 2025) + insurance / RPA case studies
- Building Browser Agents (arXiv 2511.19477)
- HyperAgent AGENTS.md
- Anthropic Computer Use docs
- OpenAI Operator launch
- Helicone: Browser Use vs Computer Use vs Operator
- Perplexity Comet
