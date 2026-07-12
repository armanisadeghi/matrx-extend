# Chrome Web Store dashboard — copy/paste sheet

Each heading below is one field in the dashboard. The text UNDER each heading is exactly
what to paste — it contains no formatting characters, so paste it as-is.

Anything you should NOT paste is kept out of the way, in the "Notes for you" section at the
very bottom.

Verified against the built manifest on 2026-07-12.

===============================================================================
STORE LISTING TAB
===============================================================================

## Item name

Matrx — AI Assistant for Your Browser


## Summary (short description)

An AI assistant in your side panel. Ask about the page you're on, pull out details you need, and let it act on the page for you.


## Detailed description

Matrx is an AI assistant that works inside your browser.

Open the side panel on any page and Matrx can see what you are looking at, answer questions about it, and — when you ask it to — take actions for you on that page.

WHAT IT HELPS YOU DO

Ask questions about the page you're on, and get answers based on what is actually there rather than a guess.

Pull information out of a page — a table, a list, a set of product details — into a clean, usable form.

Fill in and submit forms, click through steps, and navigate, when you ask it to.

Capture and keep what matters: a screenshot, a note, a saved pattern you can re-run on similar pages later.

HOW IT WORKS

Matrx reads the content of the page you choose to use it on and sends it to the Matrx AI service, which generates a response using an AI model.

It only reads a page when you engage it on that page. It never runs in the background on sites you are not using it on.

YOU ARE IN CONTROL

Nothing happens on a page unless you start it.

Any action that would change a page asks for your confirmation first.

You can use Matrx as a guest, without creating an account.

PRIVACY

We explain exactly what the extension reads, where it goes, and what we never do with it, in our extension privacy policy: https://www.aimatrx.com/privacy-policy/extension


===============================================================================
PRIVACY TAB
===============================================================================

## Single purpose description

Matrx Extend is an AI assistant that helps the user understand and act on the web page they are currently viewing, from the browser side panel. Everything it does serves that one purpose: answering questions about the current page, extracting information from it, and performing actions on it at the user's request.


## Privacy policy URL

https://www.aimatrx.com/privacy-policy/extension


## Are you using remote code?

No, I am not using remote code


===============================================================================
PRIVACY TAB — PERMISSION JUSTIFICATIONS
===============================================================================

## storage

Stores the user's settings, preferences, and locally saved notes and patterns so they persist between sessions.

## sidePanel

The entire assistant interface lives in the browser side panel. This is the extension's only UI.

## activeTab

Lets the assistant read and act on the tab the user has open when they engage it, without needing access to any other tab.

## tabs

The assistant operates on the tab the user is working in, and can open, switch, reload, or close tabs when the user asks it to.

## tabGroups

Lets the user ask the assistant to organize their tabs into groups, and keeps multi-tab tasks contained in their own group.

## scripting

Required to read the content of the page the user has engaged the assistant on, and to perform the actions they request on that page, such as clicking a button or filling in a form.

## identity

Used to sign the user in to their Matrx account through Google's OAuth flow. It is not used to read any other identity information.

## offscreen

The assistant's responses are streamed from our server over a long-lived connection. An offscreen document holds that connection, because a Manifest V3 service worker is terminated too early to keep it open.

## nativeMessaging

Used only to connect to the optional Matrx desktop companion application, if the user has chosen to install it. If it is not installed, this is never used.

## alarms

Used to run tasks the user has scheduled themselves, at the time they asked for.

## contextMenus

Adds a right-click menu item so the user can send selected text or an image on the page straight to the assistant.

## clipboardWrite

Lets the assistant copy a result to the user's clipboard when they ask for it, for example an extracted table or a generated summary.

## downloads

Lets the assistant save a file for the user when they ask, such as a screenshot, an extracted table, or a page saved as a PDF.

## webNavigation

Used to detect when a page finishes loading so the assistant can resume a multi-step task the user started, and so a saved workflow can continue across a page navigation.

## history

Used only when the user explicitly asks the assistant to find something in their browsing history, for example "find the article I read yesterday about X". It is not read at any other time.

## bookmarks

Used only when the user explicitly asks the assistant to find or organize something in their bookmarks. It is not read at any other time.

## notifications

Notifies the user when a task they started finishes, or when the assistant needs their input to continue.

## sessions

Lets the user ask the assistant to find and reopen a tab they recently closed.

## debugger

Used solely to provide capabilities Chrome offers no other API for: recording a short screen recording of the user's own workflow so they can save and replay it, showing the user the network requests their page is making, capturing a screenshot of a full page beyond the visible area, saving a page as a PDF, and reading the page's accessibility tree for users who need it.

We do not use this permission to execute code. The extension makes no Runtime.evaluate, Runtime.callFunctionOn, or Runtime.compileScript calls anywhere in its source.

This cannot be requested as an optional permission, because Chrome does not permit "debugger" in optional_permissions.

## cookies (optional)

Requested at runtime, only when the user turns on the advanced page-tools setting. It lets the assistant read or clear a cookie on the site the user is currently on, at their request.

## pageCapture (optional)

Requested at runtime, only when the user asks to save a complete archived copy of the current page.

## clipboardRead (optional)

Requested at runtime, only when the user asks the assistant to use what they have copied to their clipboard.

## tabCapture (optional)

Requested at runtime, only when the user asks to record a video of their own tab.

## Host permission justification (all_urls)

Matrx is an assistant for whatever page the user is currently on, so it cannot know in advance which sites the user will want help with. It needs to be able to read and act on the active tab regardless of which site it is.

It reads a page only when the user opens the side panel and engages the assistant on that page. It does not read, monitor, or collect data from pages in the background, and it does not run on sites the user is not actively using it on.


===============================================================================
NOTES FOR YOU — DO NOT PASTE ANY OF THIS
===============================================================================

1. "Are you using remote code?" is now answerable as NO. That changed on 2026-07-11 when we
   removed execute_javascript / evaluate_javascript (which ran new Function on a string sent
   by the server). Before that, the honest answer was YES, and that alone is a hard rejection.
   Do not answer YES out of caution — it is now genuinely No, and answering Yes invites a
   review we do not need.

2. Privacy policy URL: I pointed it at the EXTENSION-specific policy
   (/privacy-policy/extension) rather than the general site one, because it names the
   extension and enumerates the permissions. If the dashboard already has the general
   /privacy-policy URL, either is acceptable, but the extension one is stronger.

3. Data-usage disclosures (checkboxes on the Privacy tab). Based on what the extension
   actually does, you should be checking:
     - Personally identifiable information  (email, on sign-in)
     - Authentication information            (OAuth tokens)
     - Website content                       (page text/HTML — this is the big one)
     - Web history                           (only if we keep the history permission)
     - User activity                         (the user's prompts)
   And you must certify all three statements (no selling, no unrelated use, no
   creditworthiness/lending use). Those are all true for us.

4. contextMenus was flagged as "declared but unused" on the published v0.1.4. It IS used now
   (2 files). If it gets flagged again, the fix is to make the right-click item obviously
   visible to a reviewer, not to remove it.

5. clipboardWrite is the one permission I am least sure we still need — the code only calls
   navigator.clipboard.writeText, which works on a focused extension page without it. If a
   reviewer challenges it, we can likely drop it with no loss. Not worth pre-emptively
   removing.

6. The screenshots and the description must match what a reviewer actually sees when they
   install the zip. Guest mode means they CAN test it without an account — make sure the
   first screenshot shows the side panel answering a question about a page, not an admin tab.
