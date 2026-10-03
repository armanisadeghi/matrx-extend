import type { AnyToolHandler, ToolTier } from './types';

/** Server capabilities shown in Tools; these are never client executors. */
export interface ServerCatalogEntry {
  name: string;
  tier: ToolTier;
  execution: 'server';
  admin_only?: boolean;
  required_optional_permissions?: never;
}

export const SERVER_CATALOG: readonly ServerCatalogEntry[] = [
  { name: 'records', tier: 'action', execution: 'server' },
];

export type ToolCatalogEntry = AnyToolHandler | ServerCatalogEntry;
export function isServerCatalogEntry(entry: ToolCatalogEntry): entry is ServerCatalogEntry {
  return 'execution' in entry && entry.execution === 'server';
}
