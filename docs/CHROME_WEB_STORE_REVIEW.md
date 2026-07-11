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

## 3. 🔴 BLOCKER — No privacy policy, and we handle a LOT of personal data.

There is **no privacy policy anywhere in this repo**, and I could find no evidence one
is registered in the dashboard.

We read and transmit: page content of every site visited (`<all_urls>`), browsing
**history**, **bookmarks**, **cookies**, **downloads**, tab/session data, screenshots,
and the user's typed input — and we send page content to a third-party server
(aidream) and on to LLM providers.

Requirements:
- A working privacy-policy URL **in the dashboard's designated field** (not in the
  description — that is its own rejection reason).
- Prominent disclosure of **all** data collection.
- Under the **2026 Limited Use update**: user data collected must be *"strictly
  necessary to the extension's disclosed single purpose."* This links §3 back to §2 —
  once we declare the single purpose, every permission and every byte we collect must
  visibly serve it.

---

## 4. 🟠 HIGH — Permissions. Several are hard to justify, one is redundant.

Reviewers reject on "excessive permissions" and on permissions that do not serve the
declared single purpose. Current state, audited against real code usage:

| Permission | Used in code? | Risk |
|---|---|---|
| `debugger` | yes (CDP client, 5 files) | 🔴 Highest-scrutiny permission that exists. Cannot be optional (Chrome forbids it). Expect to justify it in detail — or drop CDP from the public build. |
| `<all_urls>` host access | yes | 🟠 Broad host access triggers "excessive permissions" unless *genuinely necessary for core functionality*. For a browse-anywhere agent it IS necessary — but we must say why, explicitly. |
| `history`, `bookmarks`, `sessions` | 1–2 files each | 🟠 Very sensitive. Each must visibly serve the single purpose or be cut. |
| `nativeMessaging` | yes (`connectNative('com.matrx.local')`) | 🟠 Legitimate in code, but the native host does not exist on a reviewer's machine. Justify or drop. |
| `system.cpu` / `system.memory` / `system.display` | 1 file (admin-only tool) | 🟠 The manifest itself says these were added **"preemptively"** for a roadmap item. They are reachable only from an **admin-gated** tool, so a reviewer can never trigger them. This is the definition of a permission that does not serve the user-facing purpose. **Recommend removing.** |
| `declarativeNetRequestWithHostAccess` | 1 file (admin-only tool) | 🟠 Same as above. **Recommend removing.** |
| `activeTab` | **no** | 🟢 Not a problem. Redundant next to `<all_urls>`, but reviewers *prefer* `activeTab` — it is the narrow one. Leave it; if we ever narrow host access it becomes load-bearing. |
| `clipboardWrite` | only `navigator.clipboard.writeText` | 🟡 Likely unnecessary (that call works on a focused extension page without it). Verify, then drop. |
| `contextMenus` | yes (2 files) | 🟡 **Was already flagged "declared but unused" on the published v0.1.4 build.** It is genuinely used now — but confirm the reviewer can see it being used. |

**Do not ship permissions "preemptively."** The manifest currently admits, in a comment,
that four permissions were added for features that do not exist yet. That is exactly what
the "minimum permissions" rule prohibits, and it is written down in our own source.

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
