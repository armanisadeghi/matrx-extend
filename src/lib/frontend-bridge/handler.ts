/**
 * FRONTEND_RPC envelope handler (Phase 2 C1.b).
 *
 * Routes inbound `chrome.runtime.sendMessage(extId, envelope)` calls from the
 * matrx-frontend admin app (and per-PR Vercel previews / local dev) at
 * https://aimatrx.com / https://*.mymatrx.com / etc. The listener that
 * actually subscribes to `chrome.runtime.onMessageExternal` lives in
 * `src/lib/background/bootstrap.ts`; this module provides the pure routing
 * fn so the same envelope shape can also flow over Supabase Broadcast
 * (see broadcast.ts) and produce identical responses.
 *
 * Envelope contract (CONTRACTUAL — matches matrx-frontend + Broadcast):
 *
 *   request:  { channel: "FRONTEND_RPC", action, payload, requestId }
 *   response: { ok: true,  result, requestId }
 *           | { ok: false, error,  requestId }
 *
 * Supported actions:
 *   - "ping"         → { pong, version, timestamp }
 *   - "capabilities" → enumerate read + action tier tools (no privileged / ask-user)
 *   - "openPanel"    → open the side panel + broadcast an UI hint
 *   - "callTool"     → run a registered tool through the same dispatch path WebMCP uses
 */

import { readIsAdminFromStorage } from '@/lib/auth/is-admin';
import { log } from '@/lib/debug/log';
import { matchesAllowedOrigin } from '@/lib/origin-allowlist';
import { readDefaultPermissionMode } from '@/lib/settings/persisted';
import { ensureToolDescriptions } from '@/lib/tools/descriptions';
import { handleWebmcpCall } from '@/lib/tools/dispatch';
import { listAllHandlers } from '@/lib/tools/registry';
import { z } from 'zod';

// ─── Wire-format schemas (CONTRACTUAL — must match across repos) ─────────────

export const FRONTEND_RPC_CHANNEL = 'FRONTEND_RPC' as const;

export const FrontendRpcEnvelopeSchema = z.object({
  channel: z.literal(FRONTEND_RPC_CHANNEL),
  action: z.string().min(1),
  payload: z.unknown().optional(),
  requestId: z.string().min(1),
});
export type FrontendRpcEnvelope = z.infer<typeof FrontendRpcEnvelopeSchema>;

export type FrontendRpcResponse =
  | { ok: true; result: unknown; requestId: string }
  | { ok: false; error: string; requestId: string };

// ─── Action payload schemas ─────────────────────────────────────────────────

const PingPayloadSchema = z.unknown().optional();

const CapabilitiesPayloadSchema = z.unknown().optional();

const OpenPanelPayloadSchema = z.object({
  panelId: z.string().min(1),
  data: z.unknown().optional(),
});

const CallToolPayloadSchema = z.object({
  toolName: z.string().min(1),
  args: z.unknown().optional(),
});

// ─── Handler ────────────────────────────────────────────────────────────────

interface SenderInfo {
  url?: string;
  origin?: string;
}

/**
 * Validate the envelope, route by `action`, return a typed response.
 *
 * Origin enforcement is the listener's responsibility (bootstrap.ts checks
 * `sender.origin` / `sender.url` against `matchesAllowedOrigin` before
 * calling here). This fn re-checks defensively for the Broadcast path, where
 * the "origin" is implicit in the per-user channel name and we trust
 * Supabase RLS to gate it — we still log if it's untrusted so any drift
 * is visible.
 */
export async function handleFrontendRpc(
  envelope: FrontendRpcEnvelope,
  sender: SenderInfo,
): Promise<FrontendRpcResponse> {
  const { action, payload, requestId } = envelope;
  log.info('frontend-bridge', `← rpc ${action} req=${requestId}`, {
    sender: sender.origin ?? sender.url ?? 'unknown',
  });

  // Defensive origin check — bootstrap.ts also enforces this, but the
  // Broadcast path could theoretically deliver an envelope from an
  // unauthenticated tab. matchesAllowedOrigin is a pure URL check; if no
  // sender URL is provided we treat it as trusted (Broadcast path).
  if (sender.url && !matchesAllowedOrigin(sender.url)) {
    log.warn('frontend-bridge', `rejected ${action} from disallowed sender`, {
      sender: sender.url,
    });
    return { ok: false, error: 'origin not allowed', requestId };
  }

  try {
    switch (action) {
      case 'ping':
        return await actionPing(payload, requestId);
      case 'capabilities':
        return await actionCapabilities(payload, requestId);
      case 'openPanel':
        return await actionOpenPanel(payload, requestId);
      case 'callTool':
        return await actionCallTool(payload, requestId);
      default:
        return {
          ok: false,
          error: `unknown action: ${action}`,
          requestId,
        };
    }
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    log.error('frontend-bridge', `${action} crashed`, message);
    return { ok: false, error: message, requestId };
  }
}

// ─── Actions ────────────────────────────────────────────────────────────────

async function actionPing(payload: unknown, requestId: string): Promise<FrontendRpcResponse> {
  PingPayloadSchema.parse(payload);
  const version = chrome.runtime.getManifest().version;
  return {
    ok: true,
    result: { pong: true, version, timestamp: Date.now() },
    requestId,
  };
}

async function actionCapabilities(
  payload: unknown,
  requestId: string,
): Promise<FrontendRpcResponse> {
  CapabilitiesPayloadSchema.parse(payload);
  // Public capability surface: read + action only. Privileged + ask-user
  // are intentionally excluded — privileged shouldn't be advertised to
  // any external surface, and ask-user requires the side panel UI.
  // Admin-only tools are filtered for non-admins (the execution gate in
  // handleWebmcpCall enforces this regardless; the filter just keeps the
  // advertisement honest).
  const isAdmin = await readIsAdminFromStorage();
  const handlers = listAllHandlers().filter(
    (h) => (h.tier === 'read' || h.tier === 'action') && (isAdmin || !h.admin_only),
  );
  // Descriptions live ONLY in the DB (Rule 4) — read them live, never hardcoded.
  const descs = await ensureToolDescriptions();
  const tools = handlers.map((h) => ({
    name: h.name,
    tier: h.tier,
    description: descs.get(h.name) ?? null,
    admin_only: h.admin_only ?? false,
  }));
  return {
    ok: true,
    result: {
      version: chrome.runtime.getManifest().version,
      tools,
    },
    requestId,
  };
}

async function actionOpenPanel(payload: unknown, requestId: string): Promise<FrontendRpcResponse> {
  const parsed = OpenPanelPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: `openPanel: invalid payload — ${JSON.stringify(parsed.error.format())}`,
      requestId,
    };
  }
  const { panelId, data } = parsed.data;

  // chrome.sidePanel.open requires a windowId or tabId. Programmatic open
  // also requires a user gesture; cross-extension messaging does NOT
  // count as a gesture, so this MAY fail with "must be in response to a
  // user gesture" depending on Chrome version. We attempt anyway and
  // gracefully degrade — the side panel may already be open from the
  // user clicking the action button.
  let opened = false;
  let openReason = 'unknown';
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.windowId !== undefined) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      opened = true;
      openReason = 'opened';
    } else {
      openReason = 'no-active-window';
    }
  } catch (err) {
    openReason = (err as Error)?.message ?? 'open-failed';
    log.warn('frontend-bridge', `sidePanel.open failed for ${panelId}`, openReason);
  }

  // Broadcast a UI hint regardless — if the side panel is already open
  // (or opens shortly), it can pick up the panelId from this message.
  // This is a fire-and-forget signal; React surfaces listen if mounted.
  try {
    chrome.runtime
      .sendMessage({
        __matrx: true,
        kind: 'frontend:open-panel-hint',
        payload: { panelId, data },
      })
      .catch(() => {
        // No listener is fine — sidepanel may be closed.
      });
  } catch {
    /* extension context may be closing; ignore */
  }

  return {
    ok: true,
    result: { opened, panelId, reason: openReason },
    requestId,
  };
}

async function actionCallTool(payload: unknown, requestId: string): Promise<FrontendRpcResponse> {
  const parsed = CallToolPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: `callTool: invalid payload — ${JSON.stringify(parsed.error.format())}`,
      requestId,
    };
  }
  const { toolName, args } = parsed.data;

  const permissionMode = await readDefaultPermissionMode();
  const callId = `frontend-${requestId}`;
  const wrapped = await handleWebmcpCall(
    { callId, toolName, args },
    { permissionMode, initiator: 'frontend' },
  );

  if (wrapped.ok) {
    return { ok: true, result: wrapped.result, requestId };
  }
  return {
    ok: false,
    error: wrapped.error ?? 'tool failed',
    requestId,
  };
}
