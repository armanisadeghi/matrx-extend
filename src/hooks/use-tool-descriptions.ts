/**
 * React hook exposing the live bare-name → description map for matrx-extend
 * tools, read from the DB (the source of truth) via
 * `src/lib/tools/descriptions.ts`. Seeds from the in-memory snapshot (instant
 * when already loaded this session) then fetches. See docs/TOOL_SOURCE_OF_TRUTH.md
 * (Rule 4) — descriptions are never hardcoded in the extension.
 */
import { ensureToolDescriptions, toolDescriptionsSnapshot } from '@/lib/tools/descriptions';
import { useEffect, useState } from 'react';

export function useToolDescriptions(): Map<string, string> {
  const [map, setMap] = useState<Map<string, string>>(() => toolDescriptionsSnapshot());
  useEffect(() => {
    let alive = true;
    void ensureToolDescriptions().then((m) => {
      if (alive) setMap(new Map(m));
    });
    return () => {
      alive = false;
    };
  }, []);
  return map;
}
