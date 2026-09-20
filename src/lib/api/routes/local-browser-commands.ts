import {
  type PrivateApiResult,
  type PrivateExpectedActor,
  parseStrictPrivateJson,
  privatePost,
} from '@/lib/api/client';
import { z } from 'zod';

const MAX_GRANT_BYTES = 8 * 1024;
const MAX_COMMAND_BYTES = 16 * 1024;
const MAX_INJECTION_VALUE_BYTES = 16 * 1024;
const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value).byteLength;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const safeMilliseconds = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const grant = z
  .string()
  .min(1)
  .refine((value) => bytes(value) <= MAX_GRANT_BYTES);
const operation = z.enum(['navigate', 'inspect_login', 'vault_login', 'authenticator']);
const refusal = z
  .object({
    status: z.literal('refused'),
    reason: z.enum(['forbidden', 'expired', 'invalid_request', 'unavailable']),
  })
  .strict();

export type PrivateCommandRequest = {
  expectedActor: PrivateExpectedActor;
  deadlineMs: number;
  isCurrent: () => boolean;
  signal: AbortSignal;
};

function preflight<T>(request: PrivateCommandRequest): Promise<PrivateApiResult<T>> | null {
  if (!Number.isSafeInteger(request.deadlineMs) || request.deadlineMs <= Date.now())
    return Promise.resolve({ ok: false, error: 'deadline_exceeded' });
  if (request.signal.aborted || !request.isCurrent())
    return Promise.resolve({ ok: false, error: 'identity_changed' });
  return null;
}

function privateRequest<T>(
  request: PrivateCommandRequest,
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<PrivateApiResult<T>> {
  return privatePost({
    path,
    body,
    expectedActor: request.expectedActor,
    deadlineMs: request.deadlineMs,
    isCurrent: request.isCurrent,
    signal: request.signal,
    schema,
  });
}

const transportOperation = z.enum([
  'discover',
  'admit',
  'approve',
  'claim',
  'complete',
  'renew',
  'cleanup',
]);
const transportRequest = z
  .object({
    grant,
    operation: transportOperation,
    app_instance_id: uuid,
    command_json: z
      .string()
      .min(1)
      .refine((value) => bytes(value) <= MAX_COMMAND_BYTES)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const needsCommand = value.operation === 'approve' || value.operation === 'claim';
    if (needsCommand !== 'command_json' in value)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid transport operation' });
  });
const transportAcceptedBase = z
  .object({
    status: z.literal('accepted'),
    operation: transportOperation,
    run_id: uuid,
    app_instance_id: uuid,
    controller_revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    jti: uuid,
    expires_at_ms: safeMilliseconds,
  })
  .strict();
const transportAccepted = (request: z.infer<typeof transportRequest>) =>
  request.operation === 'discover'
    ? transportAcceptedBase.extend({
        operation: z.literal(request.operation),
        app_instance_id: z.literal(request.app_instance_id),
      })
    : request.operation === 'approve'
      ? transportAcceptedBase.extend({
          operation: z.literal('approve'),
          app_instance_id: z.literal(request.app_instance_id),
          extension_generation: uuid,
          connection_id: uuid,
          actor_id: uuid,
          organization_id: uuid,
          profile_id: uuid,
          admission_id: uuid,
          command_id: uuid,
          sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
          command_digest: z.string().regex(/^[a-f0-9]{64}$/),
          approval_id: uuid,
          deadline_ms: safeMilliseconds,
        })
      : transportAcceptedBase.extend({
          operation: z.literal(request.operation),
          app_instance_id: z.literal(request.app_instance_id),
          extension_generation: uuid,
          connection_id: uuid,
        });
export type LocalCommandTransportResponse =
  | z.infer<typeof transportAcceptedBase>
  | z.infer<typeof refusal>;

/** Re-validates the daemon's private lifecycle authority before command approval UI is shown. */
export function verifyLocalCommandTransport(
  request: PrivateCommandRequest & z.infer<typeof transportRequest>,
): Promise<PrivateApiResult<LocalCommandTransportResponse>> {
  const blocked = preflight<LocalCommandTransportResponse>(request);
  if (blocked) return blocked;
  const body = {
    grant: request.grant,
    operation: request.operation,
    app_instance_id: request.app_instance_id,
    ...(request.command_json === undefined ? {} : { command_json: request.command_json }),
  };
  const parsed = transportRequest.safeParse(body);
  if (!parsed.success) return Promise.resolve({ ok: false, error: 'invalid_response' });
  return privateRequest(
    request,
    '/browser-manager/local/transport/verify',
    body,
    z.union([transportAccepted(parsed.data), refusal]),
  );
}

const approvalRequest = z
  .object({ grant, approval_id: uuid, decision: z.enum(['allow', 'deny', 'cancel']) })
  .strict();
const allowedApproval = z
  .object({
    status: z.literal('allowed'),
    approval_id: uuid,
    command_id: uuid,
    claim_grant: grant,
    deadline_ms: safeMilliseconds,
  })
  .strict();
const terminalApproval = z
  .object({
    status: z.enum(['refused', 'cancelled', 'already_claimed']),
    approval_id: uuid,
    command_id: uuid,
  })
  .strict();
export type LocalApprovalResponse =
  | z.infer<typeof allowedApproval>
  | z.infer<typeof terminalApproval>
  | z.infer<typeof refusal>;

export function approveLocalCommand(
  request: PrivateCommandRequest & z.infer<typeof approvalRequest>,
): Promise<PrivateApiResult<LocalApprovalResponse>> {
  const blocked = preflight<LocalApprovalResponse>(request);
  if (blocked) return blocked;
  const body = {
    grant: request.grant,
    approval_id: request.approval_id,
    decision: request.decision,
  };
  if (!approvalRequest.safeParse(body).success)
    return Promise.resolve({ ok: false, error: 'invalid_response' });
  return privateRequest(
    request,
    '/browser-manager/local/approval',
    body,
    z.union([
      allowedApproval.extend({ approval_id: z.literal(request.approval_id) }),
      terminalApproval.extend({ approval_id: z.literal(request.approval_id) }),
      refusal,
    ]),
  );
}

const document = z.object({ url: z.string().url(), document_id: uuid }).strict();
const claimRequest = z
  .object({
    grant,
    command_json: z
      .string()
      .min(1)
      .refine((value) => bytes(value) <= MAX_COMMAND_BYTES),
    document,
  })
  .strict();
const canonicalOrigin = z
  .string()
  .url()
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && parsed.origin === value;
    } catch {
      return false;
    }
  });
const injectionValue = z.string().refine((value) => bytes(value) <= MAX_INJECTION_VALUE_BYTES);
const passwordInjection = z
  .object({
    origin: canonicalOrigin,
    fields: z.record(injectionValue),
    expires_at_ms: safeMilliseconds,
  })
  .strict();
const authenticatorInjection = z
  .object({
    origin: canonicalOrigin,
    code: injectionValue,
    expires_at: z.string().datetime({ offset: true }),
    expires_at_ms: safeMilliseconds,
  })
  .strict();
const claimedBase = z
  .object({
    status: z.literal('claimed'),
    command_id: uuid,
    deadline_ms: safeMilliseconds,
    completion_grant: grant,
  })
  .strict();
const alreadyClaimed = z
  .object({ status: z.literal('already_claimed'), command_id: uuid })
  .strict();

const commandField = z
  .object({
    selector: z.string().min(1).max(2048),
    field_key: z.enum(['username', 'password']),
    clear_first: z.boolean(),
  })
  .strict();
const commandShape = z
  .union([
    z.object({ operation: z.literal('navigate'), url: z.string().url() }).strict(),
    z.object({ operation: z.literal('inspect_login') }).strict(),
    z
      .object({
        operation: z.literal('vault_login'),
        credential_item_id: uuid,
        fields: z.array(commandField).min(1).max(12),
        submit: z.unknown().optional(),
        steps: z.array(z.unknown()).min(1).max(4).optional(),
        expect: z.unknown().optional(),
      })
      .strict()
      .superRefine((value, ctx) => {
        if ((value.submit === undefined) === (value.steps === undefined))
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid command' });
      }),
    z
      .object({
        operation: z.literal('authenticator'),
        credential_item_id: uuid,
        code_selector: z.string().min(1).max(2048),
        submit: z.unknown(),
        expect: z.unknown().optional(),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (
      value.operation === 'vault_login' &&
      (value.submit === undefined) === (value.steps === undefined)
    )
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid command' });
  });
type CommandShape = z.infer<typeof commandShape>;

function parseCommand(source: string): CommandShape | null {
  try {
    const value = parseStrictPrivateJson(source);
    const parsed = value === null ? null : commandShape.safeParse(value);
    return parsed?.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function claimResponseSchema(command: CommandShape): z.ZodType<LocalClaimResponse> {
  if (command.operation === 'vault_login') {
    const expectedKeys = new Set<string>(command.fields.map((field) => field.field_key));
    const injection = passwordInjection.superRefine((value, context) => {
      const keys = Object.keys(value.fields);
      if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key)))
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid injection' });
    });
    return z.union([claimedBase.extend({ injection }), alreadyClaimed, refusal]);
  }
  if (command.operation === 'authenticator')
    return z.union([
      claimedBase.extend({ injection: authenticatorInjection }),
      alreadyClaimed,
      refusal,
    ]);
  return z.union([claimedBase, alreadyClaimed, refusal]);
}

export type LocalClaimResponse =
  | (z.infer<typeof claimedBase> & {
      injection?: z.infer<typeof passwordInjection> | z.infer<typeof authenticatorInjection>;
    })
  | z.infer<typeof alreadyClaimed>
  | z.infer<typeof refusal>;

export function claimLocalCommand(
  request: PrivateCommandRequest & z.infer<typeof claimRequest>,
): Promise<PrivateApiResult<LocalClaimResponse>> {
  const blocked = preflight<LocalClaimResponse>(request);
  if (blocked) return blocked;
  const body = {
    grant: request.grant,
    command_json: request.command_json,
    document: request.document,
  };
  const command = claimRequest.safeParse(body).success ? parseCommand(request.command_json) : null;
  if (!command) return Promise.resolve({ ok: false, error: 'invalid_response' });
  return privateRequest(
    request,
    '/browser-manager/local/commands/claim',
    body,
    claimResponseSchema(command),
  );
}

const reason = z.enum([
  'none',
  'unsafe_destination',
  'no_matching_login',
  'field_unavailable',
  'form_changed',
  'needs_mfa',
  'captcha_or_takeover',
  'credentials_rejected',
  'deadline_exceeded',
  'binding_changed',
  'tab_lost',
  'configuration_error',
]);
const terminalResult = z
  .object({
    command_id: uuid,
    operation,
    outcome: z.enum(['refused', 'cancelled', 'outcome_unknown']),
    reason,
  })
  .strict();
const completedResults = z.discriminatedUnion('operation', [
  z
    .object({
      command_id: uuid,
      operation: z.literal('navigate'),
      outcome: z.literal('completed'),
      reason: z.literal('none'),
      data: z.object({ origin: canonicalOrigin }).strict(),
    })
    .strict(),
  z
    .object({
      command_id: uuid,
      operation: z.literal('inspect_login'),
      outcome: z.literal('completed'),
      reason: z.literal('none'),
      data: z
        .object({
          origin: canonicalOrigin,
          form: z.enum(['login', 'username_first', 'password_change', 'none', 'ambiguous']),
          challenge: z.enum(['none', 'mfa', 'captcha', 'unknown']),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      command_id: uuid,
      operation: z.literal('vault_login'),
      outcome: z.literal('completed'),
      reason: z.literal('none'),
      data: z
        .object({
          filled: z.boolean(),
          submitted: z.boolean(),
          verification: z.enum([
            'unverified',
            'verified',
            'needs_mfa',
            'credentials_rejected',
            'captcha_or_takeover',
          ]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      command_id: uuid,
      operation: z.literal('authenticator'),
      outcome: z.literal('completed'),
      reason: z.literal('none'),
      data: z
        .object({ filled: z.boolean(), submitted: z.boolean(), challenge_detected: z.boolean() })
        .strict(),
    })
    .strict(),
]);
const commandResult = z.union([terminalResult, completedResults]);
export type LocalCommandResult = z.infer<typeof commandResult>;
const completeRequest = z.object({ grant, result: commandResult }).strict();

export function completeLocalCommand(
  request: PrivateCommandRequest & z.infer<typeof completeRequest>,
): Promise<
  PrivateApiResult<{ status: 'completed'; result: LocalCommandResult } | z.infer<typeof refusal>>
> {
  const blocked = preflight<
    { status: 'completed'; result: LocalCommandResult } | z.infer<typeof refusal>
  >(request);
  if (blocked) return blocked;
  const body = { grant: request.grant, result: request.result };
  if (!completeRequest.safeParse(body).success)
    return Promise.resolve({ ok: false, error: 'invalid_response' });
  const response = z
    .object({ status: z.literal('completed'), result: commandResult })
    .strict()
    .superRefine((value, context) => {
      if (JSON.stringify(value.result) !== JSON.stringify(body.result))
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'receipt mismatch' });
    });
  return privateRequest(
    request,
    '/browser-manager/local/commands/complete',
    body,
    z.union([response, refusal]),
  );
}
