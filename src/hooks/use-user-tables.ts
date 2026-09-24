import {
  type CreateUserTableInput,
  type PickableTable,
  appendRowsToUserTable,
  createUserTableFromSchema,
  listPickableTables,
} from '@/lib/supabase/user-tables';
import { useCallback, useEffect, useState } from 'react';

/**
 * The tables the Showcase may save into for `organizationId` — record-store Tables and the
 * person's unmoved older datasets (lane INTEG-CLIENTS). With no organization there is nothing
 * to list: the org picker is where that is resolved, never a guess here.
 */
export function useUserTables(organizationId: string | null | undefined) {
  const [tables, setTables] = useState<PickableTable[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!organizationId) {
      setTables(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setTables(await listPickableTables(organizationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Both writers THROW `DbFailureError` on a refused write (after telling the
  // user and recording it) — they never resolve to a success-shaped null. The
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
