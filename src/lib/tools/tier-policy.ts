import type { AnyToolHandler, ToolTier } from '@/lib/tools/types';

/** Resolve the registered handler policy after its argument schema has parsed. */
export function resolveToolTier(handler: AnyToolHandler, parsedArgs: unknown): ToolTier {
  return handler.tierFor ? handler.tierFor(parsedArgs) : handler.tier;
}
