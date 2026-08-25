import { apiGet, withSchema } from '@/lib/api/client';
import { z } from 'zod';

const WhoamiSchema = z.object({
  organization_id: z.string().uuid().nullable(),
});

/**
 * Assert the organization already carried by the authenticated request. This
 * helper never chooses, creates, or substitutes an organization.
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
