Good news first: this stack is much closer to Safari-ready than most Chrome extensions, mainly because you're already shipping a Firefox build. Let me verify the current state of WXT's Safari support since that's the biggest unknown.Looking at this concrete stack, your Safari port is much more feasible than for a typical Chrome extension. Let me walk through what works in your favor and what the actual friction points will be.

**Things that make this easy**

You're already on WXT, which supports Safari as a first-class build target (it generates the right manifest). There's even a community module, `wxt-module-safari-xcode`, that automatically runs `xcrun safari-web-extension-converter` after `wxt build` and configures the Xcode project (bundle ID, dev team, app category) — that turns the Safari conversion step into config rather than a manual ritual every release.

You already ship a Firefox build (`build:firefox`). That's the single most important signal in this package.json. It means you've almost certainly stopped reaching for `chrome.*` directly and are using either `browser.*` or WXT's abstractions. Safari uses the same `browser.*` namespace as Firefox, so a lot of the cross-browser work is already done.

The dependency list is pure web stack — React 19, Radix, Tailwind 4, Zustand, TanStack Query, Supabase, Readability, Defuddle, Turndown, DOMPurify, Zod. None of that cares what browser it runs in. `@webext-core/messaging` is cross-browser by design. Shiki, react-markdown, react-hook-form — all fine.

**Things that will actually cost you time**

The friction isn't in the code; it's in the platform. In rough order of how much time each typically eats:

*App shell + App Store* — you need macOS, Xcode, an Apple Developer account ($99/year), and you'll ship a native app that wraps the extension. The wxt-module-safari-xcode module handles the scaffolding, but you still own the app's marketing page, screenshots, privacy policy, and review submissions. First submission usually takes 1–3 review cycles. Plan a couple of days for the first round, then much less per update.

*Permissions and host_permissions audit* — Safari prompts users more aggressively than Chrome and is less forgiving of broad `<all_urls>` patterns. For an extension that scrapes pages and does SEO work, you'll likely have a "this extension wants to read every site you visit" conversation with both your users and Apple's reviewers. Expect to justify each permission in the review notes and possibly switch to `activeTab` + per-site grants where you currently use broad host permissions.

*Service worker lifecycle for the agentic loop* — this is the one I'd actually prototype early. Safari's MV3 background is more aggressive about suspending than Chrome's. If your agent runs multi-step tasks, holds open SSE/streaming connections to an LLM, or maintains Supabase realtime subscriptions in the background, you may see the worker terminated mid-flight in ways you don't see on Chrome. The mitigations (offscreen-style patterns, resuming from persisted state, keeping the popup or sidepanel open as the long-lived context) all work on Safari, but you need to design for them. This is where a Chrome extension most often "works but feels broken" on Safari.

*declarativeNetRequest, if you use it* — Safari's static rule quotas are meaningfully lower than Chrome's. I don't see DNR-related deps in your package.json, so this may not apply.

*Types* — you only have `@types/chrome`. For Safari/Firefox you'll want `@types/webextension-polyfill` or `webextension-polyfill-ts` so the `browser.*` surface is properly typed, unless WXT's own types are already covering you.

**iOS Safari is a separate decision**

The same codebase can ship to iOS Safari, and that's a genuine reach advantage Chrome doesn't have. But your UI is built for popup/sidepanel widths on desktop. Radix components mostly behave on touch, but a sidebar-style chat UI, code rendering with Shiki, and a form-heavy task interface will need real layout work for a 390px viewport. Background script constraints are also tighter on iOS. I'd treat iOS as a phase 2 unless mobile is a core use case — ship Mac Safari first, learn the platform, then decide.

**My estimate**

For a competent dev who already owns a Mac: roughly **1–3 weeks of focused work** for a solid Mac Safari port, with the agent reliability/permissions tuning being the bulk of it rather than the code itself. App Review adds calendar time but not much engineering time. iOS adds another 1–2 weeks if you want it polished.

**Worth it?**

Given your stack, I'd lean yes for Mac Safari specifically because the marginal cost is low — you're maybe 70% of the way there already. The harder question is whether your *user base* skews toward Safari. An "agentic chat + scraping + SEO" extension probably has a userbase that lives in Chrome by default; SEO folks in particular tend to be Chrome-locked. I'd check your analytics or do a quick survey before committing. But if you have any non-trivial Mac/iOS demand, or if a paid plan is part of the model, the porting cost-to-reach ratio is favorable here.

One pragmatic move: add `safari` to your WXT config and try `wxt build -b safari` today. You'll get a manifest and an Xcode project out of it within an afternoon, and that build will surface the actual API/permission warnings you'll need to address — which will give you a much more grounded estimate than mine.