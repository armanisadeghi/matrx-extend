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
 *   - "captureHandoff.pickUp"
 *                    → switch this browser to the organization the web app is
 *                      talking about, point the panel at one waiting page, and
 *                      report honestly what actually happened
 */

import { getCurrentUser } from '@/lib/auth/flow';
import { readIsAdminFromStorage } from '@/lib/auth/is-admin';
import { CAPTURE_PICKUP_MESSAGE, writeCapturePickup } from '@/lib/capture-ladder/pickup';
import { countNeedsYou } from '@/lib/capture-ladder/queue';
import { log } from '@/lib/debug/log';
import {
  getActiveOrganizationId,
  listMemberOrganizations,
  selectActiveOrganization,
} from '@/lib/org/active-org';
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

/**
 * CONTRACTUAL — matches matrx-frontend. The organization is REQUIRED because
 * the whole point of this action is that the two surfaces resolve their active
 * organization independently: the web app must say which one it means, and
 * this extension must verify the person is actually in it.
 */
const CapturePickUpPayloadSchema = z.object({
  organizationId: z.string().uuid(),
  handoffId: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
});

// ─── Handler ────────────────────────────────────────────────────────────────

interface SenderInfo {
  url?: string | undefined;
  origin?: string | undefined;
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
      case 'captureHandoff.pickUp':
        return await actionCaptureHandoffPickUp(payload, requestId);
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

/**
 * "Open the page my tray is shouting about."
 *
 * ## The defect this closes
 *
 * The web app's tray reads `media.capture_handoff` filtered by ITS active
 * organization; this extension reads it filtered by the organization in
 * `src/lib/org/active-org.ts`. The two resolve independently, and one person's
 * waiting rows routinely sit in three of their own organizations at once — so
 * the page the web app is shouting about was simply invisible here, and the
 * panel said a calm "nothing needs your browser".
 *
 * ## What it refuses
 *
 * Never trusts the caller's organization id. The person must be signed in to
 * the extension AND an active member of that organization per the canonical
 * `mbr_for_user` read; anything else is refused with a sentence they can act
 * on, not a code.
 *
 * ## What it never pretends
 *
 * `chrome.sidePanel.open()` needs a user gesture, and cross-extension
 * messaging is not one — so Chrome may refuse. `panelOpened` is then false and
 * `panelReason` carries what Chrome actually said, so the web app can tell the
 * person to click the extension icon instead of claiming a panel that is not
 * there (law 4).
 */
async function actionCaptureHandoffPickUp(
  payload: unknown,
  requestId: string,
): Promise<FrontendRpcResponse> {
  const parsed = CapturePickUpPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        'captureHandoff.pickUp needs the organization the page is waiting in (organizationId, a uuid), and optionally handoffId and url.',
      requestId,
    };
  }
  const { organizationId, handoffId, url } = parsed.data;

  const user = await getCurrentUser();
  if (!user?.id) {
    return {
      ok: false,
      error:
        'Nobody is signed in to the Matrx extension in this browser. Open the extension, sign in, and try again.',
      requestId,
    };
  }

  let organizations: Awaited<ReturnType<typeof listMemberOrganizations>>;
  try {
    organizations = await listMemberOrganizations();
  } catch (err) {
    return {
      ok: false,
      error: `The extension could not read your workspaces just now, so it cannot open that page: ${
        (err as Error)?.message ?? String(err)
      }`,
      requestId,
    };
  }
  const match = organizations.find((o) => o.id === organizationId);
  if (!match) {
    return {
      ok: false,
      error:
        'The person signed in to this extension is not an active member of that workspace, so its waiting pages cannot be opened here. Sign in to the extension as the right person, or ask an admin of that workspace to add you.',
      requestId,
    };
  }

  const previousOrganizationId = await getActiveOrganizationId();
  const organizationSwitched = previousOrganizationId !== match.id;
  // The ONE resolver owns the stored selection — this call site never writes
  // STORAGE_KEYS.ACTIVE_ORGANIZATION itself.
  await selectActiveOrganization(match);

  await writeCapturePickup({ handoffId, url });

  let panelOpened = false;
  let panelReason = 'no-active-window';
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.windowId !== undefined) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      panelOpened = true;
      panelReason = 'opened';
    }
  } catch (err) {
    panelReason = (err as Error)?.message ?? 'open-failed';
    log.warn('frontend-bridge', 'captureHandoff.pickUp could not open the side panel', panelReason);
  }

  // An ALREADY-OPEN panel must react now, not on the next poll tick. Unlike
  // `frontend:open-panel-hint`, this message has a listener:
  // src/features/capture-ladder/use-capture-pickup.ts.
  try {
    chrome.runtime
      .sendMessage({
        __matrx: true,
        kind: CAPTURE_PICKUP_MESSAGE,
        payload: { organizationId: match.id, handoffId, url },
      })
      .catch(() => {
        // No listener is fine — the panel may be closed; the stored pointer
        // covers that case.
      });
  } catch {
    /* extension context may be closing; the stored pointer still stands */
  }

  const waitingCount = await countNeedsYou();

  return {
    ok: true,
    result: {
      organizationSwitched,
      organizationName: match.name,
      panelOpened,
      panelReason,
      waitingCount,
    },
    requestId,
  };
}
