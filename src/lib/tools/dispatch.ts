/**
 * SW-side tool dispatcher.
 *
 * Subscribes to STREAM_CHUNK broadcasts. When a chunk is a `tool_event` with
 * `event === "tool_started"` and `tool_name` is in our registry:
 *   1. Resolve the run's conversation_id (cached from STREAM_OPENED)
 *   2. Apply permission policy:
 *        - tier 'read'      → run immediately
 *        - tier 'action'    → in 'ask' mode, broadcast TOOL_CONFIRM_REQUEST
 *                            and wait for TOOL_CONFIRM_RESPONSE; in 'act'
 *                            mode, run immediately
 *        - tier 'ask-user'  → handler internally broadcasts TOOL_ASK_USER_REQUEST
 *        - tier 'privileged' → always confirm, regardless of mode
 *   3. Run the handler
 *   4. POST result via /conversations/{id}/tool_results
 *   5. Broadcast a TOOL_TIMELINE_EVENT so the chat UI can render started/done
 */

import { postToolResults } from '@/lib/api/routes/tool-results';
import { log } from '@/lib/debug/log';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  type OptionalPermission,
  hasOptionalPermissions,
} from '@/lib/permissions/optional';
import { recordToolEvent } from '@/lib/recording/state';
import { localFromCanonical, resolveToolName, suggestSimilar } from '@/lib/tools/aliases';
import { allToolNames, lookup as lookupTool } from '@/lib/tools/registry';
import type {
  AnyToolHandler,
  ConfirmResponse,
  PendingConfirmRequest,
  ToolContext,
} from '@/lib/tools/types';

interface RunMeta {
  conversationId: string | null;
  requestId: string | null;
  /** Permission mode for this run, latched at start. */
  permissionMode: 'ask' | 'act';
  agentName: string | null;
  /** Domains allowed for the rest of THIS conversation. */
  trustedThisConversation: Set<string>;
}

const runs = new Map<string, RunMeta>();

interface DispatchOptions {
  defaultPermissionMode: () => 'ask' | 'act';
}

let started = false;

export function startToolDispatcher(opts: DispatchOptions): void {
  if (started) return;
  started = true;
  log.info('sw', 'tool dispatcher started');

  // Cache run metadata when the stream opens.
  on<
    {
      runId: string;
      conversationId: string | null;
      requestId: string | null;
      agentName?: string | null;
      permissionMode?: 'ask' | 'act';
    },
    { ack: true }
  >(CHANNELS.STREAM_OPENED, (payload) => {
    runs.set(payload.runId, {
      conversationId: payload.conversationId,
      requestId: payload.requestId,
      permissionMode: payload.permissionMode ?? opts.defaultPermissionMode(),
      agentName: payload.agentName ?? null,
      trustedThisConversation: new Set<string>(),
    });
    log.info('sw', `tool dispatcher tracking run=${payload.runId}`, payload);
    return { ack: true };
  });

  // Watch every stream chunk for tool_started events.
  on<{ runId: string; type: string; payload: unknown }, { ack: true }>(
    CHANNELS.STREAM_CHUNK,
    async (chunk) => {
      if (chunk.type !== 'event') return { ack: true };
      const evt = (chunk.payload as { eventName?: string; data?: Record<string, unknown> }) ?? {};
      if (evt.eventName !== 'tool_event') return { ack: true };
      const data = (evt.data ?? {}) as Record<string, unknown>;
      const subEvent = data.event as string | undefined;
      if (subEvent !== 'tool_started') return { ack: true };

      const callId = String(data.call_id ?? '');
      // Wire name (`tool_name`) is what the model called — possibly namespaced
      // (`matrx-extend__take_screenshot`) or bundle-aliased (`forms__fill_form`)
      // per docs/MATRX_EXTEND_MIGRATION_GUIDE.md. Canonical name
      // (`canonical_name` / `canonicalName`, when aidream Step 2 has shipped)
      // is aidream's resolved identity (`matrx-extend:take_screenshot`) and
      // is the more reliable lookup key — it has the bundle alias already
      // unwound. Prefer it; fall back to wire-name parsing otherwise.
      const wireName = String(data.tool_name ?? '');
      const canonicalNameRaw =
        (data.canonical_name as string | undefined) ??
        (data.canonicalName as string | undefined) ??
        null;
      const toolArgs = ((data.data as { arguments?: unknown })?.arguments ?? {}) as unknown;
      // After Step 2 of the redesign, canonical_name is sufficient on its
      // own — don't drop the event just because wireName is empty.
      if (!callId || (!wireName && !canonicalNameRaw)) return { ack: true };

      // Resolve to a local registry key.
      //   1. If aidream provided canonical_name, split off the local part.
      //   2. Otherwise strip namespace/bundle from the wire name and check
      //      the legacy alias map.
      let handler;
      let resolvedName: string;
      let bundle: string | null = null;
      if (canonicalNameRaw) {
        resolvedName = localFromCanonical(canonicalNameRaw);
        handler = lookupTool(resolvedName);
        // Bundle is the canonical namespace (everything before `:`).
        const colonIdx = canonicalNameRaw.indexOf(':');
        if (colonIdx > 0) bundle = canonicalNameRaw.slice(0, colonIdx);
        if (handler && wireName && wireName !== resolvedName) {
          // The wire name differs from the resolved local — this means the
          // model called us under a bundle alias (e.g. `forms__fill_form`
          // for canonical `matrx-extend:fill_form`). Log so we can track
          // bundle frequency in telemetry.
          log.info('sw', `tool canonical '${canonicalNameRaw}' (wire='${wireName}')`, { bundle });
        }
      } else {
        // Try the literal first — covers legacy bare names and our own
        // local handler keys when the wire name is already bare.
        handler = lookupTool(wireName);
        if (handler) {
          resolvedName = wireName;
        } else {
          const r = resolveToolName(wireName);
          handler = lookupTool(r.local);
          resolvedName = r.local;
          bundle = r.bundle;
          if (handler && r.local !== wireName) {
            log.info('sw', `tool alias '${wireName}' → '${r.local}'`, { bundle });
          }
        }
      }

      const meta = runs.get(chunk.runId);
      const ctx: ToolContext = {
        conversationId: meta?.conversationId ?? null,
        runId: chunk.runId,
        callId,
        agentName: meta?.agentName ?? null,
        permissionMode: meta?.permissionMode ?? 'ask',
      };

      if (!handler) {
        // Surface a structured error back to the server so the model gets a
        // useful next-turn signal. Silently passing leaves the server to
        // synthesize "Browser session not found", which the agent can't act on.
        const suggestions = suggestSimilar(wireName, allToolNames({ isAdmin: true }));
        const hint = suggestions.length
          ? ` Did you mean: ${suggestions.join(', ')}? Or call list_browser_tools to see what's available.`
          : ' Call list_browser_tools to see what is available.';
        log.warn('sw', `tool '${wireName}' not in registry`, {
          canonicalName: canonicalNameRaw,
          bundle,
          suggestions,
        });
        void postUnknownToolError(ctx, wireName, hint).catch((err) =>
          log.error('sw', `failed to post unknown-tool error for ${wireName}`, err),
        );
        return { ack: true };
      }

      // Fire-and-forget — do not block the chunk listener on this.
      void handleCall(handler, toolArgs, ctx, meta).catch((err) =>
        log.error('sw', `tool dispatch crashed for ${resolvedName}`, err),
      );
      return { ack: true };
    },
  );
}

async function postUnknownToolError(
  ctx: ToolContext,
  toolName: string,
  hint: string,
): Promise<void> {
  if (!ctx.conversationId) return;
  const message = `Tool '${toolName}' is not registered in this extension.${hint}`;
  await postToolResults(ctx.conversationId, [
    {
      call_id: ctx.callId,
      tool_name: toolName,
      output: null,
      is_error: true,
      error_message: message,
    },
  ]);
  broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
    callId: ctx.callId,
    toolName,
    phase: 'error',
    message,
  });
}

async function handleCall(
  handler: AnyToolHandler,
  rawArgs: unknown,
  ctx: ToolContext,
  meta: RunMeta | undefined,
): Promise<void> {
  log.info('sw', `tool ${handler.name} call_id=${ctx.callId}`, rawArgs);
  broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
    callId: ctx.callId,
    toolName: handler.name,
    phase: 'started',
    args: rawArgs,
  });
  recordToolEvent(handler.name, 'started', rawArgs);

  // Validate args.
  const parsed = handler.argsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return finishWithError(
      handler,
      ctx,
      `args failed schema: ${JSON.stringify(parsed.error.format())}`,
    );
  }

  // Optional-permission gate. Tools that depend on `debugger`, `cookies`, etc.
  // declare `required_optional_permissions`. If those aren't granted yet,
  // surface a structured error so the agent can ask the user to enable them.
  if (handler.required_optional_permissions?.length) {
    const granted = await hasOptionalPermissions(
      handler.required_optional_permissions as OptionalPermission[],
    );
    if (!granted) {
      return finishWithError(
        handler,
        ctx,
        `required optional permission(s) not granted: ${handler.required_optional_permissions.join(', ')}. The user must enable them in Settings → Advanced agent capabilities.`,
      );
    }
  }

  // Permission gate. Mega-tool routers (computer, tabs, …) declare a
  // `tierFor(args)` so a `screenshot` sub-action can be 'read' while
  // `left_click` stays 'action' under the same tool name.
  const effectiveTier = handler.tierFor ? handler.tierFor(parsed.data as never) : handler.tier;
  const needsConfirm =
    effectiveTier === 'privileged' || (effectiveTier === 'action' && ctx.permissionMode === 'ask');
  if (needsConfirm) {
    const allowed = await requestConfirmation(handler, parsed.data, ctx, meta);
    if (!allowed.allow) {
      return finishWithError(handler, ctx, allowed.reason ?? 'User denied this action');
    }
  }

  // Run.
  let result: unknown;
  try {
    result = await handler.run(parsed.data as never, ctx);
  } catch (err) {
    return finishWithError(handler, ctx, (err as Error)?.message ?? String(err));
  }

  await postResult(handler, ctx, result);
  broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
    callId: ctx.callId,
    toolName: handler.name,
    phase: 'completed',
    output: result,
  });
}

async function finishWithError(
  handler: AnyToolHandler,
  ctx: ToolContext,
  message: string,
): Promise<void> {
  log.error('sw', `tool ${handler.name} error`, message);
  await postResult(handler, ctx, null, true, message);
  broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
    callId: ctx.callId,
    toolName: handler.name,
    phase: 'error',
    message,
  });
}

async function postResult(
  handler: AnyToolHandler,
  ctx: ToolContext,
  output: unknown,
  isError = false,
  errorMessage: string | null = null,
): Promise<void> {
  if (!ctx.conversationId) {
    log.warn('sw', `cannot POST tool_results for ${handler.name} — no conversation_id yet`);
    return;
  }
  await postToolResults(ctx.conversationId, [
    {
      call_id: ctx.callId,
      tool_name: handler.name,
      output,
      is_error: isError,
      error_message: errorMessage,
    },
  ]);
}

interface ConfirmResult {
  allow: boolean;
  reason?: string;
}

function requestConfirmation(
  handler: AnyToolHandler,
  args: unknown,
  ctx: ToolContext,
  meta: RunMeta | undefined,
): Promise<ConfirmResult> {
  // Auto-allow if user has trusted this domain for the conversation.
  // (Domain trust is opportunistic — only meaningful if args has a `url`.)
  const url =
    typeof (args as { url?: unknown })?.url === 'string'
      ? ((args as { url?: string }).url as string)
      : null;
  if (url && meta) {
    try {
      const host = new URL(url).host;
      if (meta.trustedThisConversation.has(host)) {
        return Promise.resolve({ allow: true });
      }
    } catch {
      /* not a URL we can parse, fall through */
    }
  }

  return new Promise<ConfirmResult>((resolve) => {
    let resolved = false;
    const finish = (out: ConfirmResult) => {
      if (resolved) return;
      resolved = true;
      off();
      clearTimeout(timer);
      resolve(out);
    };
    const off = on<ConfirmResponse, { ack: true }>(CHANNELS.TOOL_CONFIRM_RESPONSE, (payload) => {
      if (payload.callId !== ctx.callId) return { ack: true };
      if (payload.decision === 'allow' && payload.rememberFor === 'conversation' && url && meta) {
        try {
          meta.trustedThisConversation.add(new URL(url).host);
        } catch {
          /* */
        }
      }
      finish({
        allow: payload.decision === 'allow',
        reason: payload.decision === 'deny' ? 'User denied this action' : undefined,
      });
      return { ack: true };
    });
    const timer = setTimeout(
      () => finish({ allow: false, reason: 'Approval timed out' }),
      5 * 60_000,
    );

    const req: PendingConfirmRequest = {
      callId: ctx.callId,
      toolName: handler.name,
      description: handler.description,
      args,
      tier: handler.tier,
    };
    broadcast(CHANNELS.TOOL_CONFIRM_REQUEST, req);
  });
}
