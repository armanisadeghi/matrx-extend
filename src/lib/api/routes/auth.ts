import { requireActiveOrganizationId } from '@/lib/org/active-org';

/**
 * The organization this request acts in — the value that goes on the wire as
 * `X-Organization-Id` and into every organization-scoped write.
 *
 * This used to ask the server (`GET /auth/whoami`) which organization the
 * request "carried". That was backwards, and it broke the moment the server
 * stopped guessing: the client is the side that knows which organization the
 * user chose, so the client states it and the server verifies membership.
 * Resolution — and the refusal to invent one — lives in
 * `src/lib/org/active-org.ts`.
 *
 * When this device has not been told which organization to act in, this does
 * NOT fail — it HOLDS: the picker is raised wherever it can be shown and this
 * resolves with what the person sets (Arman, 2026-09-19). It throws
 * `OrganizationNotSelectedError`, with a user-facing remedy, only when nobody
 * answers. Callers keep their existing failure handling; it has never
 * returned a fallback and never will.
 */
export async function requireRequestOrganizationId(): Promise<string> {
  return requireActiveOrganizationId();
}
