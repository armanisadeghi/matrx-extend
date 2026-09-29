# Guest Chat Store change: evidence timeline

## Finding

Guest Chat was deliberately removed from the public side panel because the guest run path was considered unreliable. The code says so directly in the Sept. 27 change; the contemporaneous Store record says guest Chat would remain gated until secure server bootstrap was finished. The same release kept Chat available to signed-in Store reviewers and other signed-in users. This was a product availability decision tied to a technical limitation, not evidence that Google required Chat to be login-gated.

The stabilization work is a plausible context, but the available record does not show that the stabilization task directed or authorized this change. Its brief and handoff explicitly deferred systematic Chat/Pilot testing. It did not ask to hide guest Chat. A handoff note records an incidental guest-flow Chat mount, which could have surfaced the area, but there is no message connecting that observation to the gate. **Causal attribution to the stabilization thread is unproven.**

## Timeline (Pacific time unless marked UTC)

| When | Evidence | What it establishes |
| --- | --- | --- |
| Aug. 20, 2026, 16:30 | `632d29b9`, `src/config/sidepanel-visibility.ts` | The centralized visibility switchboard initially set `chat: 'everyone'`; comments describe `admin` as the way to hide unfinished features from the public extension. |
| Sept. 26, 22:45 | Merge `6a25819f` | The merge later used as the stabilization baseline is an ancestor of the gate change. It establishes chronology, not causation. |
| Sept. 27, 00:30 | `959bdf17`; local Codex thread “Matrx Extend BOSS” / “Organize Matrx Extend testing” | Stabilization takeover begins. The brief reserves Chat/Pilot for last; its handoff says they were deliberately deferred. No instruction to gate guest Chat appears in the inspected task brief or handoff. |
| Sept. 27, 12:11:37 | `b66e979c`, `src/config/sidepanel-visibility.ts` and sidepanel `App.tsx` | Sets Chat audience from `everyone` to `signed-in`, and removes both its tab trigger and pane for guests. The commit comment says: “Guest Chat cannot currently start a reliable run. Keep the Store surface truthful until the guest start contract is repaired.” It also moves Chat after public tabs in the guest default order. |
| Sept. 27, 12:31:51 | `2ca5068b` | Keeps signed-in Chat as the preferred default, changes the AuthGate comment to explain the guest run path is being repaired, and adjusts guest acceptance coverage. |
| Sept. 27, 12:38:36 | Release `56e5d60a`, v0.2.105 | First recorded Store candidate containing the gate. The source release was built and submitted to Google for review that day. |
| Sept. 27 (submission record; exact clock time not stated) | Common-docs `CHROME-WEB-STORE.md`, “September 27 submission record” | Draft 0.2.105 was submitted with automatic publication after approval selected. The record says the listing copy was changed to tell guests to sign in for Chat, and old guest-Chat screenshots were replaced. It records guest Chat as gated pending secure server bootstrap. |
| Sept. 29, 17:05 UTC | Same Store record; current public listing observation | Google’s public listing displayed v0.2.105. This is publication evidence. The submitted source is `56e5d60a`; it does not prove the installed extension’s login works. |

## Attribution and confidence

- **Code decision:** High confidence that the gate was intentionally set in the Sept. 27 patch. The source comment and follow-up AuthGate comment state the rationale plainly.
- **Commit identity:** Git records Armani Sadeghi as author and committer for `b66e979c`, `2ca5068b`, and the release. The `b66e979c` message says “local work not committed by agents who made them,” so Git author fields do not identify who originally wrote that patch. No inspected task message identifies the implementer or records a separate approval. Attribute the recorded integration/release to Armani; original authorship and decision conversation remain unknown.
- **Stabilization relationship:** The stabilization initiative predates the gate and explicitly put systematic Chat/Pilot work last. The guest-path limitation may have become salient during stabilization, but the available handoff and thread metadata do not link that work to the change request. Do not report the thread as the cause.
- **Google’s role:** The evidence proves upload, submission, automatic-publication selection, and later public listing version. It does not establish a Google policy requirement or that Google requested this gate. The contemporaneous reason is the unreliable guest start path / incomplete secure server bootstrap.
- **Behavioral proof:** `docs/feature-tests.md` documents guest navigation with Chat absent and signed-in Chat restoration; the Store record reports exact-release guest navigation/reload checks and a real signed-in Chat response. These are engineering checks, not proof of every guest-start failure or a Google policy review.

## Evidence consulted

`git show` for `632d29b9`, `6a25819f`, `b66e979c`, `2ca5068b`, and `56e5d60a`; `docs/feature-tests.md` § “Store-review guest path”; `docs/stabilization/HANDOFF.md`; and `/Users/armanisadeghi/code/common-docs/systems/clients/extension/CHROME-WEB-STORE.md` § “September 27 submission record” and “Current Store state”. No credentials, private auth data, or reviewer secrets were accessed or copied.
