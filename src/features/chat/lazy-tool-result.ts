/**
 * Lazy tool results for the extension's own chat rows (Pilot, legacy Assistant
 * stream). The server may leave a big result off the stream: the
 * `tool_completed` frame then carries `result_omitted: true`, a short
 * `result_preview`, `output_chars` and the `tool_call_id` (aidream
 * `matrx_ai/tools/pinned_tools.py`, env `MATRX_LAZY_TOOL_RESULTS`). The row
 * shows the preview and reads the full result by id when the person opens it.
 * The package chat (`@ai-matrx/chat`) does the same through its own
 * `ensureToolCallDetails`; these rows live outside its store.
 */

import { fetchToolCallOutput } from '@/lib/supabase/queries';
import type { ToolPartCall } from '@/state/chat';
import { useCallback, useEffect, useState } from 'react';

/** The omitted-result marker from a `tool_completed` frame's `data`, or null. */
export function omittedFromWire(
  inner: Record<string, unknown>,
): NonNullable<ToolPartCall['resultOmitted']> | null {
  if (inner.result_omitted !== true) return null;
  return {
    toolCallId: typeof inner.tool_call_id === 'string' ? inner.tool_call_id : null,
    preview: typeof inner.result_preview === 'string' ? inner.result_preview : null,
    outputChars: typeof inner.output_chars === 'number' ? inner.output_chars : null,
  };
}

type Loaded = { state: 'loaded'; result: unknown } | { state: 'error'; error: string };

/** One read per id for the panel's life, shared by every row that shows it. */
const cache = new Map<string, Loaded>();
const inFlight = new Map<string, Promise<Loaded>>();

export function __resetLazyToolResultCache(): void {
  cache.clear();
  inFlight.clear();
}

function load(toolCallId: string): Promise<Loaded> {
  const pending = inFlight.get(toolCallId);
  if (pending) return pending;
  const p = fetchToolCallOutput(toolCallId)
    .then((result): Loaded => ({ state: 'loaded', result }))
    .catch(
      (err: unknown): Loaded => ({
        state: 'error',
        error: err instanceof Error ? err.message : 'Could not load this tool result.',
      }),
    )
    .then((settled) => {
      cache.set(toolCallId, settled);
      inFlight.delete(toolCallId);
      return settled;
    });
  inFlight.set(toolCallId, p);
  return p;
}

export interface LazyToolResult {
  /** The tool with its full result once loaded (the input tool otherwise). */
  tool: ToolPartCall;
  /** True while the row still holds only the preview. */
  pending: boolean;
  loading: boolean;
  error: string | null;
  /** Start the by-id read (a click on the row). */
  open: () => void;
}

export function useLazyToolResult(tool: ToolPartCall): LazyToolResult {
  const omitted = tool.result === undefined ? tool.resultOmitted : undefined;
  const id = omitted?.toolCallId ?? null;
  const [settled, setSettled] = useState<Loaded | null>(() =>
    id ? (cache.get(id) ?? null) : null,
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSettled(id ? (cache.get(id) ?? null) : null);
  }, [id]);

  const open = useCallback(() => {
    if (!id || cache.get(id)?.state === 'loaded') return;
    setLoading(true);
    void load(id).then((s) => {
      setSettled(s);
      setLoading(false);
    });
  }, [id]);

  if (!omitted) return { tool, pending: false, loading: false, error: null, open };
  if (!id) {
    return {
      tool,
      pending: true,
      loading: false,
      error: 'This result was not saved, so it cannot be loaded.',
      open,
    };
  }
  if (settled?.state === 'loaded') {
    const { resultOmitted: _omitted, ...rest } = tool;
    return {
      tool: { ...rest, result: settled.result },
      pending: false,
      loading: false,
      error: null,
      open,
    };
  }
  return {
    tool,
    pending: true,
    loading,
    error: settled?.state === 'error' ? settled.error : null,
    open,
  };
}
