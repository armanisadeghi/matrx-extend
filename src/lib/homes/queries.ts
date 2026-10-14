/** Platform home options, including General before its scope is materialized. */
import { getSupabase } from '@/lib/supabase/client';
import { type FunctionDescriptor, call, createDb } from '@ai-matrx/data/db';
import { z } from 'zod';

const HomeRowSchema = z.object({
  scope_id: z.string().uuid().nullable(),
  organization_id: z.string().uuid(),
  organization_name: z.string(),
  name: z.string(),
  is_general: z.boolean(),
});

type HomeRow = z.infer<typeof HomeRowSchema>;

const MY_HOMES = {
  schema: 'platform',
  name: 'my_homes',
  roles: ['authenticated'],
  registered: true,
} as FunctionDescriptor<Record<string, never>, HomeRow[]>;

const ENSURE_GENERAL_SCOPE = {
  schema: 'platform',
  name: 'ensure_general_scope',
  roles: ['authenticated'],
  registered: true,
} as FunctionDescriptor<{ p_org: string }, string>;

const homesDb = () => createDb({ client: getSupabase() });

function databaseMessage(error: unknown): string {
  const wrapped = error as { name?: string; cause?: { message?: string }; message?: string } | null;
  if (wrapped?.name === 'DatabaseError' && wrapped.cause?.message) return wrapped.cause.message;
  return error instanceof Error ? error.message : String(error);
}

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
  let rows: HomeRow[] | null;
  try {
    rows = await call(homesDb(), MY_HOMES, {});
  } catch (error) {
    throw new Error(`Could not load homes: ${databaseMessage(error)}`);
  }
  const parsed = z.array(HomeRowSchema).safeParse(rows ?? []);
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
  let scopeId: string;
  try {
    scopeId = await call(homesDb(), ENSURE_GENERAL_SCOPE, { p_org: organizationId });
  } catch (error) {
    throw new Error(`Could not choose home: ${databaseMessage(error)}`);
  }
  return z.string().uuid().parse(scopeId);
}
