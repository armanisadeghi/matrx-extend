import { recordKnobRead } from '@/lib/config';
import { platformDb } from '@/lib/supabase/schemas';

/** The ONE direct `platform.knob_resolve` door: same call, plus the counted read. */
export async function resolveKnob(args: {
  feature: string;
  key: string;
  organizationId: string;
  userId: string;
}) {
  const result = await platformDb().rpc('knob_resolve', {
    p_feature: args.feature,
    p_key: args.key,
    p_organization_id: args.organizationId,
    p_user_id: args.userId,
  });
  if (!result.error) recordKnobRead(`${args.feature}.${args.key}`, 'db');
  return result;
}
