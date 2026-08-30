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
 * Throws `OrganizationNotSelectedError` (with a user-facing remedy) when the
 * user must pick. Callers keep their existing failure handling: this function
 * has always thrown rather than returned a fallback.
 */
export async function requireRequestOrganizationId(): Promise<string> {
  return requireActiveOrganizationId();
}
