/**
 * React hook that pulls the user's bindable compute targets from aidream.
 *
 * Used by `SandboxPickerChip` in the chat header to render the unified
 * "Your computers + Sandboxes" list. Server-side per-user scoping is
 * enforced by `GET /api/compute-targets` (Bearer auth via the shared
 * `apiGet` client).
 *
 * Refetches on:
 *   - Mount
 *   - When the popover opens (via the `enabled` flag flip)
 *   - Manual `refetch()` from the picker (e.g. after the user clicks
 *     "New sandbox" or after the user starts the matrx-local engine)
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiGet, apiPost } from '@/lib/api/client';
import type {
  ComputeTargetListResponse,
  ComputeTargetRef,
  SandboxBindingPayload,
} from '@/types/compute-target';

interface UseComputeTargetsResult {
  data: ComputeTargetListResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useComputeTargets(
  enabled: boolean = true,
): UseComputeTargetsResult {
  const [data, setData] = useState<ComputeTargetListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks the latest fetch so a stale response can't overwrite a fresher one.
  const fetchIdRef = useRef(0);

  const fetchOnce = useCallback(async () => {
    const myId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    const result = await apiGet<ComputeTargetListResponse>(
      '/api/compute-targets',
    );
    if (myId !== fetchIdRef.current) return;
    if (result.ok) {
      setData(result.data);
    } else {
      setError(result.error || `HTTP ${result.status}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void fetchOnce();
  }, [enabled, fetchOnce]);

  return { data, loading, error, refetch: fetchOnce };
}

/**
 * Resolve a `ComputeTargetRef` into the full sandbox-binding payload the chat
 * backend consumes. The extension calls this once per chat send (right before
 * shipping the request) so the legacy `sandbox` request field carries a
 * fresh binding — orchestrator tokens expire, tunnels may drop offline.
 *
 * Returns `null` when the device went offline / the sandbox isn't live / the
 * orchestrator refused. The chat send proceeds without a binding (agent runs
 * unbound) and the picker chip surfaces an "unavailable" state for follow-up.
 */
export async function resolveComputeTarget(
  ref: ComputeTargetRef,
): Promise<SandboxBindingPayload | null> {
  const result = await apiPost<SandboxBindingPayload>(
    '/api/compute-targets/resolve',
    { kind: ref.kind, id: ref.id },
  );
  if (!result.ok) {
    // The server's structured errors arrive as `result.error`; surface them
    // to the picker via the chat-store's `boundTargetUnavailable` flag.
    return null;
  }
  return result.data;
}
