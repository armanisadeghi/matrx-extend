import { parseStrictPrivateJson } from '@/lib/api/client';
import { z } from 'zod';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const nonZeroSafeInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const grant = z
  .string()
  .min(1)
  .refine((value) => new TextEncoder().encode(value).byteLength <= 8 * 1024);

const registerRequired = z.union([
  z
    .object({
      type: z.literal('local_browser.register_required'),
      version: z.literal(1),
      engine_boot_id: uuid,
      revision: safeInteger,
    })
    .strict(),
  z
    .object({
      type: z.literal('local_browser.register_required'),
      version: z.literal(1),
      status: z.literal('refused'),
      reason: z.literal('context_unavailable'),
    })
    .strict(),
]);

const registrationRefused = z
  .object({
    type: z.literal('local_browser.registration'),
    version: z.literal(1),
    status: z.literal('refused'),
    engine_boot_id: uuid,
    expected_revision: safeInteger,
    extension_generation: uuid,
    connection_id: uuid,
    reason: z.literal('registration_unavailable'),
  })
  .strict();
const registrationAcknowledged = z
  .object({
    type: z.literal('local_browser.registration'),
    version: z.literal(1),
    status: z.literal('acknowledged'),
    engine_boot_id: uuid,
    expected_revision: safeInteger,
    extension_generation: uuid,
    connection_id: uuid,
  })
  .strict();

const execute = z
  .object({
    type: z.literal('local_browser.execute'),
    version: z.literal(1),
    call_id: uuid,
    operation: z.enum(['discover', 'admit', 'renew', 'cleanup']),
    grant,
  })
  .strict();

const invalidate = z
  .object({
    type: z.literal('local_browser.invalidate'),
    version: z.literal(1),
    reason: z.literal('binding_changed'),
  })
  .strict();

export const localBrowserRefusalReason = z.enum([
  'context_unavailable',
  'registration_unavailable',
  'authority_refused',
  'rate_limited',
  'transport_unavailable',
  'binding_changed',
  'invalid_request',
  'retry_conflict',
]);

const result = z.union([
  z
    .object({
      type: z.literal('local_browser.result'),
      version: z.literal(1),
      call_id: uuid,
      operation: z.literal('discover'),
      status: z.literal('acknowledged'),
      receipt: z.literal('accepted'),
    })
    .strict(),
  z
    .object({
      type: z.literal('local_browser.result'),
      version: z.literal(1),
      call_id: uuid,
      operation: z.literal('admit'),
      status: z.literal('acknowledged'),
      receipt: z.enum(['created', 'cancelled', 'failed']),
    })
    .strict(),
  z
    .object({
      type: z.literal('local_browser.result'),
      version: z.literal(1),
      call_id: uuid,
      operation: z.literal('renew'),
      status: z.literal('acknowledged'),
      receipt: z.literal('accepted'),
    })
    .strict(),
  z
    .object({
      type: z.literal('local_browser.result'),
      version: z.literal(1),
      call_id: uuid,
      operation: z.literal('cleanup'),
      status: z.literal('acknowledged'),
      receipt: z.enum(['closed', 'already_absent', 'unconfirmed']),
    })
    .strict(),
  z
    .object({
      type: z.literal('local_browser.result'),
      version: z.literal(1),
      call_id: uuid,
      operation: z.enum(['discover', 'admit', 'renew', 'cleanup']),
      status: z.literal('refused'),
      reason: localBrowserRefusalReason,
    })
    .strict(),
]);

export type LocalBrowserRegisterRequired = z.infer<typeof registerRequired>;
export type LocalBrowserRegistration =
  | z.infer<typeof registrationAcknowledged>
  | z.infer<typeof registrationRefused>;
export type LocalBrowserExecute = z.infer<typeof execute>;
export type LocalBrowserInvalidate = z.infer<typeof invalidate>;
export type LocalBrowserResult = z.infer<typeof result>;
export type LocalBrowserRefusalReason = z.infer<typeof localBrowserRefusalReason>;

export function parseLocalBrowserFrame(
  value: unknown,
):
  | LocalBrowserRegisterRequired
  | LocalBrowserRegistration
  | LocalBrowserExecute
  | LocalBrowserInvalidate
  | null {
  const required = registerRequired.safeParse(value);
  if (required.success) return required.data;
  const registration = z.union([registrationAcknowledged, registrationRefused]).safeParse(value);
  if (registration.success) return registration.data;
  const request = execute.safeParse(value);
  if (request.success) return request.data;
  const invalidation = invalidate.safeParse(value);
  return invalidation.success ? invalidation.data : null;
}

export function localBrowserResult(value: LocalBrowserResult): LocalBrowserResult {
  // Keep construction local and closed even when a future caller widens a type.
  return result.parse(value);
}

const commonGrantClaims = {
  v: z.literal(1),
  aud: z.literal('browser-local-executor'),
  sub: uuid,
  organization_id: uuid,
  app_instance_id: uuid,
  run_id: uuid,
  profile_id: uuid,
  jti: uuid,
  iat: safeInteger,
  exp: safeInteger,
  iss: z.string().min(1),
  tier_policy: z.literal('none'),
  scopes: z.array(z.never()).length(0),
};
const grantClaims = z.discriminatedUnion('operation', [
  z.object({ ...commonGrantClaims, operation: z.literal('discover'), challenge_id: uuid }).strict(),
  z
    .object({
      ...commonGrantClaims,
      operation: z.literal('admit'),
      challenge_id: uuid,
      admission_id: uuid,
      extension_generation: uuid,
      connection_id: uuid,
      controller_revision: safeInteger,
    })
    .strict(),
  z
    .object({
      ...commonGrantClaims,
      operation: z.literal('renew'),
      admission_id: uuid,
      renewal_id: uuid,
      extension_generation: uuid,
      connection_id: uuid,
      controller_revision: safeInteger,
      prior_lease_expiry_ms: nonZeroSafeInteger,
    })
    .strict(),
  z
    .object({
      ...commonGrantClaims,
      operation: z.literal('cleanup'),
      admission_id: uuid,
      stop_id: uuid,
      extension_generation: uuid,
      connection_id: uuid,
      controller_revision: safeInteger,
    })
    .strict(),
]);
export type LocalBrowserGrantClaims = z.infer<typeof grantClaims>;

function decodeBase64Url(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    return atob(
      value
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(value.length / 4) * 4, '='),
    );
  } catch {
    return null;
  }
}

/**
 * Routing-only grant projection. It never validates a signature or grants
 * authority; `verifyLocalBrowser` remains the sole authority check.
 */
export function parseLocalBrowserGrantClaims(grantValue: string): LocalBrowserGrantClaims | null {
  if (!grant.safeParse(grantValue).success) return null;
  const parts = grantValue.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  const decoded = decodeBase64Url(parts[1]);
  if (!decoded) return null;
  const parsed = parseStrictPrivateJson(decoded);
  const checked = parsed === null ? null : grantClaims.safeParse(parsed);
  return checked?.success ? checked.data : null;
}
