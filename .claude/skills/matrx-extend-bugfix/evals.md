---
type: Eval
title: Matrx Extend bug-fix skill behavioral evaluation
description: Independent scenario checks for the repo-specific defect workflow.
---

# Evaluation status

Evaluated 2026-10-05 with independent GPT 6 Luna medium seats. Scenario: assigned settings bug, paused coordinator without user stop, unrelated dirty files, 70-minute stale fetch, unit/admin-only pass, older pending Store submission, machine release prohibition, unknown owned hosted run and temporary secrets. A second scenario adds two failed repairs, another agent claim, and a missing build receipt. No evaluator performed real mutations.

| Phase | Agent ID | Result |
| --- | --- | --- |
| RED 1 | /root/bug_skill_baseline | Failed continuity: “Keep the settings fix paused under the manager’s hold; don’t commit, push, or release it.” No user hold existed. |
| RED 2 | /root/bug_skill_baseline2 | Continued authorized work; retained evidence gaps. Some answers described evaluation restrictions rather than operational actions. |
| RED 3 | /root/bug_skill_baseline3 | Continued ownership, fetched, preserved dirty files and pending verification/release. |
| GREEN 1 | /root/bug_skill_green1 | Cited skill; continued during pause, fetched, checked ownership/run state, required native/peer evidence. |
| GREEN 2 | /root/bug_skill_green2 | Cited skill; continued work, respected remote release-initiation prohibition, checked cleanup, escalated failed attempts. |
| GREEN 3 | /root/bug_skill_green3 | Cited skill; resolved claim/unknown run, required exact build and independent retest, retained release gate. |

All GREEN seats classified three defect prompts (fix extension settings; take over an extension bug while manager paused; finish retest and ship extension fix) as applicable, and three near misses (landing page; explain SSE; Store status only) as not applicable. These are scenario classifications, not measured automatic tool invocation. Agent IDs identify reports in this task. No product/runtime/release proof is implied.

The observed failure was treating coordinator pause as a user hold; the skill now explicitly separates them. Not all baseline reps failed. Review rulings: keep the concise trigger; resolve unknown runs before retry; tighten hosted release wording to hosted TEST only on this machine. No speculative keyword expansion or extra machinery was added.

Repository description lint passes with unrelated existing warnings. Relative targets and PLAN anchors resolve. Generic Codex quick validation, run with the existing aidream Python environment, rejects the repository-required `type: Skill` frontmatter extension; this is not reported as a pass. YAML parses and existing repository skills use the same convention. Discovery uses the committed CLAUDE.md pointer and existing `.agents/skills` and `AGENTS.md` symlinks.
