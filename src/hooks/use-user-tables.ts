import {
  type CreateUserTableInput,
  type PickableTable,
  appendRowsToUserTable,
  createUserTableFromSchema,
  listPickableTables,
} from '@/lib/supabase/user-tables';
import { useCallback, useEffect, useState } from 'react';

/**
 * The record-store Tables the Showcase may save into, across ALL of the person's organizations. `organizationFilter`
 * is an optional explicit page filter (default: all organizations); it is never the active org.
 */
export function useUserTables(organizationFilter?: string | null) {
  const [tables, setTables] = useState<PickableTable[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTables(await listPickableTables(organizationFilter));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [organizationFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Both writers THROW on a refused write (after recording it) — they never resolve to a success-shaped null. The
  // caller decides what to render; it must not treat "no error" as "saved"
  // without awaiting these.
  const createTable = useCallback(
    async (input: CreateUserTableInput): Promise<{ id: string }> => {
      const result = await createUserTableFromSchema(input);
      await refresh();
      return result;
    },
    [refresh],
  );

  const appendRows = useCallback(
    async (
      tableId: string,
      operationOrganizationId: string,
      rows: Record<string, unknown>[],
    ): Promise<{ inserted: number }> => {
      return appendRowsToUserTable(tableId, operationOrganizationId, rows);
    },
    [],
  );

  return { tables, loading, error, refresh, createTable, appendRows };
}
