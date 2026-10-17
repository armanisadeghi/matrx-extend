import { ENV } from '@/config/env';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Top-level write context is already captured by the caller; nested fields are data. */
function explicitWriteOrganization(body: unknown): string | null {
  const rows = Array.isArray(body) ? body : [body];
  const organizations = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    for (const key of ['organization_id', 'p_organization_id']) {
      if (!(key in row)) continue;
      const value = row[key];
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Supabase write requires a nonempty ${key}.`);
      }
      organizations.add(value);
    }
  }
  if (organizations.size > 1) {
    throw new Error(
      'Supabase write contains conflicting organizations. Send each organization separately.',
    );
  }
  return organizations.values().next().value ?? null;
}

/** All actor clients share this final HTTP boundary, after supabase-js has attached auth. */
export const organizationFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const bearer = request.headers.get('Authorization');
  const authenticated =
    bearer?.startsWith('Bearer ') && bearer.slice(7) !== ENV.SUPABASE_PUBLISHABLE_KEY;
  if (!authenticated) return globalThis.fetch(request);

  let body: unknown = null;
  const writes = !['GET', 'HEAD'].includes(request.method);
  if (writes && request.headers.get('Content-Type')?.includes('application/json')) {
    // A DELETE (or bodiless PATCH) still carries the SDK's JSON Content-Type
    // but has NO body — parsing that throws "Unexpected end of input" and every
    // such write fails. Read the text first; an empty body is simply "no
    // organization declared in the payload".
    const text = await request.clone().text();
    body = text.trim() ? JSON.parse(text) : null;
  }
  const resolver = await import('@/lib/org/active-org');
  const organizationId =
    explicitWriteOrganization(body) ?? (await resolver.requireActiveOrganizationId());
  if (organizationId) request.headers.set('X-Organization-Id', organizationId);
  else request.headers.delete('X-Organization-Id');
  return globalThis.fetch(request);
};
