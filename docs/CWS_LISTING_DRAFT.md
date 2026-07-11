# Chrome Web Store listing — single-purpose rewrite (draft to paste)

> Purpose of this file: give the dashboard exact copy that fixes the **single-purpose**
> and **description** rejection reasons. The core move: stop advertising five features.
> Lead with the ONE purpose — *an AI assistant that reads and operates the current
> browser tab for you* — and frame everything else as things that assistant does.

---

## Item name
**Matrx — AI Assistant for Your Browser**

*(Keep it short. No keyword lists. The old "chat, tasks, scraping, structured data
extraction, and SEO" enumeration is exactly what reads as multi-purpose.)*

## Summary (the 132-char short description field)
> An AI assistant in your side panel that reads the current page and helps you act on
> it — answer questions, fill forms, and pull out information.

## Detailed description

> **Matrx is an AI assistant that works inside your browser.** Open the side panel on any
> page and it can see what you're looking at, answer questions about it, and — with your
> permission — take actions for you on that page.
>
> **What it helps you do**
> - Ask questions about the page you're on and get answers grounded in what's actually there.
> - Pull information out of a page — a table, a list, the key details — into a clean format.
> - Fill in and submit forms, click through steps, and navigate, when you ask it to.
> - Keep short notes and reminders tied to your work, so you don't lose context.
>
> **How it works**
> Matrx reads the content of the page you choose to use it on and sends it to the Matrx AI
> service to generate a response. It only acts on a page when you ask it to, and actions
> that change a page always ask for your confirmation first.
>
> **You're in control**
> - Nothing happens on a page unless you start it.
> - Page-changing actions confirm with you before they run.
> - You can use it as a guest, without an account.
>
> Your data is handled per our privacy policy: <PRIVACY_POLICY_URL>

*(Notes: every sentence ties back to "assistant that operates the current tab." No feature
is presented as a co-equal standalone product. "SEO audit," "scraping," and "structured
data extraction" all fold into "pull information out of a page." This is truthful — those
features genuinely serve that one purpose — and it is what a reviewer needs to see.)*

---

## Single-purpose statement (dashboard field, if asked)
> Matrx's single purpose is to be an AI assistant that helps the user understand and act on
> the web page they are currently viewing, from the browser side panel.

---

## Permission justifications (paste into the "Permission justification" fields)

- **Host access (`<all_urls>`)** — The assistant works on whatever page the user chooses to
  open it on, so it must be able to read and act on the active tab regardless of site. It
  reads page content only when the user engages it on that page.
- **`scripting`** — To read the current page's content and perform the actions the user
  requests (clicking, filling forms) on that page.
- **`tabs` / `tabGroups`** — To operate on the tab the user is working in and manage tabs
  when the user asks (open, switch, group).
- **`sidePanel`** — The assistant's entire UI lives in the side panel.
- **`storage`** — To remember the user's settings and notes locally.
- **`downloads`** — To save files (e.g. a screenshot or an extracted table) when the user asks.
- **`notifications`** — To notify the user when a task they started finishes.
- **`history` / `bookmarks`** — Only used when the user explicitly asks the assistant to find
  something in their history or bookmarks. *(If we cannot justify these as core, CUT them —
  they are among the most sensitive and the least central. See CHROME_WEB_STORE_REVIEW.md §4.)*
- **`debugger`** — Powers advanced page-inspection features. *(Highest-scrutiny permission.
  Expect to justify in detail, or drop CDP from the public build. See §4.)*
- **`nativeMessaging`** — Optional connection to the companion Matrx desktop app, when the
  user has installed it.
- **`offscreen` / `alarms` / `webNavigation`** — Internal plumbing for streaming responses,
  scheduled tasks the user sets, and re-running a saved workflow across page loads.

---

## Privacy policy — what it must say (for `titaniumsuccess`/aimatrx-hosted page + dashboard field)

The policy URL goes in the dashboard's **Privacy → "Privacy policy URL"** field (NOT in the
description). Under the **1 Aug 2026** Limited-Use update, the data we collect must be
*strictly necessary to the single purpose above*, and disclosure must be prominent.

The policy must cover, in plain language:
- **What we access:** the content of pages the user engages the assistant on; the user's
  input; and — only when the user explicitly invokes those features — history and bookmarks.
- **Why:** solely to provide the AI-assistant functionality on the page the user chose.
- **Where it goes:** page content + the user's message are sent to the Matrx AI service
  (server.app.matrxserver.com) and to the AI model providers that generate responses.
- **What we do NOT do:** we do not sell user data; we do not use it for advertising; we do
  not collect data beyond what the assistant needs to answer on the current page.
- **Guests:** guest usage still creates an anonymous account server-side to provide the
  service; describe it and how to request deletion.
- A contact/deletion path.

*(If a policy already exists on the website, it likely needs a short section added that names
the extension explicitly and states the page-content → Matrx-server → LLM-provider data flow.
That is the part reviewers look for.)*
