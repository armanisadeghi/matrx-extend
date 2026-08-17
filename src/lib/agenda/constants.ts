/**
 * Hardcoded client-side fallback agent for Agenda runs when the user hasn't
 * picked an override.
 *
 * 🚨 KNOWN GAP — this is NOT the platform's canonical answer to "which agent
 * runs". The canonical system is Mandates: code names a `mandate_key` and the
 * DATABASE decides, resolved lowest-to-highest as system default
 * (agent.mandate) → org binding → user binding → run-scope argument,
 * with org/user bindings in agent.mandate_binding. A constant baked into the
 * extension bundle can see none of those layers: an admin repin, an org
 * binding, or a user binding all go unnoticed until the extension ships again.
 *
 * matrx-extend currently has ZERO Mandate coverage. Converting this constant (and
 * the settings-store default that shadows it) to a resolved Mandate is tracked as
 * rows E1/E2 in the rollout worklist. Do not treat this pattern as a model to
 * copy into new code.
 *
 * System of record: common-docs/systems/mandates/RUNTIME.md
 * Worklist:         common-docs/systems/mandates/ROLLOUT.md (rows E1/E2)
 */
export const DEFAULT_AGENDA_AGENT_ID = '443dd7ff-e7cc-47b8-907a-0a14834caa48';

/**
 * Surface ID this build of the extension reports as. Multi-surface aware:
 * matches the v2 context's `client.surface` so server-side routing works.
 */
export const AGENDA_SURFACE_ID = 'chrome-extension-chat' as const;
