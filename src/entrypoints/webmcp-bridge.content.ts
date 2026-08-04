/**
 * WebMCP page → SW bridge.
 *
 * This content script attaches to allowlisted origins (see
 * `src/lib/origin-allowlist.ts`) and ferries WebMCP tool calls between
 * the page's main world (where `register.ts` injects tool stubs into
 * `navigator.modelContext`) and the extension's service worker.
 *
 * Wire format (page → content script):
 *   window.postMessage(
 *     { __matrx_webmcp_call: true, callId, toolName, args },
 *     '*',
 *   )
 *
 * Wire format (content script → page):
 *   window.postMessage(
 *     { __matrx_webmcp_result: true, callId, ok, result?, error? },
 *     '*',
 *   )
 *
 * The `callId` is the canonical correlator. `toolName` is forwarded for
 * logging only — the SW dispatcher resolves the registered handler from
 * the same name.
 *
 * Sender validation: we accept messages only when `event.source === window`
 * (so other frames / extensions can't impersonate the page) and only on
 * pages whose top-level origin matches the allowlist (the manifest's
 * `matches` already restricts execution to those, so this is a defense in
 * depth rather than the primary gate).
 */

import { matchesAllowedOrigin } from '@/lib/origin-allowlist';
import { defineContentScript } from 'wxt/utils/define-content-script';

interface PageCallMessage {
  __matrx_webmcp_call: true;
  callId: string;
  toolName: string;
  args: unknown;
}

interface SwResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
}

const isPageCallMessage = (v: unknown): v is PageCallMessage => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.__matrx_webmcp_call === true && typeof o.callId === 'string' && typeof o.toolName === 'string'
  );
};

export default defineContentScript({
  // Roughly mirrors `src/lib/origin-allowlist.ts` but uses Chrome's
  // stricter match-pattern grammar (no mid-host wildcards, no port
  // wildcards). The content script gate is therefore broader than the
  // runtime allowlist — `matchesAllowedOrigin` below is the actual
  // security boundary and rejects e.g. non-team Vercel previews.
  matches: [
    'https://*.aimatrx.com/*',
    'https://aimatrx.com/*',
    'https://*.mymatrx.com/*',
    'https://mymatrx.com/*',
    'https://*.vercel.app/*',
    'http://localhost/*',
    'http://127.0.0.1/*',
  ],
  runAt: 'document_start',
  allFrames: false,
  main() {
    // Defensive double-check at runtime: the manifest restricts where this
    // script runs, but the matcher in `origin-allowlist.ts` is the single
    // source of truth shared with the SW gate, so we also assert here.
    if (!matchesAllowedOrigin(window.location.href)) return;

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!isPageCallMessage(data)) return;

      const { callId, toolName, args } = data;

      void chrome.runtime
        .sendMessage({
          __matrx: true,
          kind: 'webmcp:call',
          payload: { callId, toolName, args },
        })
        .then((response: unknown) => {
          const result = normalizeResponse(response);
          window.postMessage(
            {
              __matrx_webmcp_result: true,
              callId,
              ok: result.ok,
              result: result.result,
              ...(result.error !== undefined && { error: result.error }),
            },
            window.location.origin,
          );
        })
        .catch((err: unknown) => {
          window.postMessage(
            {
              __matrx_webmcp_result: true,
              callId,
              ok: false,
              error: (err as Error)?.message ?? String(err),
            },
            window.location.origin,
          );
        });
    });
  },
});

function normalizeResponse(raw: unknown): SwResponse {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'no response from extension' };
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.__error === 'string') {
    return { ok: false, error: o.__error };
  }
  if (typeof o.ok === 'boolean') {
    return {
      ok: o.ok,
      result: o.result,
      ...(typeof o.error === 'string' && { error: o.error }),
    };
  }
  return { ok: false, error: 'malformed response from extension' };
}
