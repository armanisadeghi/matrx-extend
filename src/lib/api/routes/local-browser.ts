import { type PrivateApiResult, type PrivateExpectedActor, privatePost } from '@/lib/api/client';
import { z } from 'zod';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const grant = z
  .string()
  .min(1)
  .refine((value) => new TextEncoder().encode(value).byteLength <= 8192);

const proofSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('discover'),
      extension_generation: uuid,
      connection_id: uuid,
    })
    .strict(),
  z.object({ operation: z.literal('admit'), admission_id: uuid }).strict(),
  z.object({ operation: z.literal('renew'), renewal_id: uuid, admission_id: uuid }).strict(),
  z.object({ operation: z.literal('cleanup'), stop_id: uuid, admission_id: uuid }).strict(),
]);
export type LocalVerifyProof = z.infer<typeof proofSchema>;

const refusalReason = z.enum([
  'expired',
  'binding_changed',
  'unavailable',
  'ambiguous',
  'forbidden',
  'metadata_corrupt',
]);
const refusalSchema = z.object({ status: z.literal('refused'), reason: refusalReason }).strict();
export type LocalVerifyResponse =
  | { status: 'accepted'; challenge_id: string }
  | { status: 'accepted'; admission_id: string; deadline_ms: number }
  | { status: 'accepted'; renewal_id: string; expires_at_ms: number }
  | { status: 'accepted'; stop_id: string }
  | { status: 'refused'; reason: z.infer<typeof refusalReason> };

export function verifyLocalBrowser(request: {
  grant: string;
  proof: LocalVerifyProof;
  expectedActor: PrivateExpectedActor;
  deadlineMs: number;
}): Promise<PrivateApiResult<LocalVerifyResponse>> {
  const validated = proofSchema.safeParse(request.proof);
  if (!validated.success || !grant.safeParse(request.grant).success)
    return Promise.resolve({ ok: false, error: 'invalid_response' });
  const responseSchema = (() => {
    switch (validated.data.operation) {
      case 'discover':
        return z.union([
          z.object({ status: z.literal('accepted'), challenge_id: uuid }).strict(),
          refusalSchema,
        ]);
      case 'admit':
        return z.union([
          z
            .object({
              status: z.literal('accepted'),
              admission_id: z.literal(validated.data.admission_id),
              deadline_ms: safeMilliseconds,
            })
            .strict(),
          refusalSchema,
        ]);
      case 'renew':
        return z.union([
          z
            .object({
              status: z.literal('accepted'),
              renewal_id: z.literal(validated.data.renewal_id),
              expires_at_ms: safeMilliseconds,
            })
            .strict(),
          refusalSchema,
        ]);
      case 'cleanup':
        return z.union([
          z
            .object({ status: z.literal('accepted'), stop_id: z.literal(validated.data.stop_id) })
            .strict(),
          refusalSchema,
        ]);
    }
  })();
  return privatePost({
    path: '/browser-manager/local/verify',
    body: { grant: request.grant, proof: request.proof },
    expectedActor: request.expectedActor,
    deadlineMs: request.deadlineMs,
    schema: responseSchema as z.ZodType<LocalVerifyResponse>,
  });
}

const safeMilliseconds = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const localBrowserAckRequestSchema = z
  .object({
    grant,
    operation: z.enum(['admit', 'cleanup']),
    receipt: z.union([
      z.object({ admission_id: uuid, status: z.enum(['created', 'cancelled', 'failed']) }).strict(),
      z
        .object({ stop_id: uuid, status: z.enum(['closed', 'already_absent', 'unconfirmed']) })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.operation === 'admit') !== 'admission_id' in input.receipt)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'operation must match receipt' });
  });

const cleanupReceipt = z
  .object({ stop_id: uuid, status: z.enum(['closed', 'already_absent', 'unconfirmed']) })
  .strict();
const ackResponseSchema = z.union([
  z
    .object({
      status: z.literal('accepted'),
      operation: z.literal('admit'),
      receipt: z.object({ admission_id: uuid, status: z.literal('created') }).strict(),
      lease_expires_at_ms: safeMilliseconds.nullable(),
    })
    .strict(),
  z
    .object({
      status: z.literal('accepted'),
      operation: z.literal('admit'),
      receipt: z.object({ admission_id: uuid, status: z.enum(['cancelled', 'failed']) }).strict(),
      lease_expires_at_ms: z.null(),
    })
    .strict(),
  z
    .object({
      status: z.literal('cancelled'),
      operation: z.literal('admit'),
      receipt: z.object({ admission_id: uuid, status: z.literal('cancelled') }).strict(),
      lease_expires_at_ms: z.null(),
    })
    .strict(),
  z
    .object({
      status: z.literal('accepted'),
      operation: z.literal('cleanup'),
      receipt: cleanupReceipt,
    })
    .strict(),
  refusalSchema,
]);
export type LocalBrowserAckResponse = z.infer<typeof ackResponseSchema>;

export function acknowledgeLocalBrowser(request: {
  grant: string;
  operation: 'admit' | 'cleanup';
  receipt: z.infer<typeof localBrowserAckRequestSchema>['receipt'];
  expectedActor: PrivateExpectedActor;
  deadlineMs: number;
}): Promise<PrivateApiResult<LocalBrowserAckResponse>> {
  const body = { grant: request.grant, operation: request.operation, receipt: request.receipt };
  if (
    !grant.safeParse(request.grant).success ||
    !localBrowserAckRequestSchema.safeParse(body).success
  )
    return Promise.resolve({ ok: false, error: 'invalid_response' });
  const schema = (() => {
    if (request.operation === 'admit') {
      if (!('admission_id' in request.receipt)) return null;
      const receipt = z
        .object({
          admission_id: z.literal(request.receipt.admission_id),
          status: z.literal(request.receipt.status),
        })
        .strict();
      return z.union([
        z
          .object({
            status: z.literal('accepted'),
            operation: z.literal('admit'),
            receipt,
            lease_expires_at_ms:
              request.receipt.status === 'created' ? safeMilliseconds.nullable() : z.null(),
          })
          .strict(),
        z
          .object({
            status: z.literal('cancelled'),
            operation: z.literal('admit'),
            receipt: z
              .object({
                admission_id: z.literal(request.receipt.admission_id),
                status: z.literal('cancelled'),
              })
              .strict(),
            lease_expires_at_ms: z.null(),
          })
          .strict(),
        refusalSchema,
      ]);
    }
    if (!('stop_id' in request.receipt)) return null;
    return z.union([
      z
        .object({
          status: z.literal('accepted'),
          operation: z.literal('cleanup'),
          receipt: z
            .object({
              stop_id: z.literal(request.receipt.stop_id),
              status: z.literal(request.receipt.status),
            })
            .strict(),
        })
        .strict(),
      refusalSchema,
    ]);
  })();
  if (!schema) return Promise.resolve({ ok: false, error: 'invalid_response' });
  return privatePost({
    path: '/browser-manager/local/ack',
    body,
    expectedActor: request.expectedActor,
    deadlineMs: request.deadlineMs,
    schema: schema as z.ZodType<LocalBrowserAckResponse>,
  });
}
