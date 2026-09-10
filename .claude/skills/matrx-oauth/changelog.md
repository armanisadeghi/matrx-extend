---
type: Reference
title: "matrx-oauth — changelog"
description: "Merge history of the matrx-oauth skill and the live-code evidence behind its verified verdicts (ES256, SPA paths, ai-matrx naming, admin.admins); the skill sends you here when tracing why a verdict holds. Companion to the matrx-oauth skill."
tags: [matrx-oauth, skills, history]
timestamp: 2026-09-10T00:00:00Z
---

# matrx-oauth — changelog

## This doc replaced two divergent copies

Prior to 2026-08-21 this skill existed as two independently-drifted bodies with no canonical source: `matrx-extend/matrx-oauth/` (nonstandard repo-root location) and `aidream/.claude/skills/matrx-oauth/`. Three claims were verified against live code to build this doc — see the changelog below for the full verdicts and evidence.

## Changelog

- **2026-08-21 — canonical body created, merging two divergent copies** (`matrx-extend/matrx-oauth/` at a nonstandard repo-root location, and `aidream/.claude/skills/matrx-oauth/`). Board row: `operations/doc-migration.md` #47. Three disputed claims verified against live code, not voted between:
  1. **JWT signing algorithm** — matrx-extend copy claimed HS256 (symmetric) is the live signer, used to justify dropping the `openid` scope. aidream copy claimed ES256 is current and the HS256 rationale obsolete. **Verdict: ES256 is correct** (aidream copy) — `aidream/aidream/api/middleware/auth.py` carries an explicit, detailed comment: "Matrx Main signs JWTs with ES256 (asymmetric)... HS256 stays for the rotation window," and `JWT_ALGORITHMS = ("HS256", "ES256")`. HS256 remains accepted only as a compatibility fallback, not as the live signer.
  2. **Repo path for the SPAs** — matrx-extend copy used `dashboard/`, `workflow-studio/` at repo root. aidream copy used `apps/dashboard/`, `apps/workflow-studio/`. **Verdict: `apps/dashboard/` and `apps/workflow-studio/` are correct** (aidream copy) — confirmed on disk at `aidream/apps/dashboard` and `aidream/apps/workflow-studio`; no bare `dashboard/` exists at aidream's repo root.
  3. **App/provider naming ("matrx-admin" vs "ai-matrx")** — matrx-extend copy labeled the Next.js provider app "matrx-admin" and referenced it at `projects/matrx-admin/`. aidream copy labeled it "ai-matrx" and referenced `../ai-matrx/`. **Verdict: neither path was correct; the label "ai-matrx" is correct.** The actual Next.js OAuth proxy lives at `matrx-frontend/app/api/oauth/{authorize,token}/route.ts`, deployed as the `ai-matrx` Vercel project (`matrx-frontend/next.config.js` documents `ai-matrx → aimatrx.com → MATRX_PROFILE=slim`). "matrx-admin" does not match any live deployment or directory name.
  - Also corrected in the merge (found during verification, not part of the three named disputes): the admin table is `admin.admins` (matrx-extend copy still said `public.admins`); the callback's token-claim path (`_decode_jwt_payload`) is confirmed still unverified in live code as of this date — the aidream copy's claim that it already routes through `verify_supabase_token` is aspirational, not the current state, and is corrected in SKILL.md (hard-won fact 7).
  - **Unverified, left out:** whether `openid` truly cannot be requested today — the code comment justifying that decision is itself stale (still cites HS256), so this is flagged rather than asserted either way.
