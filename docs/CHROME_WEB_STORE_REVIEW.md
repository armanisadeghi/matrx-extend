# Chrome Web Store — why we keep getting rejected, and what to do

> Audited 2026-07-11 against the CURRENT published policies (links at the bottom).
> Read this BEFORE the next resubmission. Shipping again without addressing §1 and
> §2 will very likely be rejected again — those are policy violations, not bugs, and
> no amount of code quality fixes them.

**There is a hard deadline.** Chrome's updated privacy policies begin **enforcement
on 1 August 2026**. Extensions non-compliant after that date "may face enforcement
action." That is weeks away, and it applies to the *published* item as well as new
submissions.

---

## 1. 🔴 BLOCKER — We execute remote code. This is explicitly prohibited.

This is almost certainly the main reason we keep getting rejected, and it is the one
thing that cannot be argued around.

`src/lib/tools/handlers/privileged.ts` (`execute_javascript`) does:

```js
const fn = new Function('arg', `return (async () => { ${code} })();`);
```

`code` is a **JavaScript string authored by an LLM on our server** and delivered over
the SSE stream. `evaluate_javascript` (`canonical-mergers.ts`) is the same capability
under the canonical mega-tool name.

The Manifest V3 policy is unambiguous. Prohibited:

- *"Using `eval()` or similar mechanisms to execute a string fetched from a remote source"*
- *"Building systems to run complex commands fetched from a remote source, **even if
  those commands are fetched as data**"*
- The requirement: *"the full functionality of an extension must be easily discernible
  from its submitted code."*

There are exactly **two** sanctioned exceptions: the **Debugger API** and the
**User Scripts API**.

### What is and is not a problem here

**The tool dispatcher itself is defensible.** The server sends a tool *name* plus
Zod-validated *arguments*; every handler is compiled into the package. External input
supplies **data**, never **logic** — which is precisely the line the policy draws
("external resources can provide data but never logic"). We should say this plainly in
the reviewer notes rather than hope nobody asks.

**`execute_javascript` / `evaluate_javascript` are NOT defensible.** They take logic
from the network and run it. There is no reading of the policy under which
`new Function(remoteString)` is permitted.

### The three ways out (this is a product decision — see OPEN QUESTIONS)

1. **Drop the tools from the shipped build.** Cleanest, fastest, guaranteed to pass.
   Costs the agent an escape hatch it uses for long-tail pages.
2. **Move them to the `chrome.userScripts` API** — the *sanctioned* exception, and the
   manifest already reserves the `userScripts` permission for exactly this. Cost: the
   user must flip a per-extension "Allow User Scripts" toggle in `chrome://extensions`,
   so it cannot be silently on by default.
3. **Route them through the Debugger API** (`Runtime.evaluate`) — also sanctioned, and
   we already ship `debugger` + a full CDP client. Cost: the "is being debugged" banner
   on every tab it touches.

Note that (2) and (3) are exceptions to the *remote-code* rule specifically; they do
not exempt us from the single-purpose or data-use rules below.

Note: injecting via `chrome.scripting.executeScript` does **not** save us. The tool
runs `new Function(code)` inside the page (ISOLATED or MAIN world), but the policy is
about where the **logic came from** — the network — not which JS realm evaluates it.
The line already carries an `eslint-disable ... no-new-func`, so this was known.

### Lower priority: `new Function` on page data (defensible, but it will cost a review cycle)

`src/lib/data-pattern/framework-dump.ts:125` and `src/lib/data-pattern/modes/next-data.ts:252`
use `new Function` to parse a `__NEXT_DATA__`-style JS object literal **out of the
current page**. That is page *data*, not remote code, and it is genuinely defensible.
But a reviewer grepping for `new Function` cannot tell the two apart at a glance, and we
will burn a rejection cycle explaining the difference. Replacing them with a real parser
(JSON5, or a restricted literal parser) removes the argument entirely for very little work.
Do this **after** §1 — it is not itself a violation.

---

## 2. 🔴 BLOCKER — Single purpose. We are, on paper, a Swiss army knife.

Policy: an extension must have **one** narrow, well-defined purpose. Multi-function
extensions are routinely rejected. Explicit violations include "combining unrelated
functionalities" and "multiple entry points for disparate features."

Our own manifest description reads:

> "Agentic browser companion — **chat, tasks, scraping, structured data extraction,
> and SEO**."

That is five purposes in one sentence, written by us, in the field the reviewer reads
first. And the side panel ships ~17 tabs (Chat, Tasks, Agenda, Scrape, Data, Highlight,
Guidance, SEO, Notes, Screenshots, Lists, Tools, Settings, Profile, + admin-only Pilot /
Showcase / Debug).

**This is fixable without cutting features, because the features genuinely DO serve one
purpose.** The purpose is: *an AI agent that operates your browser for you.* Scraping,
extraction, SEO audit, notes, and screenshots are not five products — they are things
the agent does, and things the user does to *feed* the agent. The listing has to say
that, and the UI has to look like that.

Required changes:
- **Rewrite the description** around the single purpose. Lead with the agent. Do not
  enumerate co-equal features.
- **Consider hiding the non-core tabs behind the agent** for the public build (they are
  already tab-gated; admin-only tabs are already invisible to a reviewer).
- The store listing (title, description, screenshots) must match the actual behavior
  exactly — reviewers check this and "deceptive metadata" is its own rejection class.

---

## 3. 🟢 MOSTLY DONE — Privacy policy exists and is extension-specific (one gap)

**Correction to an earlier version of this doc:** it said there was no privacy policy.
That was wrong — it checked the repo, not the website. The policy exists, resolves 200,
and is **written specifically for this extension**:

**`https://www.aimatrx.com/privacy-policy`**

Verified 2026-07-11 that it already covers, by name: "the Matrx Extend Chrome extension,"
the page content it reads ("visible text or rendered HTML/markdown, the accessibility
tree, headings, links, page metadata"), sending that to the backend + LLM providers
("forwards your message and any included page context to whichever provider…"), browsing
**history**, **bookmarks**, and **cookies**, and a deletion path (email support@aimatrx.com).
That is a strong policy and directly addresses the data-handling rejection class.

**Two things still to do:**
1. **Confirm the URL is in the dashboard's Privacy → "Privacy policy URL" field.** A great
   policy the reviewer can't find still fails. (I can't see the dashboard, so this is
   unverified — check it.)
2. **Add a short guest/anonymous-usage paragraph.** The policy currently reads as
   account-required, but the extension has **guest mode** (2026-05-16), which mints an
   anonymous `auth.users` row server-side via the install fingerprint. The 2026 disclosure
   rules require disclosing that collection. Suggested addition:
   > *"You can use the extension as a guest without creating an account. When you do, we
   > create an anonymous account tied to a randomly-generated identifier for your install,
   > so we can provide the service and apply usage limits. Guest data is handled the same
   > way as account data; email support@aimatrx.com to request deletion."*

Under the **2026 Limited Use update**, collected data must be *"strictly necessary to the
disclosed single purpose."* This links back to §2: once the single purpose is declared,
every permission and every byte must visibly serve it — the policy already frames it that
way ("pages you choose to give it").

---

## 4. 🟠 HIGH — Permissions. Several are hard to justify, one is redundant.

Reviewers reject on "excessive permissions" and on permissions that do not serve the
declared single purpose. Current state, audited against real code usage:

| Permission | Used in code? | Risk |
|---|---|---|
| `debugger` | yes (CDP client, 5 files) | 🟠 Highest-scrutiny permission that exists, and cannot be made optional (Chrome forbids `debugger` in `optional_permissions`). **But we have a genuinely strong justification — see §4b.** |
| `<all_urls>` host access | yes | 🟠 Broad host access triggers "excessive permissions" unless *genuinely necessary for core functionality*. For a browse-anywhere agent it IS necessary — but we must say why, explicitly. |
| `history`, `bookmarks`, `sessions` | 1–2 files each | 🟠 Very sensitive. Each must visibly serve the single purpose or be cut. |
| `nativeMessaging` | yes (`connectNative('com.matrx.local')`) | 🟠 Legitimate in code, but the native host does not exist on a reviewer's machine. Justify or drop. |
| `system.cpu` / `system.memory` / `system.display` | 1 file (admin-only tool) | 🟠 The manifest itself says these were added **"preemptively"** for a roadmap item. They are reachable only from an **admin-gated** tool, so a reviewer can never trigger them. This is the definition of a permission that does not serve the user-facing purpose. **Recommend removing.** |
| `declarativeNetRequestWithHostAccess` | 1 file (admin-only tool) | 🟠 Same as above. **Recommend removing.** |
| `activeTab` | **no** | 🟢 Not a problem. Redundant next to `<all_urls>`, but reviewers *prefer* `activeTab` — it is the narrow one. Leave it; if we ever narrow host access it becomes load-bearing. |
| `clipboardWrite` | only `navigator.clipboard.writeText` | 🟡 Likely unnecessary (that call works on a focused extension page without it). Verify, then drop. |
| `contextMenus` | yes (2 files) | 🟡 **Was already flagged "declared but unused" on the published v0.1.4 build.** It is genuinely used now — but confirm the reviewer can see it being used. |

**Do not ship permissions "preemptively."** The manifest ~~currently admits~~ *(fixed
2026-07-11)* used to admit, in a comment, that four permissions were added for features that
did not exist yet. That is exactly what the "minimum permissions" rule prohibits, and it was
written down in our own source. Those four are gone.

---

## 4b. The `debugger` decision — exactly what it costs, and the justification

**The strongest fact in our favour: we never use CDP to execute code.** Verified — the repo
contains **zero** calls to `Runtime.evaluate`, `Runtime.callFunctionOn`, or
`Runtime.compileScript`. The entire CDP surface we use is:

| Domain | What we call it for |
|---|---|
| `Page.startScreencast` / `screencastFrame` | GIF recording of a user workflow |
| `Page.captureScreenshot` / `getLayoutMetrics` | Full-page (beyond-the-fold) screenshot |
| `Page.printToPDF` | Save the page as a PDF |
| `Network.*` (enable, requestWillBeSent, getResponseBody…) | Show the user the page's network calls |
| `Accessibility.getFullAXTree` | Read the page's accessibility tree |
| `Input.dispatchMouseEvent` / `insertText` | Click/type on pages where normal injection fails (shadow DOM, cross-origin iframes) |
| `Emulation.*` | Device/viewport emulation |

That matters enormously, because `debugger` is one of MV3's two sanctioned **remote-code**
exceptions — so a reviewer's first assumption will be that we are using it to run code. We
are not. State this explicitly in the reviewer notes.

### What we actually LOSE if we remove it

21 tools depend on it. **14 are NOT admin-only** — real users lose these, not just us.

**Gone entirely (no fallback exists):**
- **GIF recording** (`chrome_record_gif`) — the Guidance tab's record-a-workflow feature.
  CDP screencast is the only viable path; `captureVisibleTab` is throttled to ~2 frames/sec,
  which is useless for a GIF.
- **Network capture** (6 tools) — the Showcase **Network** tab and the `network_capture`
  data-pattern extraction mode. There is no non-CDP way to see a page's XHR/fetch traffic.
- **Console reading** (`read_console_messages`) — page errors/exceptions.
- **Print-to-PDF**, **performance metrics**.

**Degraded but survives:**
- **Full-page screenshot** — falls back to `src/lib/screenshot/full-page.ts` (scroll-and-stitch
  via `captureVisibleTab`). Slower and rate-limited, but it works.
- **CDP input** — normal `click_element` / `type_into_element` (via `chrome.scripting`) handle
  the overwhelming majority of pages. We only lose the fallback for genuinely hard pages
  (closed shadow roots, cross-origin iframes, canvas apps).
- **Accessibility tree** — `read_page` builds its own tree via scripting; `cdp_a11y_tree` is
  the higher-fidelity version.

**Costs us NO user data:** verified against the live DB — **zero** saved patterns
(`extend.wbx_pattern`) use the `network_capture` kind. Removing it strands nothing.

### Recommendation
**Keep it for this submission.** The thing that was almost certainly killing us (the
`new Function(remoteCode)` RCE) is now gone. `debugger` powers real, user-facing features,
and we have a clean, honest, verifiable justification (no code execution). If the reviewer
rejects specifically on `debugger`, we remove it then — and we now know precisely what that
costs, so it's a 30-minute change, not a discovery exercise.

### Reviewer-note text (paste this)
> The `debugger` permission is used solely to provide features Chrome offers no other API for:
> recording a GIF of the user's workflow (`Page.startScreencast`), showing the user their
> page's network requests, capturing a full-page screenshot, saving the page as a PDF, and
> reading the accessibility tree. **We do not use it to execute code** — the extension makes
> no `Runtime.evaluate`, `Runtime.callFunctionOn`, or `Runtime.compileScript` calls anywhere.
> It cannot be an optional permission because Chrome does not permit `debugger` in
> `optional_permissions`.

---

## 5. 🟠 HIGH (new, 2026) — AI safeguards clause

New for 2026: extensions "designed to circumvent safety guardrails, usage restrictions,
or other protective measures implemented by AI-powered services" are prohibited.

We are an AI agent that automates other websites. We should be careful that nothing in
the listing or the tool set reads as **defeating** another service's protections — e.g.
anything framed as bypassing bot detection, CAPTCHA solving, rate-limit evasion, or
scraping behind a login. Our `page_dismissibles` / CAPTCHA handling and the scraping
tools should be described as *convenience for the user on pages they are already
authorized to view*, never as circumvention.

---

## 6. 🟡 MEDIUM — Reviewer must be able to actually USE it

Reviewers reject "non-functional" extensions and they test the **exact submitted zip**,
on poor connectivity. Good news: **guest mode** (2026-05-16) means a reviewer can open
the side panel and chat without signing up — that was an excellent call and directly
addresses this class of rejection. Verify it still works in the store zip:

- Install the *store* zip (not the local/dev one) in a clean profile.
- Do not sign in. Confirm chat works end-to-end.
- Confirm nothing dead-ends into a sign-in wall or an admin-only surface.

---

## The order I would fix these in

1. **Decide the `execute_javascript` question** (§1) — this is the blocker, and it is a
   product call, not an engineering one.
2. **Rewrite the description + listing around ONE purpose** (§2). Costs nothing, removes
   the second blocker.
3. **Write the privacy policy, register it in the dashboard** (§3). Hard deadline: 1 Aug 2026.
4. **Strip the preemptive permissions** (§4): `system.*`, `declarativeNetRequestWithHostAccess`,
   `activeTab`, probably `clipboardWrite`.
5. Replace `new Function` in the data-pattern parsers (§1, tail) — cheap, removes an argument.
6. Write **reviewer notes** for the dashboard explaining, in plain language: why the tool
   dispatcher is data-not-logic; why an agent needs `<all_urls>`; what `debugger` is for.

---

## Sources

- [Manifest V3 requirements — remotely hosted code](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
- [Troubleshooting Chrome Web Store violations](https://developer.chrome.com/docs/webstore/troubleshooting)
- [Chrome Web Store policy updates 2026 (Aug 1 enforcement)](https://developer.chrome.com/blog/cws-policy-updates-2026)
- [Program policies](https://developer.chrome.com/docs/webstore/program-policies)
