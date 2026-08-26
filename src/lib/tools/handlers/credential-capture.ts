/**
 * `credential_login` actions `capture` / `propose_recipe` — on-the-fly
 * credential capture (D-11). Formerly the standalone `capture_credential`
 * tool; merged into `credential_login` in the 2026-08-21 credential
 * consolidation (one credential tool, actions built in).
 *
 * Where the login actions USE a credential we
 * already hold, `capture` handles the case where the agent hits a
 * login it has NO stored credential for. Instead of the agent asking the human
 * to log in — and seeing the password — this tool:
 *
 *   1. derives the REAL tab origin (never an agent-supplied URL) and asks the
 *      server the known/unknown branch (is there a login recipe for this site?);
 *   2. shows the USER a username/password box (the capture card in the
 *      sidepanel), pre-labelled from the agent's field map;
 *   3. the user types; the CARD writes the values straight to the vault with the
 *      agent's metadata (site name, description, url, field map / selectors) —
 *      🚨 the typed values NEVER pass through this handler, a tool argument, a
 *      tool result, the debug log, or model context;
 *   4. hands the agent back a receipt: the new credential_item_id and "proceed".
 *
 * Known/unknown branch (D-11):
 *   - KNOWN  → the receipt returns the recipe so the agent maps exact selectors.
 *   - UNKNOWN → the receipt asks the agent to document a PROPOSED recipe right
 *     then (`action: 'propose_recipe'`) with selectors-by-name + what success /
 *     failure / a challenge look like. A human activates it; the agent proposes.
 *
 * Arguments carry ONLY agent metadata — NEVER a credential value. The value has
 * no shape it could ride in on this handler's arguments or results.
 */

import {
  type CaptureContext,
  type VaultCallFailure,
  fetchCaptureContext,
  hasRealUserToken,
  proposeLoginRecipe,
} from '@/lib/api/routes/vault';
import { isSafeDestination, normalizeLoginUrl } from '@/lib/credentials/login-urls';
import { log } from '@/lib/debug/log';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { getAssignedTab } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

// ── Args ──────────────────────────────────────────────────────────────────
// Flat schema (mirrors tool_def.parameters 1:1 for the drift comparator), with
// an `action` discriminator validated in superRefine. NO value field exists on
// any variant — the schema itself is the guarantee that the model cannot supply
// a credential.

const CaptureFieldArg = z.object({
  /** Vault key the user's typed value will be stored under (e.g. "password"). */
  field_key: z.string().min(1),
  /** CSS selector the agent identified for this field on the login form. */
  selector: z.string().min(1),
  /** Label to show the user beside the box. */
  label: z.string().optional(),
  /** Mask the box (password-style). Defaults true. */
  secret: z.boolean().optional(),
  step: z.number().int().min(0).optional(),
});

const SignalArg = z.object({
  kind: z.enum([
    'selector_present',
    'selector_absent',
    'url_prefix',
    'cookie_present',
    'text_present',
  ]),
  value: z.string().min(1),
  direction: z.enum(['authenticated', 'challenged', 'rejected']),
  weight: z.number().min(0).max(1).optional(),
  label: z.string().optional(),
});

/** action='capture' — save a NEW login via the sidepanel capture card. */
export const CaptureArgs = z
  .object({
    action: z.literal('capture'),
    /** Human name for the credential (e.g. "Acme Admin — personal"). Required. */
    display_name: z.string().min(1),
    /** The fields the agent identified on the login form (NAMES + selectors). Required. */
    fields: z.array(CaptureFieldArg).min(1),
    /** Cloud Browser session (server executor only). The extension derives its tab. */
    session_id: z.string().min(1).optional(),
    /** One-line description of the site, for the vault item. */
    description: z.string().optional(),
    /** Provider key, if the agent recognizes the site. */
    provider_key: z.string().optional(),
    /** The submit control selector the agent identified. */
    submit_selector: z.string().optional(),
  })
  .strict();

/** action='propose_recipe' — document an UNKNOWN site's login after a capture. */
export const ProposeRecipeArgs = z
  .object({
    action: z.literal('propose_recipe'),
    field_map: z
      .array(
        z.object({
          step: z.number().int().min(0).optional(),
          selector: z.string().min(1),
          field_key: z.string().optional(),
          literal_key: z.string().optional(),
        }),
      )
      .min(1),
    session_id: z.string().min(1).optional(),
    provider_key: z.string().optional(),
    submit: z.record(z.string(), z.unknown()).optional(),
    submit_selector: z.string().optional(),
    success_signals: z.array(SignalArg).optional(),
    failure_signals: z.array(SignalArg).optional(),
    challenge_signals: z.array(SignalArg).optional(),
    notes: z.string().optional(),
  })
  .strict();

export type CaptureCredentialArgs = z.infer<typeof CaptureArgs> | z.infer<typeof ProposeRecipeArgs>;

// The complete set of statuses this tool may return. No value ever rides here.
export type CaptureCredentialStatus =
  | 'captured'
  | 'cancelled'
  | 'spec_incomplete'
  | 'recipe_proposed'
  | 'no_active_tab'
  | 'unsafe_destination'
  | 'sign_in_required'
  | 'vault_error'
  | 'unknown';

export interface CaptureCredentialResult {
  status: CaptureCredentialStatus;
  reason?: string;
  message?: string;
  credential_item_id?: string;
  branch?: 'known' | 'unknown';
  /** On known: the recipe so the agent maps exact selectors. Never a value. */
  recipe?: unknown;
  /** On unknown: ask the agent to document a recipe now. */
  propose_recipe?: boolean;
  recipe_id?: string | null;
  /** Static instruction for the agent's next step. */
  guidance?: string;
  proceed?: boolean;
}

/** The request the SW broadcasts to the sidepanel capture card. No value. */
export interface CaptureCredentialRequest {
  callId: string;
  conversationId: string | null;
  display_name: string;
  description: string | null;
  provider_key: string | null;
  login_url: string;
  host: string;
  submit_selector: string | null;
  uri_match_mode: 'host' | 'exact' | 'never';
  branch: 'known' | 'unknown';
  guidance: string;
  /**
   * Epoch ms after which this request is dead. The tool returns `timed_out` to
   * the agent at this moment, so the card MUST NOT write a vault item past it —
   * otherwise a late Save lands a credential after the agent has moved on.
   */
  expires_at_ms: number;
  fields: Array<{
    field_key: string;
    selector: string;
    label: string;
    secret: boolean;
    step: number;
  }>;
}

/**
 * The card's reply. It has ALREADY written the credential to the vault (values
 * went card → server directly); the SW only learns the outcome, never a value.
 */
export interface CaptureCredentialResponse {
  callId: string;
  cancelled?: boolean;
  ok?: boolean;
  credential_item_id?: string | null;
  branch?: 'known' | 'unknown' | null;
  propose_recipe?: boolean;
  reason?: string;
}

function failureResult(failure: VaultCallFailure): CaptureCredentialResult {
  if (failure.kind === 'sign_in_required') {
    return {
      status: 'sign_in_required',
      message:
        'Sign in to Matrx in the extension side panel before capturing a credential. The vault does not accept anonymous identities.',
    };
  }
  if (failure.kind === 'forbidden') {
    return { status: 'vault_error', reason: 'vault_access_denied' };
  }
  return { status: 'vault_error', reason: `vault_error_${failure.status}` };
}

/** Broadcast the capture request and await the card's outcome. Never resolves a value. */
function awaitCapture(
  request: CaptureCredentialRequest,
  timeoutMs: number,
): Promise<CaptureCredentialResponse | 'timed_out'> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (out: CaptureCredentialResponse | 'timed_out') => {
      if (resolved) return;
      resolved = true;
      off();
      if (timer != null) clearTimeout(timer);
      resolve(out);
    };
    const off = on<CaptureCredentialResponse, { ack: true }>(
      CHANNELS.TOOL_CAPTURE_CREDENTIAL_RESPONSE,
      (payload) => {
        if (payload.callId !== request.callId) return { ack: true };
        finish(payload);
        return { ack: true };
      },
    );
    const timer = setTimeout(() => finish('timed_out'), timeoutMs);
    broadcast(CHANNELS.TOOL_CAPTURE_CREDENTIAL_REQUEST, request);
  });
}

/** How long the user has to type before the capture card expires. */
const CAPTURE_TIMEOUT_MS = 5 * 60 * 1000;

/** The capture/propose_recipe implementation, dispatched from the
 * `credential_login` handler after its sign-in gate. */
export const runCredentialCapture: (
  args: CaptureCredentialArgs,
  ctx: Parameters<ToolHandler<CaptureCredentialArgs, CaptureCredentialResult>['run']>[1],
) => Promise<CaptureCredentialResult> = async (args, ctx): Promise<CaptureCredentialResult> => {
  if (!(await hasRealUserToken())) {
    return {
      status: 'sign_in_required',
      message: 'Sign in to Matrx in the extension side panel before capturing a credential.',
    };
  }

  // ── action: propose_recipe — document an UNKNOWN login ────────────────
  if (args.action === 'propose_recipe') {
    const tab = await getAssignedTab(ctx);
    const origin = tab?.url ? safeOrigin(tab.url) : null;
    if (!origin) return { status: 'no_active_tab', reason: 'origin_unresolved' };
    const proposal = await proposeLoginRecipe({
      normalized_origin: origin,
      ...(args.provider_key !== undefined ? { provider_key: args.provider_key } : {}),
      field_map: (args.field_map ?? []).map((m) => ({
        ...(m.step !== undefined ? { step: m.step } : {}),
        selector: m.selector,
        ...(m.field_key !== undefined ? { field_key: m.field_key } : {}),
        ...(m.literal_key !== undefined ? { literal_key: m.literal_key } : {}),
      })),
      ...(args.submit !== undefined ? { submit: args.submit } : {}),
      ...(args.success_signals !== undefined ? { success_signals: args.success_signals } : {}),
      ...(args.failure_signals !== undefined ? { failure_signals: args.failure_signals } : {}),
      ...(args.challenge_signals !== undefined
        ? { challenge_signals: args.challenge_signals }
        : {}),
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
    });
    if (!proposal.ok) return failureResult(proposal.failure);
    log.info('sw', `credential_login capture → recipe_proposed (${proposal.data.status})`);
    return {
      status: 'recipe_proposed',
      recipe_id: proposal.data.recipe_id ?? null,
      message:
        'Proposed a login recipe for this site. A human activates it before it is used; it will make this login reliable next time.',
    };
  }

  // ── action: capture ───────────────────────────────────────────────────
  const tab = await getAssignedTab(ctx);
  if (!tab?.id || !tab.url) return { status: 'no_active_tab' };
  let pageUrl: URL;
  try {
    pageUrl = new URL(tab.url);
  } catch {
    return { status: 'unsafe_destination', reason: 'unparsable_url' };
  }
  if (!isSafeDestination(pageUrl)) {
    return {
      status: 'unsafe_destination',
      reason: 'insecure_scheme',
      message: 'Credential capture requires https (or an explicit localhost destination).',
    };
  }
  const loginUrl = normalizeLoginUrl(tab.url) ?? `${pageUrl.origin}${pageUrl.pathname}`;

  // Known/unknown branch — origin derived server-side from the real tab URL.
  const contextResult = await fetchCaptureContext(loginUrl);
  if (!contextResult.ok) return failureResult(contextResult.failure);
  const branchContext: CaptureContext = contextResult.data;

  const fields = (args.fields ?? []).map((f) => ({
    field_key: f.field_key,
    selector: f.selector,
    label: f.label ?? f.field_key,
    secret: f.secret ?? f.field_key !== 'username',
    step: f.step ?? 0,
  }));

  const request: CaptureCredentialRequest = {
    callId: ctx.callId,
    conversationId: ctx.conversationId,
    display_name: args.display_name ?? pageUrl.host,
    description: args.description ?? null,
    provider_key: args.provider_key ?? null,
    login_url: loginUrl,
    host: pageUrl.host,
    submit_selector: args.submit_selector ?? null,
    uri_match_mode: 'host',
    branch: branchContext.branch,
    guidance: branchContext.guidance,
    expires_at_ms: Date.now() + CAPTURE_TIMEOUT_MS,
    fields,
  };

  const outcome = await awaitCapture(request, CAPTURE_TIMEOUT_MS);
  if (outcome === 'timed_out') {
    return { status: 'cancelled', reason: 'timed_out', message: 'The user did not respond.' };
  }
  if (outcome.cancelled || !outcome.ok) {
    return {
      status: 'cancelled',
      reason: outcome.reason ?? 'user_cancelled',
      message: 'The user did not enter a credential.',
    };
  }

  // Status + names only — the value never reached this handler.
  log.info('sw', `credential_login capture → captured (branch=${branchContext.branch})`);
  const result: CaptureCredentialResult = {
    status: 'captured',
    proceed: true,
    branch: branchContext.branch,
    guidance: branchContext.guidance,
  };
  if (outcome.credential_item_id) result.credential_item_id = outcome.credential_item_id;
  if (branchContext.branch === 'known' && branchContext.recipe) {
    result.recipe = branchContext.recipe;
  }
  if (branchContext.branch === 'unknown') {
    result.propose_recipe = true;
  }
  return result;
};

/** origin only, or null — never throws, never carries a path/query. */
function safeOrigin(raw: string): string | null {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}
