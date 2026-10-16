import { recordKnobRead } from '@/lib/config';
import { getSupabase } from '@/lib/supabase/client';
import { resolveConfigKnob } from '@ai-matrx/data/config-attestation-doors';

/** The app-facing `platform.knob_resolve` read, with attestation counting. */
export async function resolveKnob(args: {
  feature: string;
  key: string;
  organizationId: string;
  userId: string;
}) {
  const result = await resolveConfigKnob(getSupabase(), args);
  if (!result.error) recordKnobRead(`${args.feature}.${args.key}`, 'db');
  return result;
}
