# Guest Chat release review

Guest Chat now works without sign-in on the receipt-matched, keyed unpacked build for release 0.2.130. This is not a CRX installed from the live Chrome Web Store. The 0.2.130 draft is uploaded in the publisher dashboard but **has not been submitted to Google**. Store submission is expressly on hold pending your review and the other agent's server work; this packet authorizes no submission.

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
- A fresh guest in isolated native Chrome used the keyed unpacked 0.2.130 release tree matching the receipt (extension ID `cihdmkcdjjckfhjpgoedmgfpoljebaml`). The test did not install a CRX from the live Chrome Web Store; the public listing still showed 0.2.105, while 0.2.130 was an unsubmitted draft. The guest sent a page-aware question and received a real answer with an unpredictable page code and the requested workflow stages. After reloading the panel, the test reinstalled its page fixture, started a new guest conversation, and received a second answer containing the new code and fixture heading. The unpacked tree hash matched the receipt. This is a new conversation after reload, not persisted conversation continuity, and it does not establish behavior of the currently published 0.2.105 package.
- The final independent review marks runtime and source results `PASS_SCOPED`; the bounded guest-Chat flow is verified. The real signed-in-account → sign-out → guest transition was not exercised in native UI, and broad coverage across organizations, agents, streams, and recovery paths remains unverified.
- Native reviewer run `reviewer-chat-native-002` used a real signed-in account and completed a real Chat answer on the receipt-matched unpacked candidate. The observed role category was `absent`; the script's `observedRoleCategory !== 'admin'` predicate treats an absent role as acceptable, so this run does not prove the account was non-admin. The screenshot also displays “Failed to read page” before showing extracted article text and the answer; this run proves signed-in Chat completed, not broad or reliable page-capture fidelity. The non-admin Store reviewer experience remains unverified.
- The real signed-in-account → sign-out → guest transition was not exercised in native UI, and broad coverage across organizations, agents, streams, and recovery paths remains unverified.
- The publisher dashboard was freshly checked: the 0.2.130 draft is present and remains unsubmitted. The public Store still showed 0.2.105 at the observed time.

## Reviewer steps

For guest Chat, open [the public demo page](https://www.aimatrx.com/matrx-extend-demo) in a normal browser tab, open the extension's Chat tab while signed out, and ask: “What are the three workflow stages on this page?” Expect **Capture, Understand, Use**. Reload the extension panel while remaining signed out, then ask another question grounded in the page. Scrape, Structure, and SEO are also available to guests. Guest Chat does not require a paid account.

For signed-in-only checks, use reviewer credentials already provided through the approved review channel with the ordinary sign-in flow; choose the reviewer organization if prompted. No credentials are included in this packet. The candidate's extension permissions are unchanged.

The prepared evidence-review hold is tracked in the human-required [Agent Review row](https://manage.aimatrx.com/administration/users/agent-review/4169515a-eab4-475d-9e5d-7c2d63837954) (conversation `a993d2cf-1810-4d27-accd-6ecb910218d4`). Its status is `submitted` / `human_required`, and `store_submission_authorized` is false. That row is for human review of the evidence; it does not authorize Store submission or clear the current hold.

## Artifact identity

| Item | Value |
| --- | --- |
| Version | `0.2.130` |
| Source SHA in release receipt | `10ac483f35d97faf5affdd57d8c4a5a258d91c65` |
| Extension tree SHA-256 | `be0f08139c1ae8e518eb71cc8200c60e217c8ea64300cf9ee5b406e0c38a0a56` |
| Store ZIP SHA-256 | `9bdf93b207cef0ff849189b124f1899a8a425a860e5801dcbd164a9c4c75467a` |
| Local ZIP SHA-256 | `94978c2c63d01dbc26d04666b0f50f884d32a6c4da7d7a037a727b8787a77c0c` |
| Native test surface | Keyed unpacked release tree matching receipt; not installed Google Web Store CRX |
| Store submission | **On hold; not submitted or authorized** |

## Review status

- [x] Restore guest Chat and public guest routing.
- [x] Pass the recorded release check suite: 1,803 passed, 5 skipped.
- [x] Pass real guest question and a second real guest turn after panel reload on the receipt-matched, keyed unpacked 0.2.130 release tree (not a Google-installed CRX).
- [x] Confirm the publisher dashboard contains the 0.2.130 draft and the public listing remains 0.2.105.
- [x] Verify signed-in Chat can complete a real answer on the current candidate.
- [ ] Verify a real signed-in non-admin reviewer can use Chat; current run has no observed role category, so non-admin status is not proven.
- [ ] Verify the signed-in account → sign-out → guest transition in native UI.
- [ ] Review and confirm before any Store submission.

The defect remains open for the unverified account-to-guest privacy transition and non-admin review. No Store submission is authorized by this packet.

## Before submission

Another agent is changing parts of the server flow. The successful tests above describe the server at their observation time, not a guarantee about subsequent deployments; the reported backend recovery is time-bounded, and the live SQL change's actor, task, and timestamp are unknown. Reconcile the server work, rerun guest and signed-in acceptance against the final server, and replace/retest the extension artifact if its contract must change. The no-login reviewer guidance remains the intended acceptance contract.

The [new screenshot candidate](evidence/guest-chat-0.2.130/guest-chat-store-candidate.png) shows a real guest answer from the normal demo, without synthetic test codes. It is prepared for review, not yet uploaded to the listing; its 640×400 crop clips part of the question and should be reviewed before use. The draft description and reviewer steps have been saved. No submission or publication action is authorized; the current hold remains until Arman's review and the other agent's server work are complete.
