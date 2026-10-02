# Guest Chat Store change: evidence timeline

## Finding

Guest Chat was deliberately removed from the public side panel because the guest run path was considered unreliable. The code says so directly in the Sept. 27 change; the contemporaneous Store record says guest Chat would remain gated until secure server bootstrap was finished. The same release kept Chat available to signed-in Store reviewers and other signed-in users. This was a product availability decision tied to a technical limitation, not evidence that Google required Chat to be login-gated.

The stabilization campaign did not direct or authorize this change in the user task records inspected. The actual kickoff brief says Chat and Pilot are the hardest areas and must be saved for last, after other surfaces reach 100%; it does not ask to remove guest Chat. The named “Organize Matrx Extend testing” task repeats that defer-first scope. A handoff records an incidental Chat mount during guest flow, but no task message links that observation to the gate. **The evidence does not establish that the stabilization campaign caused the change.**

## Timeline (Pacific time unless marked UTC)

| When | Evidence | What it establishes |
| --- | --- | --- |
| Aug. 20, 2026, 16:30 | `632d29b9`, `src/config/sidepanel-visibility.ts` | The centralized visibility switchboard initially set `chat: 'everyone'`; comments describe `admin` as the way to hide unfinished features from the public extension. |
| Sept. 26, 22:45 | Merge `6a25819f` | The merge later used as the stabilization baseline is an ancestor of the gate change. It establishes chronology, not causation. |
| Sept. 25, 14:27 | Local Codex thread “Matrx Extend BOSS” initial task record (`session_index.jsonl`: updated 21:27Z) | The stabilization campaign is authorized: organize guest/member testing and complete non-Chat/Pilot surfaces first. The request says Chat/Pilot are to be saved for last; it does not ask to gate guest Chat. |
| Sept. 26, 23:57 | Local Codex thread “Organize Matrx Extend testing” initial task record | The testing-taskforce request again defers Chat/Pilot until the other work is complete. No guest-Chat visibility change is requested. |
| Sept. 27, 00:30 | `959bdf17` | A delegated stabilization takeover document is committed. This is a handoff checkpoint, not the campaign start and not a request to gate Chat. |
| Sept. 27, 12:11:37 | `b66e979c`, `src/config/sidepanel-visibility.ts` and sidepanel `App.tsx` | Sets Chat audience from `everyone` to `signed-in`, and removes both its tab trigger and pane for guests. The commit comment says: “Guest Chat cannot currently start a reliable run. Keep the Store surface truthful until the guest start contract is repaired.” It also moves Chat after public tabs in the guest default order. |
| Sept. 27, 12:31:51 | `2ca5068b` | Keeps signed-in Chat as the preferred default, changes the AuthGate comment to explain the guest run path is being repaired, and adjusts guest acceptance coverage. |
| Sept. 27, 12:38:36 | Release `56e5d60a`, v0.2.105 | First recorded Store candidate containing the gate. The source release was built and submitted to Google for review that day. |
| Sept. 27 (submission record; exact clock time not stated) | Common-docs `CHROME-WEB-STORE.md`, “September 27 submission record” | Draft 0.2.105 was submitted with automatic publication after approval selected. The record says the listing copy was changed to tell guests to sign in for Chat, and old guest-Chat screenshots were replaced. It records guest Chat as gated pending secure server bootstrap. |
| Sept. 29, 17:05 UTC | Same Store record; current public listing observation | Google’s public listing displayed v0.2.105. This is publication evidence. The submitted source is `56e5d60a`; it does not prove the installed extension’s login works. |

## Attribution and confidence

- **Code decision:** High confidence that the gate was intentionally set in the Sept. 27 patch. The source comment and follow-up AuthGate comment state the rationale plainly.
- **Human attribution:** `b66e979c`, `2ca5068b`, and the release carry the same Armani Git identity, but this shared checkout’s metadata does not establish who wrote, integrated, or submitted the change. The `b66e979c` subject itself says the local work was “not committed by agents who made them.” The Store record proves the package was submitted and later published, but does not identify the human who uploaded it. The inspected Codex task messages contain no guest-Chat gate request or tool action. The only available Claude project session file predates the gate and contains no matching gate path/comment/commit. **Original implementer, decision owner, integrator, and uploader remain unknown from available session evidence.**
- **Stabilization relationship:** The campaign kickoff task and later named testing task explicitly defer Chat/Pilot and contain no instruction to change guest visibility. The reviewed handoff records an incidental guest Chat mount but no decision or causal link. Do not report the thread as the cause; the available evidence cannot identify what task or conversation prompted the gate.
- **Google’s role:** The evidence proves upload, submission, automatic-publication selection, and later public listing version. It does not establish a Google policy requirement or that Google requested this gate. The contemporaneous reason is the unreliable guest start path / incomplete secure server bootstrap.
- **Behavioral proof:** `docs/feature-tests.md` documents guest navigation with Chat absent and signed-in Chat restoration; the Store record reports exact-release guest navigation/reload checks and a real signed-in Chat response. These are engineering checks, not proof of every guest-start failure or a Google policy review.

## Evidence consulted

`git show` for `632d29b9`, `6a25819f`, `b66e979c`, `2ca5068b`, `56e5d60a`, and `959bdf17`; the local Codex user task messages for “Matrx Extend BOSS” and “Organize Matrx Extend testing” through the gate commit; the filename, modification time, and targeted match results for the one available Claude project session record; `docs/feature-tests.md` § “Store-review guest path”; `docs/stabilization/HANDOFF.md`; and `/Users/armanisadeghi/code/common-docs/systems/apps/extension/CHROME-WEB-STORE.md` § “September 27 submission record” and “Current Store state”. No credentials, private auth data, or reviewer secrets were accessed or copied.
