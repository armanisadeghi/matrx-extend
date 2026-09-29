# Guest Chat release review

Guest Chat passed the bounded guest acceptance on the receipt-matched 0.2.130 candidate, and a fresh non-admin reviewer run completed a real Chat answer. On September 29 at 21:44 UTC, the exact 0.2.130 Store ZIP was submitted to the primary Chrome Web Store item and the dashboard showed **Pending review**. Automatic publishing was checked. This records submission, not publication: the public listing may still serve 0.2.105 until Google completes review. The signed-in-to-guest privacy transition and broader Chat coverage remain unverified.

## What happened

The public listing was observed on version 0.2.105 on September 29 at 19:29 UTC. That version hid Chat from guests and told them to sign in. The gate was added in the September 27 changes because guest Chat could not reliably start; the records reviewed do not show that Google required the gate or that the stabilization campaign caused it. Git commits carry a shared identity, so they do not establish the actual implementer, integrator, or uploader. See the [incident timeline](reports/guest-chat-incident-timeline.md).

A fresh guest request later reached the backend but failed while streaming: the guest had zero active organization memberships. At the live database observation recorded in the [backend timeline](reports/guest-chat-backend-timeline.md), the signup function provisioned an organization for anonymous users, consistent with the funnel's one-membership contract. This is time-bounded evidence, not a guarantee about backend state after later server changes. The database change has no local migration or matching local backend commit; its actor, task, timestamp, and exact causal path are unknown.

### Confirmed timeline (Pacific time)

- September 27, 12:11:37 p.m.: `b66e979c` changes the Chat audience from everyone to signed-in users.
- September 27, 12:31:51 p.m.: `2ca5068b` keeps that gate and changes the guest test to expect Chat to be absent.
- September 27, approximately 12:38 p.m.: version 0.2.105 is released, then uploaded/submitted that day.
- September 29: Google publishes 0.2.105. The live listing and dashboard verify the version; the exact publication minute is not established.

These are code and release facts, not proof of a particular person's or agent's identity. There is no evidence that Google required this gate, and no evidence that a paid account was required; the confirmed regression was the login requirement.

## What changed in the extension

The repair restores Chat to guest navigation and makes it the guest default. Guest sends use the public `extend.browser_chat` Mandate and do not reuse saved account Agent choices or signed-in catalog/execution reads. Once authentication and chat storage finish loading, the UI waits until the current actor matches the stored actor; on identity change it clears the previous account's conversation, messages, draft, variables, attachments, Google file selections, highlights, permissions, and compute binding. It also fences a canceled stream before the asynchronous cancellation completes, so late stream events cannot repopulate cleared state.

## Evidence for this candidate

- The guarded release checks recorded **1,803 passing and 5 skipped**.
- A fresh guest in isolated native Chrome used the keyed unpacked 0.2.130 release tree matching the receipt (extension ID `cihdmkcdjjckfhjpgoedmgfpoljebaml`). The test did not install a CRX from the live Chrome Web Store; the public listing still showed 0.2.105, before the subsequent submission of 0.2.130. The guest sent a page-aware question and received a real answer with an unpredictable page code and the requested workflow stages. After reloading the panel, the test reinstalled its page fixture, started a new guest conversation, and received a second answer containing the new code and fixture heading. The unpacked tree hash matched the receipt. This is a new conversation after reload, not persisted conversation continuity, and it does not establish behavior of the currently published 0.2.105 package.
- The final independent review marks runtime and source results `PASS_SCOPED`; the bounded guest-Chat flow is verified. Reviewer presubmit 003 completed a real signed-in non-admin Chat answer; live database matching of its reviewer fingerprint found no admin assignment. The real signed-in-account → sign-out → guest transition was not exercised in native UI, and broad coverage across organizations, agents, streams, and recovery paths remains unverified.
- Historical native reviewer run `reviewer-chat-native-002` completed a real signed-in Chat answer, but its observed role category was absent and its script accepted absence as non-admin. Fresh reviewer presubmit 003 closes that specific identity gap: its sanitized account fingerprint matched the live reviewer record, and the live role lookup found no admin assignment. This proves a non-admin could complete a real answer on the candidate. Reviewer 003 shows clean Capture → Understand → Use output and a green Context status; it did not reproduce reviewer 002’s earlier “Failed to read page” row, but one clean sample does not prove that failure class is fully resolved or establish broad Chat health.
- The publisher dashboard was checked after submission: the primary item showed 0.2.130 **Pending review** at 2026-09-29 21:44 UTC, with automatic publishing enabled. The public listing is not yet verified on 0.2.130.

## Reviewer steps

For guest Chat, open [the public demo page](https://www.aimatrx.com/matrx-extend-demo) in a normal browser tab, open the extension's Chat tab while signed out, and ask: “What are the three workflow stages on this page?” Expect **Capture, Understand, Use**. Reload the extension panel while remaining signed out, then ask another question grounded in the page. Scrape, Structure, and SEO are also available to guests. Guest Chat does not require a paid account.

For signed-in-only checks, use reviewer credentials already provided through the approved review channel with the ordinary sign-in flow; choose the reviewer organization if prompted. No credentials are included in this packet. The candidate's extension permissions are unchanged.

The [Agent Review row](https://manage.aimatrx.com/administration/users/agent-review/4169515a-eab4-475d-9e5d-7c2d63837954) (conversation `a993d2cf-1810-4d27-accd-6ecb910218d4`) now records the conditional submission authorization, the actual Pending review event, and the remaining verification gaps.

## Artifact identity

| Item | Value |
| --- | --- |
| Version | `0.2.130` |
| Source SHA in release receipt | `10ac483f35d97faf5affdd57d8c4a5a258d91c65` |
| Extension tree SHA-256 | `be0f08139c1ae8e518eb71cc8200c60e217c8ea64300cf9ee5b406e0c38a0a56` |
| Store ZIP SHA-256 | `9bdf93b207cef0ff849189b124f1899a8a425a860e5801dcbd164a9c4c75467a` |
| Local ZIP SHA-256 | `94978c2c63d01dbc26d04666b0f50f884d32a6c4da7d7a037a727b8787a77c0c` |
| Native test surface | Keyed unpacked release tree matching receipt; not installed Google Web Store CRX |
| Store submission | **Submitted 2026-09-29 21:44 UTC; Pending review; automatic publishing checked** |

## Review status

- [x] Restore guest Chat and public guest routing.
- [x] Pass the recorded release check suite: 1,803 passed, 5 skipped.
- [x] Pass real guest question and a second real guest turn after panel reload on the receipt-matched, keyed unpacked 0.2.130 release tree (not a Google-installed CRX).
- [x] Submit the exact 0.2.130 ZIP to the primary Store item; dashboard showed Pending review and automatic publishing checked.
- [x] Verify a real signed-in non-admin reviewer can complete a Chat answer; reviewer presubmit 003 fingerprint matched the live reviewer record with no admin assignment.
- [ ] Verify the signed-in account → sign-out → guest transition in native UI.
- [ ] Verify the public listing after Google publishes 0.2.130.
- [ ] Broaden Chat verification across organizations, agents, streams, and recovery paths.

The defect remains open until public-version verification and the signed-in-to-guest privacy transition are complete. Non-admin reviewer acceptance is now verified on the candidate; the historical 0.2.105 public regression has not yet been verified against a published repair.

## After submission

The fresh guest presubmit 006 and reviewer presubmit 003 passed against the submitted candidate after the server work was reconciled. This is bounded acceptance evidence, not full Chat health. The live SQL change's actor, task, and timestamp remain unknown. Next verify the public listing after Google publishes the candidate and exercise the native signed-in-to-guest transition.

The [screenshot candidate](evidence/guest-chat-0.2.130/guest-chat-store-candidate.png) shows a real guest answer from the normal demo, without synthetic test codes. Its 640×400 crop clips part of the question. The listing is submitted and pending Google review; do not describe it as published until the public listing verifies the new version.
