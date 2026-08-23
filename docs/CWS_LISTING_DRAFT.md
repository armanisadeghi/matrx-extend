# Chrome Web Store submission sheet

This is the canonical copy for the public Matrx Extend item:

- **Item ID:** `hnfolienncfklkgmdjjmhhegglimlamg`
- **Do not submit:** duplicate draft `pifjakncjcpnkjbdlijgddhiipdlfbde`
- **Release version:** `0.2.1`
- **Last reconciled:** 2026-08-20 against the published `0.1.72` policy surface and the exact `0.2.1` Store package

Paste only the text inside each quoted block into the matching dashboard field.

## Store listing

### Item name

> Matrx Extend

### Summary

> AI assistant for understanding and working with the page open in your browser.

### Detailed description

> Matrx Extend is an AI assistant in the Chrome side panel for understanding and working with the page you have open.
>
> Without creating an account, you can capture readable page content, inspect page structure, run an SEO audit, and ask the assistant questions about the current page.
>
> The extension reads page content when you invoke one of these features. Automatic capture is optional, off on a fresh installation, and can be enabled in Settings.
>
> Browser actions run only when you request them. The default mode asks before an action changes a page, and privileged actions always require confirmation.
>
> Signed-in users get a Vault tab for their saved website logins: fill a saved login on the matching site, and — after you sign in to a site yourself — an optional prompt to save that login to your Vault. Nothing is saved without your click; the prompt can be turned off in Settings and silenced per site.
>
> Learn exactly what the extension accesses and how it is used in the Matrx Extend privacy policy: https://www.aimatrx.com/privacy-policy/extension

### Category

> Tools

The current dashboard groups categories under a **Productivity** heading but
does not offer a generic Productivity choice. **Tools** is the selected valid
category and matches the extension's page-aware assistant purpose.

### Language

> English

### Official URL

> https://www.aimatrx.com/

### Homepage URL

> https://www.aimatrx.com/

### Support URL

> https://www.aimatrx.com/contact

## Privacy

### Single purpose

> Matrx Extend is an AI side-panel assistant that helps the user understand and work with the web page they are currently viewing.

### Privacy policy URL

> https://www.aimatrx.com/privacy-policy/extension

### Remote code

> No, I am not using remote code.

The submitted source contains no `eval`, `new Function`, `Runtime.evaluate`, `Runtime.callFunctionOn`, or `Runtime.compileScript`. Server responses choose compiled tool names and validated data arguments; they never supply executable logic.

### Data-use disclosures

Authentication information covers both paths that carry a credential: the agent-safe fill (the value goes from the Vault to the page, never to the model) and the user-approved "Save this login?" prompt (the value goes from the page to the user's own Vault, only after an explicit click). No new category is needed for the save prompt. The privacy policy page (`matrx-frontend` `app/(public)/privacy-policy/extension`) was updated 2026-08-22 to describe the Vault and the save prompt; it goes live with the next frontend release — confirm it is live before the Store build that ships the prompt is uploaded.

Check these categories:

- Personally identifiable information
- Authentication information
- Personal communications
- Web history
- User activity
- Website content

Check all three Limited Use certifications. The extension does not sell user data, use it outside the disclosed single purpose, or use it for lending or creditworthiness.

## Permission justifications

### `storage`

> Stores the user's settings, preferences, guest identifier, and locally saved notes and extraction patterns so they persist between sessions.

### `sidePanel`

> The assistant interface is displayed in Chrome's side panel.

### `activeTab`

> Identifies the tab the user is actively working with when they invoke the assistant.

### `tabs`

> Lets the assistant identify the active tab and perform tab operations such as open, switch, reload, or close only when the user requests them.

### `tabGroups`

> Lets the user ask the assistant to organize open tabs into Chrome tab groups.

### `scripting`

> Reads the page the user selected and performs requested page interactions using code packaged with the extension.

### `identity`

> Supports optional sign-in to the user's AI Matrx account through an OAuth flow. Guest use does not require sign-in.

### `offscreen`

> Maintains the user-started streaming assistant connection when Chrome suspends the Manifest V3 service worker.

### `nativeMessaging`

> Connects only to the optional Matrx desktop companion when the user has installed it and requests a desktop capability. The extension works without the companion.

### `alarms`

> Runs a task at the time the user scheduled it.

### `contextMenus`

> Adds a right-click action that sends user-selected page text or an image to the assistant.

### `clipboardWrite`

> Copies a result such as captured text or extracted rows to the clipboard when the user clicks a copy command.

### `downloads`

> Saves a file such as a screenshot, extracted data, PDF, or archived page only when the user requests it.

### `webNavigation`

> Detects completion of a user-initiated navigation so an active multi-step task or an explicitly enabled saved workflow can continue on the new page.

### `history`

> Reads browsing history only when the user explicitly asks the assistant to find a previously visited page.

### `bookmarks`

> Reads or changes bookmarks only when the user explicitly asks the assistant to find, create, move, or remove a bookmark.

### `notifications`

> Notifies the user when a task they started finishes or needs their input.

### `sessions`

> Reopens a recently closed tab only when the user asks.

### `debugger`

> Provides Chrome capabilities unavailable through narrower APIs: workflow screencasting, page network inspection, full-page screenshots, PDF export, accessibility-tree inspection, difficult page interaction, and viewport emulation. It is never used to execute code. The source contains no Runtime.evaluate, Runtime.callFunctionOn, or Runtime.compileScript calls. Chrome does not permit debugger as an optional permission.

### Optional `cookies`

> Requested at runtime only when the user enables advanced page tools and asks to inspect or change a cookie for the current site.

### Optional `pageCapture`

> Requested at runtime only when the user asks to save an archived copy of the current page.

### Optional `clipboardRead`

> Requested at runtime only when the user asks the assistant to use clipboard content.

### Optional `tabCapture`

> Requested at runtime only when the user asks to record their own browser tab.

### Host access (`<all_urls>`)

> The assistant's single purpose applies to whichever page the user chooses, so the extension cannot know the site in advance. A lightweight packaged bridge is available on web pages, but page content is captured or transmitted only after the user invokes a page-aware feature or explicitly enables automatic capture. Fresh installations have automatic capture off.

## Reviewer test instructions

The dashboard limit is 500 characters. Paste this exact instruction:

> No account is required. Open https://www.aimatrx.com/matrx-extend-demo and click the Matrx Extend toolbar icon to open the side panel. Open Scrape, click Capture, and confirm the article appears. Open SEO and confirm the audit appears. Open Chat, ask "What are the three workflow stages on this page?" and confirm the answer says Capture, Understand, and Use. Automatic page capture is off by default.

Leave reviewer username and password blank.

## Screenshot set

Upload four current 1280 × 800 screenshots from the exact store build, in this order:

1. Guest Chat answering the three-stage question on `/matrx-extend-demo`.
2. Capture showing the demo article and its extracted content.
3. SEO showing the live audit for the demo page.
4. Settings showing automatic capture off on a fresh installation.

Do not add a Data/picker screenshot merely to fill the fifth slot. The four
screenshots above mirror the exact reviewer path and default-disclosure check.
Do not upload old signed-in, admin, task, or unrelated product screenshots.

### `1.0.0` marketing refresh

Do this after the final public visibility choices are set in
`src/config/sidepanel-visibility.ts` and before declaring `1.0.0`:

1. Run the exact Store build in a clean local Chrome profile with no AI Matrx
   session. Confirm only `everyone` tabs appear and complete the guest path.
2. Sign in with a non-admin test account. Confirm only `everyone` and
   `signed-in` tabs appear and complete every workflow we intend to market.
3. Capture screenshots from those two audiences only. Never use an admin
   session, even if the screenshot happens not to show an admin tab.
4. Lead with Chat working from the current page. Follow with page Capture and
   SEO outcomes. Use the fourth slot for the strongest stable signed-in outcome
   only if it is part of the `1.0.0` promise; otherwise retain Settings showing
   automatic capture off.
5. Create a 440 × 280 small promotional tile from the same visual system. A
   marquee tile remains optional and should be added only with campaign-quality
   artwork.

Screenshot capture comes after visibility and stability decisions because a
hidden, renamed, or visibly changed feature makes earlier assets stale. The
clean-profile reviewer screenshots remain valid for approval until that final
marketing pass.

## Submission facts that stay internal

- Previous rejection (2026-05-16), reference **Red Potassium**, said advertised functionality was not working or reproducible.
- The rejected submission had no reviewer credentials and no reviewer instructions.
- Version `0.2.1` preserves the deterministic public test page and exact account-free steps introduced in `0.1.72`.
- Literal Chrome Guest mode cannot load extensions. The correct reviewer simulation is a new local Chrome profile with only the submitted package installed and no AI Matrx login.
- A clean-profile pass and exact screenshot paths must be recorded in `docs/CHROME_WEB_STORE_REVIEW.md` before submission.
