# Guest Chat release review

Guest Chat now works without sign-in on the exact 0.2.130 Store artifact. The 0.2.130 draft is uploaded in the publisher dashboard but **has not been submitted to Google**. Submission remains held for your review and confirmation.

## What happened

The public listing was observed on version 0.2.105 on September 29 at 19:29 UTC. That version hid Chat from guests and told them to sign in. The gate was added in the September 27 changes because guest Chat could not reliably start; the records reviewed do not show that Google required the gate or that the stabilization campaign caused it. Git commits carry a shared identity, so they do not establish the actual implementer, integrator, or uploader. See the [incident timeline](reports/guest-chat-incident-timeline.md).

A fresh guest request later reached the backend but failed while streaming: the guest had zero active organization memberships. The current backend is recovered. The live signup function now provisions an organization for anonymous users, consistent with the funnel's one-membership contract. This database change has no local migration or matching local backend commit; its actor, task, timestamp, and exact causal path are unknown. See the [backend timeline](reports/guest-chat-backend-timeline.md).

## What changed in the extension

The repair restores Chat to guest navigation and makes it the guest default. Guest sends use the public `extend.browser_chat` Mandate and do not reuse saved account Agent choices or signed-in catalog/execution reads. Once authentication and chat storage finish loading, the UI waits until the current actor matches the stored actor; on identity change it clears the previous account's conversation, messages, draft, variables, attachments, Google file selections, highlights, permissions, and compute binding. It also fences a canceled stream before the asynchronous cancellation completes, so late stream events cannot repopulate cleared state.

## Evidence for this candidate

- The guarded release checks recorded **1,803 passing and 5 skipped**.
- A fresh guest on the exact 0.2.130 Store artifact sent a page-aware question and received a real answer with an unpredictable page code and the requested workflow stages. After reloading the panel, the test reinstalled its page fixture, started a new guest conversation, and received a second answer containing the new code and fixture heading. The artifact hash matched the receipt. This is a new conversation after reload, not persisted conversation continuity.
- The final independent review marks runtime and source results `PASS_SCOPED`; the bounded guest-Chat flow is verified. The real signed-in-account → sign-out → guest transition was not exercised in native UI, and broad coverage across organizations, agents, streams, and recovery paths remains unverified.
- The non-admin Store reviewer flow has saved steps in `tests/browser/reviewer-chat-store-acceptance.mjs`, including an interactive manual-login mode. It has **not** been run on this candidate. The current non-admin Store experience is therefore unverified.
- The publisher dashboard was freshly checked: the 0.2.130 draft is present and remains unsubmitted. The public Store still showed 0.2.105 at the observed time.

## Artifact identity

| Item | Value |
| --- | --- |
| Version | `0.2.130` |
| Source SHA in release receipt | `10ac483f35d97faf5affdd57d8c4a5a258d91c65` |
| Extension tree SHA-256 | `be0f08139c1ae8e518eb71cc8200c60e217c8ea64300cf9ee5b406e0c38a0a56` |
| Store ZIP SHA-256 | `9bdf93b207cef0ff849189b124f1899a8a425a860e5801dcbd164a9c4c75467a` |
| Local ZIP SHA-256 | `94978c2c63d01dbc26d04666b0f50f884d32a6c4da7d7a037a727b8787a77c0c` |
| Store submission | **Held; not submitted** |

## Review status

- [x] Restore guest Chat and public guest routing.
- [x] Pass the recorded release check suite: 1,803 passed, 5 skipped.
- [x] Pass real guest question and a second real guest turn after panel reload on the receipt-matched 0.2.130 Store artifact.
- [x] Confirm the publisher dashboard contains the 0.2.130 draft and the public listing remains 0.2.105.
- [ ] Verify a real signed-in non-admin reviewer can use Chat on the current candidate.
- [ ] Verify the signed-in account → sign-out → guest transition in native UI.
- [ ] Review and confirm before any Store submission.

The defect remains open for the unverified account-to-guest privacy transition and non-admin review. No submission is authorized by this packet.
