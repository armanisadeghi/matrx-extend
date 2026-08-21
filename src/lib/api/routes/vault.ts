/**
 * Vault routes — the ONE server contract this extension has with the Vault,
 * and the only path that can hand it credential plaintext.
 *
 *   Browser login (agent-safe, consumed by the `credential_login` tool):
 *     POST  /api/vault/browser-login/matches
 *     POST  /api/vault/browser-login/{item_id}/materialize
 *     POST  /api/vault/browser-login/{item_id}/result
 *
 *   Item management (consumed by the Vault side panel):
 *     GET   /api/vault/items?principal_type=user
 *     GET   /api/vault/shared-with-me
 *     GET   /api/vault/items/{item_id}
 *     POST  /api/vault/items
 *     PATCH /api/vault/items/{item_id}
 *     POST  /api/vault/items/{item_id}/reveal
 *
 * Four rules this module exists to enforce:
 *
 * 1. **A real user JWT or nothing.** `src/lib/api/client.ts#buildHeaders`
 *    falls back to an `X-Fingerprint-ID` guest signature when no session
 *    exists — the server REJECTS that identity for every route here, by
 *    design. So every call is gated on `getAccessToken()` first and reports
 *    `sign_in_required` rather than letting the request go out and come
 *    back as an opaque 401/403.
 * 2. **No second HTTP client.** Everything goes through `apiGet` / `apiPost` /
 *    `apiPatch` so bearer injection, 401-refresh-retry, timeouts, and the
 *    structured `ApiResult` envelope stay in one place.
 * 3. **Nothing here logs a value.** `materialize` and `reveal` responses carry
 *    plaintext; this module never passes one to `log.*`, never stores one, and
 *    returns it straight to the caller that consumes it in local memory
 *    (`src/lib/tools/handlers/credential-login.ts` for the fill,
 *    `src/features/vault/` for an explicit human reveal). Both plaintext
 *    routes pass `silent: true` so a malformed 2xx body can never be quoted
 *    into the debug log by the client's parse-error path.
 * 4. **Nothing here persists.** No `chrome.storage`, `localStorage`,
 *    `sessionStorage`, or `indexedDB` — masked metadata included. Guarded by
 *    `tests/unit/vault-panel.test.ts`.
 *
 * The masked shapes below mirror aidream's `VaultItemOut` / `VaultFieldOut` /
 * `VaultCapabilities` (aidream/api/schemas/vault.py). The generated
 * `types/python-generated/api-types.ts` is gitignored in this repo and no
 * `src/**` module imports it, so route modules here declare the wire shape
 * they consume — same convention as every other file in this folder.
 */

import { type ApiResult, apiGet, apiPatch, apiPost } from '@/lib/api/client';
import { getAccessToken } from '@/lib/auth/flow';
import { log } from '@/lib/debug/log';

const BASE = '/api/vault/browser-login';
const ITEMS = '/api/vault/items';

/** One safe candidate from `/matches`. Never carries a credential value. */
export interface BrowserLoginMatch {
  item_id: string;
  display_name: string;
  definition_key: string;
  host: string;
  /** Safe names only. Present when the caller requests attempt planning data. */
  available_fields?: BrowserLoginAvailableField[];
  /** Explicitly non-secret values the agent may legitimately type. */
  non_secret_fields?: Array<{ key: string; label: string; value: string }>;
}

export interface BrowserLoginAvailableField {
  field_key: string;
  label: string;
  fillable: boolean;
  reason?: string;
}

export interface BrowserLoginMatchesResponse {
  matches: BrowserLoginMatch[];
  count: number;
}

/**
 * The transient payload from `/materialize` (served `Cache-Control: no-store`).
 * PLAINTEXT — the only object in this repo allowed to hold a vault secret.
 * It may live in one handler's local scope and nowhere else: not in
 * chrome.storage, Redux, IndexedDB, localStorage, tool args/results, logs,
 * traces, screenshots, clipboard, analytics, or model context.
 */
export interface BrowserLoginMaterialized {
  item_id: string;
  origin: string;
  username?: string;
  password?: string;
  /** Multi-field attempt payload. Plaintext; local handler scope only. */
  fields?: Record<string, string>;
}

/**
 * The one transient value-bearing response reserved for the trusted
 * credential_login executor. It is never logged, stored, surfaced to UI, or
 * posted as a tool result; the handler drops ``code`` immediately after fill.
 */
export interface BrowserAuthenticatorMaterialized {
  injection_id: string;
  origin: string;
  code: string;
  expires_at: string;
}

/** Terminal outcome reported back for auditing. Mirrors the tool's status enum. */
export type BrowserLoginResultStatus =
  | 'authenticated'
  | 'needs_mfa'
  | 'captcha_or_takeover'
  | 'credentials_rejected'
  | 'selection_required'
  | 'no_matching_login'
  | 'unsafe_destination'
  | 'unknown';

/**
 * Reasons a vault call could not even be attempted. Distinct from the tool's
 * status enum so the handler decides how to surface them.
 */
export type VaultCallFailure =
  | { kind: 'sign_in_required' }
  | { kind: 'forbidden' }
  | { kind: 'server_error'; status: number };

/** Uniform envelope for every vault call. Never throws; never partially succeeds. */
export type VaultResult<T> = { ok: true; data: T } | { ok: false; failure: VaultCallFailure };

/** Human-readable copy for a failure. Static strings — never server text. */
export function describeVaultFailure(failure: VaultCallFailure): string {
  if (failure.kind === 'sign_in_required') return 'Sign in to Matrx to use the Vault.';
  if (failure.kind === 'forbidden')
    return 'The Vault refused this request. You may not have access to this item.';
  return `The Vault is unavailable right now (${failure.status}).`;
}

/**
 * True only when a genuine signed-in user token exists. The guest-fingerprint
 * identity the rest of the extension treats as first-class is NOT acceptable
 * for any vault operation.
 */
export async function hasRealUserToken(): Promise<boolean> {
  return (await getAccessToken()) !== null;
}

function classifyFailure(status: number): VaultCallFailure {
  if (status === 401) return { kind: 'sign_in_required' };
  if (status === 403) return { kind: 'forbidden' };
  return { kind: 'server_error', status };
}

/**
 * Short-circuit for every route in this module: without a bearer token the
 * client would attach the guest fingerprint and the server would reject it
 * anyway — but opaquely. Returns the 401 envelope WITHOUT issuing a request.
 */
const SIGN_IN_REQUIRED: ApiResult<never> = {
  ok: false,
  status: 401,
  error: 'sign_in_required',
};

async function vaultGet<T>(path: string): Promise<ApiResult<T>> {
  if (!(await hasRealUserToken())) return SIGN_IN_REQUIRED;
  return apiGet<T>(path);
}

async function vaultPost<T>(
  path: string,
  body: unknown,
  opts?: { silent?: boolean },
): Promise<ApiResult<T>> {
  if (!(await hasRealUserToken())) return SIGN_IN_REQUIRED;
  return apiPost<T>(path, body, undefined, opts);
}

async function vaultPatch<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  if (!(await hasRealUserToken())) return SIGN_IN_REQUIRED;
  return apiPatch<T>(path, body);
}

/** Ask the server which permitted login items match the CURRENT tab URL. */
export async function fetchBrowserLoginMatches(
  pageUrl: string,
  options?: { includeFieldInventory?: boolean },
): Promise<VaultResult<BrowserLoginMatchesResponse>> {
  log.info('api', '→ POST vault/browser-login/matches');
  const r = await vaultPost<BrowserLoginMatchesResponse>(`${BASE}/matches`, {
    page_url: pageUrl,
    ...(options?.includeFieldInventory ? { include_field_inventory: true } : {}),
  });
  if (!r.ok) return { ok: false, failure: classifyFailure(r.status) };
  const data = r.data;
  if (!data || !Array.isArray(data.matches)) {
    return { ok: false, failure: { kind: 'server_error', status: 200 } };
  }
  log.info('api', `← vault matches count=${data.matches.length}`);
  return { ok: true, data };
}

/** Every saved login the actor may use, destination-independent — metadata only,
 * never a value. Backs `credential_login action='list'` (both executors). */
export async function fetchBrowserLoginInventory(): Promise<
  VaultResult<{ items: unknown[]; count: number }>
> {
  log.info('api', '→ GET vault/browser-login/inventory');
  const r = await vaultGet<{ items: unknown[]; count: number }>(`${BASE}/inventory`);
  if (!r.ok) return { ok: false, failure: classifyFailure(r.status) };
  const data = r.data;
  if (!data || !Array.isArray(data.items)) {
    return { ok: false, failure: { kind: 'server_error', status: 200 } };
  }
  log.info('api', `← vault inventory count=${data.items.length}`);
  return { ok: true, data };
}

/**
 * Authorize + decrypt one item for THIS origin. The response is plaintext —
 * the caller must keep it in local scope and drop the reference when done.
 */
export async function materializeBrowserLogin(
  itemId: string,
  params: {
    pageUrl: string;
    toolInvocationId: string;
    clientBuild: string;
    fieldKeys?: string[];
  },
): Promise<VaultResult<BrowserLoginMaterialized>> {
  log.info('api', '→ POST vault/browser-login/{item}/materialize');
  const r = await vaultPost<BrowserLoginMaterialized>(
    `${BASE}/${encodeURIComponent(itemId)}/materialize`,
    {
      page_url: params.pageUrl,
      tool_invocation_id: params.toolInvocationId,
      client_build: params.clientBuild,
      ...(params.fieldKeys ? { field_keys: params.fieldKeys } : {}),
    },
    // Plaintext body: a malformed 2xx must not be quoted into the debug log.
    { silent: true },
  );
  if (!r.ok) return { ok: false, failure: classifyFailure(r.status) };
  const data = r.data;
  const hasLegacyPassword = typeof data?.password === 'string';
  const hasFieldMap =
    !!data?.fields &&
    typeof data.fields === 'object' &&
    Object.values(data.fields).every((value) => typeof value === 'string');
  if (!data || typeof data.origin !== 'string' || (!hasLegacyPassword && !hasFieldMap)) {
    // Deliberately does NOT log the body — it may hold a partial credential.
    return { ok: false, failure: { kind: 'server_error', status: 200 } };
  }
  log.info('api', '← vault materialize ok');
  return { ok: true, data };
}

/** Claim one delegated authenticator call and receive its current code. */
export async function materializeBrowserAuthenticator(
  itemId: string,
  params: {
    conversationId: string;
    toolInvocationId: string;
    pageUrl: string;
    codeSelector: string;
    submit: { kind: 'click' | 'press_enter' | 'none'; selector?: string };
    extensionInstanceId: string;
    clientBuild: string;
  },
): Promise<VaultResult<BrowserAuthenticatorMaterialized>> {
  log.info('api', '→ POST vault/browser-login/{item}/authenticator-materialize');
  const r = await vaultPost<BrowserAuthenticatorMaterialized>(
    `${BASE}/${encodeURIComponent(itemId)}/authenticator-materialize`,
    {
      conversation_id: params.conversationId,
      tool_invocation_id: params.toolInvocationId,
      page_url: params.pageUrl,
      code_selector: params.codeSelector,
      submit: params.submit,
      extension_instance_id: params.extensionInstanceId,
      client_build: params.clientBuild,
    },
    // TOTP body: a malformed response must never be quoted into debug logs.
    { silent: true },
  );
  if (!r.ok) return { ok: false, failure: classifyFailure(r.status) };
  const data = r.data;
  if (
    !data ||
    typeof data.injection_id !== 'string' ||
    typeof data.origin !== 'string' ||
    typeof data.code !== 'string' ||
    !/^\d{6,8}$/.test(data.code) ||
    typeof data.expires_at !== 'string'
  ) {
    // Deliberately do not log the body: it may contain a valid code.
    return { ok: false, failure: { kind: 'server_error', status: 200 } };
  }
  log.info('api', '← vault authenticator materialize ok');
  return { ok: true, data };
}

/**
 * Report the terminal outcome for auditing (204). Best-effort: a failure here
 * must never change what the tool returns to the agent.
 */
export async function reportBrowserLoginResult(
  itemId: string,
  params: {
    status: BrowserLoginResultStatus;
    pageUrl?: string | undefined;
    toolInvocationId?: string | undefined;
  },
): Promise<void> {
  const body: Record<string, unknown> = { status: params.status };
  if (params.pageUrl !== undefined) body.page_url = params.pageUrl;
  if (params.toolInvocationId !== undefined) body.tool_invocation_id = params.toolInvocationId;
  const r = await vaultPost<void>(`${BASE}/${encodeURIComponent(itemId)}/result`, body);
  if (!r.ok) {
    log.warn('api', `vault browser-login result POST failed status=${r.status}`);
  }
}

export interface BrowserLoginReportInput {
  kind: 'secret_exposed' | 'wrong_verdict' | 'recipe_wrong' | 'other';
  where: string;
  attempt_id?: string;
  description?: string;
}

export interface BrowserLoginReportReceipt {
  id: string;
  status: string;
}

/** File a value-free login problem through the platform's ONE feedback path. */
export async function submitBrowserLoginReport(
  input: BrowserLoginReportInput,
): Promise<VaultResult<BrowserLoginReportReceipt>> {
  log.info('api', '→ POST vault/browser-login/report');
  const r = await vaultPost<BrowserLoginReportReceipt>(`${BASE}/report`, input, {
    // User-authored text: never let a malformed response quote request context.
    silent: true,
  });
  if (!r.ok) return { ok: false, failure: classifyFailure(r.status) };
  if (!r.data || typeof r.data.id !== 'string' || typeof r.data.status !== 'string') {
    return { ok: false, failure: { kind: 'server_error', status: 200 } };
  }
  return { ok: true, data: r.data };
}

// ── On-the-fly credential CAPTURE (D-11) ────────────────────────────────────
//
// The agent hit a login it has NO stored credential for. Instead of asking the
// human to log in (and seeing the password), the tool shows the USER a box; the
// user types; the value is written to the vault with the agent's metadata. The
// agent never sees it.
//
// 🚨 The user-typed VALUES ride on `field_values` here, sent DIRECTLY from the
// capture card's transient state to the server — they never pass through the
// service worker, a tool argument, a tool result, or model context. This route
// is `silent` because its request body carries plaintext.

/** One field the agent identified. NAMES + selectors only — no value. */
export interface CaptureFieldSpec {
  field_key: string;
  selector: string;
  label?: string;
  secret?: boolean;
  step?: number;
  clear_first?: boolean;
}

/** The known/unknown branch answer. Carries a recipe on `known`, never a value. */
export interface CaptureContext {
  branch: 'known' | 'unknown';
  normalized_origin: string;
  recipe: unknown | null;
  guidance: string;
}

/** The receipt after a capture write. Field KEYS only — never a value. */
export interface CaptureReceipt {
  status: string;
  credential_item_id?: string | null;
  branch?: 'known' | 'unknown' | null;
  field_keys: string[];
  proceed: boolean;
  recipe_id?: string | null;
  recipe_version?: number | null;
  login_attempt_id?: string | null;
  propose_recipe: boolean;
  guidance?: string | null;
  detail?: string | null;
}

/** The metadata + user-typed values for a capture write. */
export interface CaptureCredentialInput {
  display_name: string;
  login_url: string;
  description?: string;
  provider_key?: string;
  fields: CaptureFieldSpec[];
  submit_selector?: string;
  uri_match_mode?: 'host' | 'exact' | 'never';
  notes?: string;
  /** field_key → the value the USER typed. Server-request memory only. */
  field_values: Record<string, string>;
}

/**
 * The known/unknown branch — does a login recipe exist for the CURRENT tab?
 * Decrypts nothing; the origin is derived server-side from the real page URL.
 */
export async function fetchCaptureContext(pageUrl: string): Promise<VaultResult<CaptureContext>> {
  log.info('api', '→ POST vault/browser-login/capture-context');
  const r = await vaultPost<CaptureContext>(`${BASE}/capture-context`, { page_url: pageUrl });
  if (!r.ok) return { ok: false, failure: classifyFailure(r.status) };
  const data = r.data;
  if (!data || (data.branch !== 'known' && data.branch !== 'unknown')) {
    return { ok: false, failure: { kind: 'server_error', status: 200 } };
  }
  return { ok: true, data };
}

/**
 * Write a user-typed credential as a NEW vault item with the agent's metadata.
 * `input.field_values` is plaintext travelling OUT to the server exactly once,
 * from the capture card's local state; this module never retains it and never
 * logs the body. Returns a value-free receipt.
 */
export async function captureCredential(
  input: CaptureCredentialInput,
): Promise<VaultResult<CaptureReceipt>> {
  log.info('api', '→ POST vault/browser-login/capture');
  const body = {
    display_name: input.display_name,
    login_url: input.login_url,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.provider_key !== undefined ? { provider_key: input.provider_key } : {}),
    fields: input.fields.map((f) => ({
      field_key: f.field_key,
      selector: f.selector,
      ...(f.label !== undefined ? { label: f.label } : {}),
      secret: f.secret ?? true,
      step: f.step ?? 0,
      clear_first: f.clear_first ?? true,
    })),
    ...(input.submit_selector !== undefined ? { submit_selector: input.submit_selector } : {}),
    uri_match_mode: input.uri_match_mode ?? 'host',
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    field_values: input.field_values,
  };
  // Plaintext body: silent so a malformed 2xx cannot be quoted into the log.
  const r = await vaultPost<CaptureReceipt>(`${BASE}/capture`, body, { silent: true });
  if (!r.ok) return { ok: false, failure: classifyFailure(r.status) };
  const data = r.data;
  if (!data || typeof data.status !== 'string') {
    return { ok: false, failure: { kind: 'server_error', status: 200 } };
  }
  log.info('api', `← vault capture ${data.status}`);
  return { ok: true, data };
}

/** A documented UNKNOWN login → a PROPOSED recipe. Selectors + signals only. */
export interface LoginRecipeProposalInput {
  normalized_origin: string;
  match_pattern?: string;
  provider_key?: string;
  field_map: Array<{
    step?: number;
    selector: string;
    field_key?: string;
    literal_key?: string;
    clear_first?: boolean;
  }>;
  submit?: Record<string, unknown>;
  success_signals?: unknown[];
  failure_signals?: unknown[];
  challenge_signals?: unknown[];
  notes?: string;
}

export interface LoginRecipeProposalResult {
  status: string;
  recipe_id?: string | null;
  normalized_origin: string;
  provenance: string;
  recipe: unknown;
}

/** Propose a login recipe from the agent's documented experience of a site. */
export async function proposeLoginRecipe(
  input: LoginRecipeProposalInput,
): Promise<VaultResult<LoginRecipeProposalResult>> {
  log.info('api', '→ POST vault/browser-login/recipe-proposal');
  const r = await vaultPost<LoginRecipeProposalResult>(`${BASE}/recipe-proposal`, input);
  if (!r.ok) return { ok: false, failure: classifyFailure(r.status) };
  const data = r.data;
  if (!data || typeof data.status !== 'string') {
    return { ok: false, failure: { kind: 'server_error', status: 200 } };
  }
  return { ok: true, data };
}

// ── Item management (the Vault side panel) ──────────────────────────────────
//
// Everything below is MASKED. `VaultFieldSummary.value_hint` is a server-built
// hint ("••••1234"), never a value. The single plaintext route is
// `revealVaultField`, and its response is documented as transient.

/** What the actor may do with an item. Mirrors aidream `VaultCapabilities`. */
export interface VaultCapabilities {
  can_use: boolean;
  can_edit: boolean;
  can_reveal: boolean;
  can_manage: boolean;
}

/** Masked field. NEVER carries plaintext. Mirrors aidream `VaultFieldOut`. */
export interface VaultFieldSummary {
  id: string;
  credential_item_id: string;
  field_key: string;
  /** 'visible' | 'revealable' | 'sealed'. A sealed field can never be revealed. */
  handling: string;
  /** Server-built mask hint, e.g. "••••1234". Not a credential. */
  value_hint: string;
  is_active: boolean;
  description?: string | null;
}

/** Masked item + capabilities. Mirrors aidream `VaultItemOut`. */
export interface VaultItemSummary {
  id: string;
  display_name: string;
  definition_key: string;
  description?: string | null;
  status: string;
  /** PLAINTEXT destination metadata — never encrypted, RLS-protected. */
  login_urls: string[];
  /** 'host' | 'exact' | 'never'. */
  uri_match_mode: string;
  notes?: string | null;
  browser_fill_enabled: boolean;
  fields: VaultFieldSummary[];
  capabilities: VaultCapabilities;
  updated_at?: string;
}

interface VaultItemListResponse {
  items: VaultItemSummary[];
  count: number;
}

/** The destination-first login definition (ratified 2026-07-26). */
export const WEBSITE_LOGIN_DEFINITION_KEY = 'website_login';

/** Metadata the panel is allowed to PATCH. Values are NOT patchable from here. */
export interface VaultItemMetadataPatch {
  display_name?: string;
  login_urls?: string[];
  uri_match_mode?: 'host' | 'exact' | 'never';
  notes?: string;
  browser_fill_enabled?: boolean;
}

/** One field on a create request. `value` is plaintext travelling OUT, once. */
export interface VaultFieldInput {
  field_key: string;
  value: string;
  handling?: 'visible' | 'revealable' | 'sealed';
}

export interface VaultItemCreateInput {
  display_name: string;
  fields: VaultFieldInput[];
  definition_key?: string;
  login_urls?: string[];
  uri_match_mode?: 'host' | 'exact' | 'never';
  browser_fill_enabled?: boolean;
  notes?: string;
}

function normalizeCapabilities(raw: Partial<VaultCapabilities> | undefined): VaultCapabilities {
  return {
    can_use: raw?.can_use ?? false,
    can_edit: raw?.can_edit ?? false,
    can_reveal: raw?.can_reveal ?? false,
    can_manage: raw?.can_manage ?? false,
  };
}

function normalizeField(raw: Partial<VaultFieldSummary> & { id?: string }): VaultFieldSummary {
  return {
    id: raw.id ?? '',
    credential_item_id: raw.credential_item_id ?? '',
    field_key: raw.field_key ?? '',
    handling: raw.handling ?? 'revealable',
    value_hint: raw.value_hint ?? '',
    is_active: raw.is_active ?? true,
    description: raw.description ?? null,
  };
}

/**
 * Materialize server defaults so the panel consumes ONE shape. Anything that
 * isn't a recognised item (no `id`) is dropped rather than rendered half-built.
 */
function normalizeItem(raw: unknown): VaultItemSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<VaultItemSummary> & { id?: unknown };
  if (typeof r.id !== 'string' || !r.id) return null;
  return {
    id: r.id,
    display_name: typeof r.display_name === 'string' ? r.display_name : 'Untitled login',
    definition_key: typeof r.definition_key === 'string' ? r.definition_key : 'custom',
    description: r.description ?? null,
    status: typeof r.status === 'string' ? r.status : 'active',
    login_urls: Array.isArray(r.login_urls)
      ? r.login_urls.filter((u): u is string => typeof u === 'string')
      : [],
    uri_match_mode: typeof r.uri_match_mode === 'string' ? r.uri_match_mode : 'host',
    notes: r.notes ?? null,
    browser_fill_enabled: r.browser_fill_enabled === true,
    fields: Array.isArray(r.fields) ? r.fields.map(normalizeField) : [],
    capabilities: normalizeCapabilities(r.capabilities),
    ...(typeof r.updated_at === 'string' ? { updated_at: r.updated_at } : {}),
  };
}

function normalizeList(data: unknown): VaultItemSummary[] | null {
  if (!data || typeof data !== 'object') return null;
  const items = (data as Partial<VaultItemListResponse>).items;
  if (!Array.isArray(items)) return null;
  return items.map(normalizeItem).filter((i): i is VaultItemSummary => i !== null);
}

/** The actor's OWN personal items. Explicit scope — never a bare list read. */
export async function fetchMyVaultItems(): Promise<VaultResult<VaultItemSummary[]>> {
  log.info('api', '→ GET vault/items');
  const r = await vaultGet<unknown>(`${ITEMS}?principal_type=user`);
  if (!r.ok) return { ok: false, failure: classifyFailure(r.status) };
  const items = normalizeList(r.data);
  if (!items) return { ok: false, failure: { kind: 'server_error', status: 200 } };
  return { ok: true, data: items };
}

/** Items OTHER people shared with the actor. A deliberately separate scope. */
export async function fetchVaultItemsSharedWithMe(): Promise<VaultResult<VaultItemSummary[]>> {
  log.info('api', '→ GET vault/shared-with-me');
  const r = await vaultGet<unknown>('/api/vault/shared-with-me');
  if (!r.ok) return { ok: false, failure: classifyFailure(r.status) };
  const items = normalizeList(r.data);
  if (!items) return { ok: false, failure: { kind: 'server_error', status: 200 } };
  return { ok: true, data: items };
}

/** One item, freshly masked. Used to refresh a row after a PATCH. */
export async function fetchVaultItem(itemId: string): Promise<VaultResult<VaultItemSummary>> {
  const r = await vaultGet<unknown>(`${ITEMS}/${encodeURIComponent(itemId)}`);
  if (!r.ok) return { ok: false, failure: classifyFailure(r.status) };
  const item = normalizeItem(r.data);
  if (!item) return { ok: false, failure: { kind: 'server_error', status: 200 } };
  return { ok: true, data: item };
}

/**
 * Patch destination metadata (login URLs, match mode, browser-fill flag,
 * notes, name). Omitted keys are left alone by the server — this never blanks
 * a field it did not mention.
 */
export async function updateVaultItemMetadata(
  itemId: string,
  patch: VaultItemMetadataPatch,
): Promise<VaultResult<VaultItemSummary>> {
  log.info('api', '→ PATCH vault/items/{item}');
  const r = await vaultPatch<unknown>(`${ITEMS}/${encodeURIComponent(itemId)}`, patch);
  if (!r.ok) return { ok: false, failure: classifyFailure(r.status) };
  const item = normalizeItem(r.data);
  if (!item) return { ok: false, failure: { kind: 'server_error', status: 200 } };
  return { ok: true, data: item };
}

/**
 * Create a personal login item. `input.fields[].value` is plaintext travelling
 * OUT to the server exactly once, from the caller's local state — this module
 * never retains it and never logs the body.
 */
export async function createVaultItem(
  input: VaultItemCreateInput,
): Promise<VaultResult<VaultItemSummary>> {
  log.info('api', '→ POST vault/items');
  const body = {
    principal: { type: 'user' },
    display_name: input.display_name,
    definition_key: input.definition_key ?? WEBSITE_LOGIN_DEFINITION_KEY,
    fields: input.fields.map((f) => ({
      field_key: f.field_key,
      value: f.value,
      handling: f.handling ?? 'revealable',
    })),
    ...(input.login_urls !== undefined ? { login_urls: input.login_urls } : {}),
    ...(input.uri_match_mode !== undefined ? { uri_match_mode: input.uri_match_mode } : {}),
    ...(input.browser_fill_enabled !== undefined
      ? { browser_fill_enabled: input.browser_fill_enabled }
      : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };
  // Plaintext body: silent so a malformed 2xx cannot be quoted into the log.
  const r = await vaultPost<unknown>(ITEMS, body, { silent: true });
  if (!r.ok) return { ok: false, failure: classifyFailure(r.status) };
  const item = normalizeItem(r.data);
  if (!item) return { ok: false, failure: { kind: 'server_error', status: 200 } };
  return { ok: true, data: item };
}

/**
 * Explicit, audited reveal of ONE `revealable` field.
 *
 * The returned string is PLAINTEXT. It may live in component-local state
 * behind an auto-clear (`src/lib/credentials/transient-secret.ts`) and NOWHERE
 * else: not chrome.storage, not localStorage/sessionStorage/IndexedDB, not a
 * zustand store, not a tool result, not model context, not a log line.
 */
export async function revealVaultField(
  itemId: string,
  fieldKey: string,
): Promise<VaultResult<string>> {
  log.info('api', '→ POST vault/items/{item}/reveal');
  const r = await vaultPost<{ value?: unknown }>(
    `${ITEMS}/${encodeURIComponent(itemId)}/reveal`,
    { field_key: fieldKey },
    // Plaintext body: a malformed 2xx must not be quoted into the debug log.
    { silent: true },
  );
  if (!r.ok) return { ok: false, failure: classifyFailure(r.status) };
  const value = r.data?.value;
  if (typeof value !== 'string') {
    // Deliberately does NOT log the body — it may hold a partial credential.
    return { ok: false, failure: { kind: 'server_error', status: 200 } };
  }
  log.info('api', '← vault reveal ok');
  return { ok: true, data: value };
}
