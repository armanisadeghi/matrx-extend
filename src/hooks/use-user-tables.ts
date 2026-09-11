import {
  type CreateUserTableInput,
  type UserTable,
  appendRowsToUserTable,
  createUserTableFromSchema,
  listUserTables,
} from '@/lib/supabase/user-tables';
import { useCallback, useEffect, useState } from 'react';

export function useUserTables() {
  const [tables, setTables] = useState<UserTable[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTables(await listUserTables());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

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
    async (tableId: string, rows: Record<string, unknown>[]): Promise<{ inserted: number }> => {
      return appendRowsToUserTable(tableId, rows);
    },
    [],
  );

  return { tables, loading, error, refresh, createTable, appendRows };
}
