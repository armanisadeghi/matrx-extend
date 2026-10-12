/**
 * Test bridge for `@/lib/api/matrx-api`: runs the REAL generated operation
 * descriptor against a fake `Api` and forwards the resolved (method, path, body)
 * to the test's mocked `@/lib/api/client` verbs (`apiGet` / `apiPost` / ...),
 * so a test keeps asserting the wire shape (path + body) while the path now
 * comes from the generated contract instead of a hand-typed string.
 *
 *   vi.mock('@/lib/api/matrx-api', () => import('../helpers/wire-bridge').then((m) => m.wireBridge('/api')));
 */

import type { ApiResult } from '@/lib/api/client';
import * as client from '@/lib/api/client';

interface Args {
  path?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: unknown;
}
interface Op {
  m: string;
  p: string;
}
type Verbs = Record<
  string,
  (path: string, body: unknown, signal: undefined, opts: unknown) => Promise<ApiResult<unknown>>
>;

class Settled extends Error {
  constructor(readonly result: ApiResult<unknown>) {
    super('settled');
  }
}

export function wireBridge(prefix = '') {
  const verbs = (): Verbs => {
    const c = client as unknown as Record<string, (...a: unknown[]) => Promise<ApiResult<unknown>>>;
    return {
      GET: (path, _b, _s, opts) => c.apiGet?.(path, undefined, opts) as Promise<ApiResult<unknown>>,
      POST: (path, body, _s, opts) =>
        c.apiPost?.(path, body, undefined, opts) as Promise<ApiResult<unknown>>,
      PATCH: (path, body, _s, opts) =>
        c.apiPatch?.(path, body, undefined, opts) as Promise<ApiResult<unknown>>,
      PUT: (path, body, _s, opts) =>
        c.apiPut?.(path, body, undefined, opts) as Promise<ApiResult<unknown>>,
      DELETE: (path, _b, _s, opts) =>
        c.apiDelete?.(path, undefined, opts) as Promise<ApiResult<unknown>>,
    };
  };

  const runOpAs = async (
    call: (api: unknown, o: unknown) => Promise<unknown>,
    opts?: unknown,
  ): Promise<ApiResult<never>> => {
    const fakeApi = {
      call: async (op: Op, args: Args = {}) => {
        let path = op.p.replace(/\{(\w+)\}/g, (_m, k: string) =>
          encodeURIComponent(String(args.path?.[k])),
        );
        const query = Object.entries(args.query ?? {})
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
          .join('&');
        if (query) path += `?${query}`;
        const result = await verbs()[op.m]?.(`${prefix}${path}`, args.body, undefined, opts);
        if (!result) throw new Error(`unmocked ${op.m} ${path}`);
        if (!result.ok) throw new Settled(result);
        return result.data;
      },
    };
    try {
      return { ok: true, data: (await call(fakeApi, {})) as never };
    } catch (err) {
      if (err instanceof Settled) return err.result as ApiResult<never>;
      throw err;
    }
  };

  return { runOp: runOpAs, runOpAs, getMatrxApi: () => ({}) };
}
