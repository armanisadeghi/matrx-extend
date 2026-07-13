/**
 * React access to the token-broker primitive (src/lib/broker/).
 *
 * Thin: state + actions over the SW-owned cache. Components get token-free
 * snapshots for display; the mint action returns the credential's metadata
 * (a consumer that needs the raw token should call `getBrokeredCredential`
 * from the context that will use it, not hold it in React state).
 */

import {
  type BrokerCacheEntrySnapshot,
  type BrokerProxiedJsonResult,
  type BrokerResult,
  type BrokeredCredential,
  type MintOptions,
  type TierPolicy,
  callProxiedJson,
  getBrokerCacheSnapshot,
  getBrokeredCredential,
  invalidateBrokeredCredential,
} from '@/lib/broker';
import { useCallback, useEffect, useState } from 'react';

export interface UseBroker {
  snapshot: BrokerCacheEntrySnapshot[];
  refreshSnapshot: () => Promise<void>;
  mint: (
    audience: string,
    tierPolicy: TierPolicy,
    opts?: MintOptions,
  ) => Promise<BrokerResult<BrokeredCredential>>;
  invalidate: (audience: string, tierPolicy: TierPolicy, model?: string) => Promise<void>;
  proxiedJson: (msg: {
    audience: string;
    tierPolicy: TierPolicy;
    body: unknown;
    headers?: Record<string, string>;
    model?: string;
  }) => Promise<BrokerProxiedJsonResult>;
}

export function useBroker(): UseBroker {
  const [snapshot, setSnapshot] = useState<BrokerCacheEntrySnapshot[]>([]);

  const refreshSnapshot = useCallback(async () => {
    try {
      setSnapshot(await getBrokerCacheSnapshot());
    } catch {
      // SW not awake yet — snapshot stays as-is; next action wakes it.
    }
  }, []);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  const mint = useCallback(
    async (audience: string, tierPolicy: TierPolicy, opts?: MintOptions) => {
      const result = await getBrokeredCredential(audience, tierPolicy, opts ?? {});
      void refreshSnapshot();
      return result;
    },
    [refreshSnapshot],
  );

  const invalidate = useCallback(
    async (audience: string, tierPolicy: TierPolicy, model?: string) => {
      await invalidateBrokeredCredential(audience, tierPolicy, model);
      void refreshSnapshot();
    },
    [refreshSnapshot],
  );

  const proxiedJson = useCallback(
    async (msg: {
      audience: string;
      tierPolicy: TierPolicy;
      body: unknown;
      headers?: Record<string, string>;
      model?: string;
    }) => {
      const result = await callProxiedJson(msg);
      void refreshSnapshot();
      return result;
    },
    [refreshSnapshot],
  );

  return { snapshot, refreshSnapshot, mint, invalidate, proxiedJson };
}
