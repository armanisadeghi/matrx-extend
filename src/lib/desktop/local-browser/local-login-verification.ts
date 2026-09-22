import { z } from 'zod';

const encoder = new TextEncoder();
export const MAX_COMMAND_BYTES = 16 * 1024;
export const MAX_RECEIPT_BYTES = 4 * 1024;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const nullableFact = z.boolean().nullable();

export const evaluatedObservation = z
  .object({
    password_field_present_before: nullableFact,
    password_field_present_after: nullableFact,
    otp_field_present_before: nullableFact,
    otp_field_present_after: nullableFact,
    captcha_present_before: nullableFact,
    captcha_present_after: nullableFact,
    login_form_present_before: nullableFact,
    login_form_present_after: nullableFact,
    url_relation: z.enum(['unchanged', 'changed', 'unknown']),
    url_flow: z.enum(['challenge', 'sign_in', 'other', 'unknown']),
    success_url_prefix: nullableFact,
    success_selector: nullableFact,
    failure_selector: nullableFact,
    challenge_selector: nullableFact,
    recipe_matches: z.array(nullableFact).max(128),
  })
  .strict()
  .superRefine((value, context) => {
    if (encoder.encode(JSON.stringify(value)).byteLength > MAX_RECEIPT_BYTES)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'verification receipt exceeds 4KiB',
      });
  });
export type EvaluatedObservation = z.infer<typeof evaluatedObservation>;

const descriptor = z
  .object({
    kind: z.enum([
      'selector_present',
      'selector_absent',
      'url_prefix',
      'cookie_present',
      'text_present',
    ]),
    value: z.string().min(1).max(2048),
    label: z.string().max(256).nullable().optional(),
    direction: z.enum(['authenticated', 'challenged', 'rejected']),
    weight: z.number().min(0).max(1),
  })
  .strict();
const expect = z
  .object({
    success_url_prefix: z.string().min(1).nullable().optional(),
    success_selector: z.string().nullable().optional(),
    failure_selector: z.string().nullable().optional(),
    challenge_selector: z.string().nullable().optional(),
    timeout_ms: z.number().int().min(100).max(120000),
  })
  .strict();
export const frozenVerificationSpec = z
  .object({
    version: z.literal(1),
    expect,
    url_vocabulary: z
      .object({
        version: z.literal(1),
        challenge: z.array(z.string()),
        sign_in: z.array(z.string()),
      })
      .strict(),
    recipe_id: z.string().uuid().nullable(),
    recipe_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(),
    descriptors: z.array(descriptor).max(128),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.recipe_id === null) !== (value.recipe_version === null))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'incomplete recipe identity' });
    if (value.recipe_id === null && value.descriptors.length)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'explicit expect has descriptors' });
    const order = { challenged: 0, rejected: 1, authenticated: 2 } as const;
    if (
      value.descriptors.some((item, index) => {
        const previous = index > 0 ? value.descriptors[index - 1] : undefined;
        return previous !== undefined && order[item.direction] < order[previous.direction];
      })
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'descriptor order is not canonical',
      });
  });
export type FrozenVerificationSpec = z.infer<typeof frozenVerificationSpec>;

export const verificationFields = z
  .object({
    verification_spec_json: z
      .string()
      .min(1)
      .refine((value) => encoder.encode(value).byteLength <= MAX_COMMAND_BYTES),
    verification_digest: digest,
  })
  .strict();
export type VerificationFields = z.infer<typeof verificationFields>;

export function parseVerificationFields(
  value: unknown,
): (VerificationFields & { spec: FrozenVerificationSpec }) | null {
  const pair =
    value !== null && typeof value === 'object'
      ? {
          verification_spec_json: (value as Record<string, unknown>).verification_spec_json,
          verification_digest: (value as Record<string, unknown>).verification_digest,
        }
      : value;
  const fields = verificationFields.safeParse(pair);
  if (!fields.success) return null;
  try {
    const spec = frozenVerificationSpec.parse(JSON.parse(fields.data.verification_spec_json));
    return { ...fields.data, spec };
  } catch {
    return null;
  }
}

export async function verificationDigestMatches(fields: VerificationFields): Promise<boolean> {
  const payload = encoder.encode(
    `matrx.local-login-verification.v1\0${fields.verification_spec_json}`,
  );
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
  const actual = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return actual === fields.verification_digest;
}
