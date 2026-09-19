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

import { useRequestOrganizationId } from '@/hooks/use-request-organization';
import { useAuthStore } from '@/state/auth';
import { type AgentSummary, isMandateAgentId } from '@ai-matrx/agents/catalog';
import type { DefaultRowState } from '@ai-matrx/agents/catalog';
import { useAgentCatalog, useAgentCatalogState } from '@ai-matrx/agents/catalog/react';
import { useCallback, useEffect } from 'react';
import { ensureAuthenticatedCatalogLoaded } from './catalog';

/** One automatic re-ask after a refused default row; internal timing, not a knob. */
const AUTO_RETRY_DELAY_MS = 1_500;

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
  const signedIn = useAuthStore((state) => state.status === 'signed-in');
  const organizationId = useRequestOrganizationId();

  useEffect(() => {
    if (signedIn && organizationId) void ensureAuthenticatedCatalogLoaded(catalog);
  }, [catalog, organizationId, signedIn]);

  useEffect(() => {
    if (signedIn && organizationId && mandateKey) catalog.ensureDefaultRow(mandateKey);
  }, [catalog, mandateKey, organizationId, signedIn]);

  // A refused default row heals itself ONCE per refusal while this surface is
  // mounted and signed in (2026-09-19: the first ask after sign-in was refused
  // and nothing re-asked until a reload, so the header showed no agent). The
  // package re-asks on `retryDefaultRow`; this bounds it to one automatic
  // retry per error so a persistent refusal cannot loop — after that the
  // picker's banner and its Try again button carry the truth.
  const defaultRowError = useAgentCatalogState(
    useCallback(
      (state: { defaultRows: Record<string, DefaultRowState> }) =>
        mandateKey ? (state.defaultRows[mandateKey]?.error ?? null) : null,
      [mandateKey],
    ),
  );
  useEffect(() => {
    if (!signedIn || !organizationId || !mandateKey || !defaultRowError) return;
    const timer = setTimeout(() => catalog.retryDefaultRow(mandateKey), AUTO_RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [catalog, defaultRowError, mandateKey, organizationId, signedIn]);

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

  if (!agentId || !signedIn) return { name: null, description: null, resolving: false };
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
