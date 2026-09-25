import { getAccessToken } from '@/lib/auth/flow';
import { getActiveOrganizationId } from '@/lib/org/active-org';

export interface ParallelDispatchActor {
  authHeader: string | null;
  organizationId: string;
}

/** Refuse a child dispatch if its captured bearer or organization has changed. */
export async function parallelActorStillCurrent(actor: ParallelDispatchActor): Promise<boolean> {
  const expectedToken = actor.authHeader?.replace(/^Bearer /, '') ?? null;
  const [token, organizationId] = await Promise.all([getAccessToken(), getActiveOrganizationId()]);
  return token === expectedToken && organizationId === actor.organizationId;
}
