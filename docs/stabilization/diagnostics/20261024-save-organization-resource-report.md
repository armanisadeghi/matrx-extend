# Save organization repair: resource and release evidence

Recorded 2026-10-24 at 03:06 UTC. This is a checkpoint, not a completed native acceptance report.

The SaveAsPattern repair in `9d7d144dec6eb2b3ed1542d4b7f3ae1c10fb05af` waits for a validated organization before enabling Save. Existing datasets use their own verified organization. The portable bootstrap regression covers nine states, including retry after a null active selection with nonempty memberships; existing organization and page-provenance assertions remain intact.

Hosted release [40056110002](https://github.com/armanisadeghi/matrx-extend/actions/runs/40056110002) completed successfully and published v0.2.599 at `062d2acc6712984a627344dde54e0fe9b6e1c84b`. Its type check passed. Unit tests reported fourteen failures in three older fixtures that omitted fields from the organization hook; the release still went ahead. The fixture-only repair is `e8a65857f`; its hosted full-suite result and exact-artifact native D47 rerun remain pending at this checkpoint.

Local runtime acceptance is not claimed. An initial compile caught three new test typing errors before the documented resource guard was used; that invocation is diagnostic only. The corrected, guarded compile attempts and subsequent focused-test attempt did not start their child commands:

| Completed resource journal | Final refusal |
| --- | --- |
| [Bootstrap type check, attempt 1](../resource-journals/a0e3-extend-bootstrap-tsfix-20261023-01.jsonl) | Measurement failed because the profile directory did not exist. |
| [Bootstrap type check, attempt 2](../resource-journals/a0e3-extend-bootstrap-tsfix-20261023-02.jsonl) | CPU busy 0.64 with one-minute load 30.59 on 32 logical CPUs. |
| [Three repaired hook fixtures](../resource-journals/a0e3-extend599-hook-mocks-20261024-01.jsonl) | CPU busy 0.743 with one-minute load 37.99 on 32 logical CPUs. |

No thresholds were lowered and no alternate local command was used after either CPU refusal. The completed journals contain measurements and final decisions, without child output or credential values. They are retained with this report under PLAN.md's journal-retention contract.

Separately, native Records run [40054118879](https://github.com/armanisadeghi/matrx-extend/actions/runs/40054118879) directly verified the Recorder Idle badge. Its broader approval case did not pass: a scoped policy read confirmed the approved organization uses Never ask, and the server correctly created the single owned test row without an approval hold. The fixture table archive completed. The approval prerequisite and owned-row accounting remain separate work; neither is represented as a whole-case pass here. No existing organization policy was changed.
