/**
 * Read ONE selected agent's row out of the package catalog.
 *
 * Every surface that used to keep its own `agents` array just to turn the
 * selected id into a name reads this instead. It is a projection of the
 * package's `byId` registry (and its mandate default rows) — no second list,
 * no second sort, no second membership rule.
 *
 * `mandate:<key>` ids are not catalogue rows: they are resolved LIVE by the
 * package through the aidream mandate door, so the name shown is the real
 * Holder's name. That is the whole point of retiring the hardcoded
 * "Matrx Browser Agent" string — a label that lies is worse than no label.
 */

import { type AgentSummary, isMandateAgentId } from '@ai-matrx/agents/catalog';
import type { DefaultRowState } from '@ai-matrx/agents/catalog';
import { useAgentCatalog, useAgentCatalogState } from '@ai-matrx/agents/catalog/react';
import { useCallback, useEffect } from 'react';

export interface SelectedAgentRow {
  /** The agent's display name, or `null` while it is still being resolved. */
  name: string | null;
  description: string | null;
  /** True while the name is genuinely unknown yet (never a silent blank). */
  resolving: boolean;
}

export function mandateKeyOf(agentId: string | null | undefined): string | null {
  if (!agentId || !isMandateAgentId(agentId)) return null;
  return agentId.slice('mandate:'.length);
}

export function useAgentRow(agentId: string | null | undefined): SelectedAgentRow {
  const catalog = useAgentCatalog();
  const mandateKey = mandateKeyOf(agentId);

  useEffect(() => {
    void catalog.ensureLoaded();
  }, [catalog]);

  useEffect(() => {
    if (mandateKey) catalog.ensureDefaultRow(mandateKey);
  }, [catalog, mandateKey]);

  // Every selector below returns a reference the catalog itself owns, so
  // `useSyncExternalStore` sees a stable snapshot between changes.
  const selectRow = useCallback(
    (state: { byId: Record<string, AgentSummary> }) =>
      agentId && !mandateKey ? state.byId[agentId] : undefined,
    [agentId, mandateKey],
  );
  const selectDefaultRow = useCallback(
    (state: { defaultRows: Record<string, DefaultRowState> }) =>
      mandateKey ? state.defaultRows[mandateKey] : undefined,
    [mandateKey],
  );
  const row = useAgentCatalogState(selectRow);
  const defaultRow = useAgentCatalogState(selectDefaultRow);
  const status = useAgentCatalogState(selectStatus);

  if (!agentId) return { name: null, description: null, resolving: false };
  if (mandateKey) {
    if (defaultRow?.row) {
      return {
        name: defaultRow.row.name,
        description: defaultRow.row.description ?? null,
        resolving: false,
      };
    }
    return { name: null, description: null, resolving: defaultRow?.loading !== false };
  }
  if (row) return { name: row.name, description: row.description ?? null, resolving: false };
  return { name: null, description: null, resolving: status === 'loading' };
}

const selectStatus = (state: { status: string }) => state.status;
