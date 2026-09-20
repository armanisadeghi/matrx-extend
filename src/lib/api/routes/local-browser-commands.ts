import { type PrivateApiResult, type PrivateExpectedActor, privatePost } from '@/lib/api/client';
import { z } from 'zod';

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const grant = z.string().min(1).refine((value) => bytes(value) <= 8 * 1024);
const deadline = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const refusal = z.object({ status: z.literal('refused'), reason: z.enum(['forbidden', 'expired', 'invalid_request', 'unavailable']) }).strict();
const operation = z.enum(['navigate', 'inspect_login', 'vault_login', 'authenticator']);
const origin = z.string().url().refine((value) => { const u = new URL(value); return u.origin === value && u.protocol === 'https:'; });
const secret = z.string().refine((value) => bytes(value) <= 16 * 1024);
const passwordInjection = z.object({ origin, fields: z.record(secret), expires_at_ms: deadline }).strict().superRefine((value, ctx) => {
  if (Object.keys(value.fields).length === 0 || bytes(JSON.stringify(value.fields)) > 48 * 1024) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid injection' });
});
const totpInjection = z.object({ origin, code: secret, expires_at: z.string().datetime(), expires_at_ms: deadline }).strict();
const commandResult = z.object({ command_id: uuid, operation, outcome: z.enum(['completed', 'refused', 'cancelled', 'outcome_unknown']), reason: z.enum(['none', 'unsafe_destination', 'no_matching_login', 'field_unavailable', 'form_changed', 'needs_mfa', 'captcha_or_takeover', 'credentials_rejected', 'deadline_exceeded', 'binding_changed', 'tab_lost', 'configuration_error']), data: z.unknown().optional() }).strict();
export type LocalCommandResult = z.infer<typeof commandResult>;

export type PrivateCommandRequest = { expectedActor: PrivateExpectedActor; deadlineMs: number; isCurrent: () => boolean; signal: AbortSignal };
function validBase(request: PrivateCommandRequest): boolean { return Number.isSafeInteger(request.deadlineMs) && request.deadlineMs > Date.now() && !request.signal.aborted && request.isCurrent(); }
function invalid<T>(): Promise<PrivateApiResult<T>> { return Promise.resolve({ ok: false, error: 'invalid_response' }); }

const approvalRequest = z.object({ grant, approval_id: uuid, decision: z.enum(['allow', 'deny', 'cancel']) }).strict();
const allowed = z.object({ status: z.literal('allowed'), approval_id: uuid, command_id: uuid, claim_grant: grant, deadline_ms: deadline }).strict();
const terminalApproval = z.object({ status: z.enum(['refused', 'cancelled', 'already_claimed']), approval_id: uuid, command_id: uuid }).strict();
export type LocalApprovalResponse = z.infer<typeof allowed | typeof terminalApproval | typeof refusal>;
export function approveLocalCommand(request: PrivateCommandRequest & z.infer<typeof approvalRequest>): Promise<PrivateApiResult<LocalApprovalResponse>> {
  const body = { grant: request.grant, approval_id: request.approval_id, decision: request.decision };
  if (!validBase(request) || !approvalRequest.safeParse(body).success) return invalid();
  const schema = z.union([z.object({ ...allowed.shape, approval_id: z.literal(request.approval_id) }).strict(), z.object({ ...terminalApproval.shape, approval_id: z.literal(request.approval_id) }).strict(), refusal]);
  return privatePost({ path: '/browser-manager/local/approval', body, expectedActor: request.expectedActor, deadlineMs: request.deadlineMs, isCurrent: request.isCurrent, signal: request.signal, schema });
}

const claimRequest = z.object({ grant, command_json: z.string().min(1).refine((value) => bytes(value) <= 16 * 1024), document: z.object({ url: z.string().url(), document_id: uuid }).strict() }).strict();
const claimed = z.object({ status: z.literal('claimed'), command_id: uuid, deadline_ms: deadline, completion_grant: grant, injection: z.union([passwordInjection, totpInjection]).optional() }).strict();
const alreadyClaimed = z.object({ status: z.literal('already_claimed'), command_id: uuid }).strict();
export type LocalClaimResponse = z.infer<typeof claimed | typeof alreadyClaimed | typeof refusal>;
export function claimLocalCommand(request: PrivateCommandRequest & z.infer<typeof claimRequest>): Promise<PrivateApiResult<LocalClaimResponse>> {
  const body = { grant: request.grant, command_json: request.command_json, document: request.document };
  if (!validBase(request) || !claimRequest.safeParse(body).success || !strictCommand(request.command_json)) return invalid();
  return privatePost({ path: '/browser-manager/local/commands/claim', body, expectedActor: request.expectedActor, deadlineMs: request.deadlineMs, isCurrent: request.isCurrent, signal: request.signal, schema: z.union([claimed, alreadyClaimed, refusal]) });
}

const completeRequest = z.object({ grant, result: commandResult }).strict();
export function completeLocalCommand(request: PrivateCommandRequest & z.infer<typeof completeRequest>): Promise<PrivateApiResult<{ status: 'completed'; result: LocalCommandResult } | z.infer<typeof refusal>>> {
  const body = { grant: request.grant, result: request.result };
  if (!validBase(request) || !completeRequest.safeParse(body).success) return invalid();
  const response = z.object({ status: z.literal('completed'), result: commandResult }).strict().superRefine((value, ctx) => { if (JSON.stringify(value.result) !== JSON.stringify(body.result)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'receipt mismatch' }); });
  return privatePost({ path: '/browser-manager/local/commands/complete', body, expectedActor: request.expectedActor, deadlineMs: request.deadlineMs, isCurrent: request.isCurrent, signal: request.signal, schema: z.union([response, refusal]) });
}

function strictCommand(source: string): boolean {
  try {
    const value: unknown = JSON.parse(source);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const op = (value as { operation?: unknown }).operation;
    return operation.safeParse(op).success;
  } catch { return false; }
}
