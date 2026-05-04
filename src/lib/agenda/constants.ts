/**
 * The system's default agent for Agenda runs when the user hasn't picked
 * an override. Set in Supabase by platform admin; mirrored here so the
 * client doesn't have to fetch it on every run.
 */
export const DEFAULT_AGENDA_AGENT_ID = '443dd7ff-e7cc-47b8-907a-0a14834caa48';

/**
 * Surface ID this build of the extension reports as. Multi-surface aware:
 * matches the v2 context's `client.surface` so server-side routing works.
 */
export const AGENDA_SURFACE_ID = 'chrome-extension-chat' as const;
