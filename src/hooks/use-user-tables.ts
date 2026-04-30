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

  const createTable = useCallback(
    async (input: CreateUserTableInput): Promise<{ id: string } | null> => {
      const result = await createUserTableFromSchema(input);
      if (result) await refresh();
      return result;
    },
    [refresh],
  );

  const appendRows = useCallback(
    async (
      tableId: string,
      rows: Record<string, unknown>[],
    ): Promise<{ inserted: number } | null> => {
      return appendRowsToUserTable(tableId, rows);
    },
    [],
  );

  return { tables, loading, error, refresh, createTable, appendRows };
}
