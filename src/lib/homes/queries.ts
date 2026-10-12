/** Platform home options, including General before its scope is materialized. */
import { platformDb } from '@/lib/supabase/schemas';
import { z } from 'zod';

const HomeRowSchema = z.object({
  scope_id: z.string().uuid().nullable(),
  organization_id: z.string().uuid(),
  organization_name: z.string(),
  name: z.string(),
  is_general: z.boolean(),
});

export interface HomeChoice {
  /** Stable UI identity; every General uses general:<organization UUID>. */
  id: string;
  organization_id: string;
  scope_id: string | null;
  is_general: boolean;
  name: string;
  label: string;
}

/** Read all homes the platform permits, without creating any scope. */
export async function listHomeChoices(): Promise<HomeChoice[]> {
  const { data, error } = await platformDb().rpc('my_homes');
  if (error) throw new Error(`Could not load homes: ${error.message}`);
  const parsed = z.array(HomeRowSchema).safeParse(data ?? []);
  if (!parsed.success)
    throw new Error('Could not load homes: an unexpected home shape was returned.');
  const counts = new Map<string, number>();
  for (const row of parsed.data) {
    const name = row.name.toLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (!row.scope_id && !row.is_general)
      throw new Error('Could not load homes: a non-General home has no scope.');
  }
  return parsed.data
    .map((row) => ({
      id: row.is_general ? `general:${row.organization_id}` : (row.scope_id as string),
      scope_id: row.scope_id,
      is_general: row.is_general,
      organization_id: row.organization_id,
      name: row.name,
      label:
        row.is_general || (counts.get(row.name.toLowerCase()) ?? 0) > 1
          ? `${row.name} · ${row.organization_name}`
          : row.name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Resolve a chosen option only in a user write action, never while listing/filtering. */
export async function resolveHomeScopeId(choice: string | HomeChoice): Promise<string> {
  const choiceId = typeof choice === 'string' ? choice : (choice.scope_id ?? choice.id);
  if (!choiceId.startsWith('general:')) return z.string().uuid().parse(choiceId);
  const organizationId = z.string().uuid().parse(choiceId.slice('general:'.length));
  const { data, error } = await platformDb().rpc('ensure_general_scope', { p_org: organizationId });
  if (error) throw new Error(`Could not choose home: ${error.message}`);
  return z.string().uuid().parse(data);
}
