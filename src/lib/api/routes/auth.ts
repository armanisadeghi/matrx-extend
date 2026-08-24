import { apiGet, withSchema } from '@/lib/api/client';
import { z } from 'zod';

const WhoamiSchema = z.object({
  organization_id: z.string().uuid().nullable(),
});

/**
 * Resolve the organization that must be named on every new AI conversation.
 *
 * The server owns this choice. That matters most for fingerprint guests: they
 * have a real server-side user and personal organization, but no Supabase JWT
 * or client-visible membership row from which the extension could derive it.
 */
export async function requireRequestOrganizationId(): Promise<string> {
  const result = withSchema(await apiGet<unknown>('/auth/whoami'), WhoamiSchema);
  if (!result.ok) {
    throw new Error(`Workspace initialization failed (${result.status}): ${result.error}`);
  }
  if (!result.data.organization_id) {
    throw new Error('Workspace initialization failed: the request carried no organization.');
  }
  return result.data.organization_id;
}
