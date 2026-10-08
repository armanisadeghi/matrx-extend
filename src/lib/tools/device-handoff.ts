/**
 * SW side of the package chat's `deviceTools.handOff`: delegated browser-tool calls that outlive
 * the side panel.
 *
 * The panel asks the SW to run a tool (`DEVICE_TOOL_INVOKE`) and submits the answer to the server
 * itself. If the panel closes first, that answer is lost and the call would run a second time on
 * reopen. So the panel hands its in-flight calls over on `pagehide` (`DEVICE_TOOL_HANDOFF`); the SW
 * finishes each (the run already in progress, or starts it if it never began), POSTs the result with
 * the same durable delivery the SW's own dispatcher uses (settle row, replay queue when the network
 * is down), and tells any listener a continuation is needed.
 *
 * Every call runs AT MOST once per call id: `DEVICE_TOOL_INVOKE` and a hand-off for the same id
 * share one run, however they race.
 */

import type { ClientToolResultBody } from '@/lib/api/routes/tool-results';

export interface DeviceToolRunAnswer {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface DeviceToolCallRef {
  callId: string;
  toolName: string;
  args: unknown;
}

export interface DeviceHandOffCall extends DeviceToolCallRef {
  conversationId: string;
  requestId?: string | null;
}

export interface DeviceHandOffDeps {
  /** Run the tool the way `DEVICE_TOOL_INVOKE` does. */
  run: (call: DeviceToolCallRef) => Promise<DeviceToolRunAnswer>;
  /** POST the result durably; resolves with the continuation the server asked for, if any. */
  deliver: (
    conversationId: string,
    result: ClientToolResultBody,
  ) => Promise<{
    delivered: boolean;
    continuation: { conversationId: string; userRequestId: string | null } | null;
  }>;
  /** The result could not be delivered and may be replayed later. */
  enqueue: (input: { conversationId: string; result: ClientToolResultBody }) => Promise<void>;
  continueRun: (signal: { conversationId: string; userRequestId: string | null }) => void;
  report: (message: string, detail?: unknown) => void;
}

/** callId → the one run for it. Kept for RETAIN_MS after it settles so a late duplicate joins it. */
const runs = new Map<string, Promise<DeviceToolRunAnswer>>();
const RETAIN_MS = 10 * 60 * 1000;
const handedOff = new Set<string>();

/** Run (or join the already-running) tool call for this id. */
export function runDeviceToolOnce(
  call: DeviceToolCallRef,
  run: (call: DeviceToolCallRef) => Promise<DeviceToolRunAnswer>,
): Promise<DeviceToolRunAnswer> {
  const existing = runs.get(call.callId);
  if (existing) return existing;
  const started = run(call);
  runs.set(call.callId, started);
  const forget = () => {
    setTimeout(() => {
      if (runs.get(call.callId) === started) runs.delete(call.callId);
    }, RETAIN_MS);
  };
  started.then(forget, forget);
  return started;
}

function resultBody(
  call: DeviceHandOffCall,
  answer: DeviceToolRunAnswer,
  durationMs: number,
): ClientToolResultBody {
  if (!answer.ok) {
    const message = answer.error ?? 'tool failed';
    return {
      call_id: call.callId,
      tool_name: call.toolName,
      output: { ok: false, reason: 'matrx_extend_tool_error', message },
      is_error: true,
      error_message: message,
      duration_ms: durationMs,
    };
  }
  const output =
    answer.result && typeof answer.result === 'object' && !Array.isArray(answer.result)
      ? answer.result
      : { result: answer.result ?? null };
  return {
    call_id: call.callId,
    tool_name: call.toolName,
    output,
    is_error: false,
    duration_ms: durationMs,
  };
}

/** Finish and deliver every handed-off call. Resolves when all are delivered or queued for replay. */
export async function handOffDeviceCalls(
  calls: readonly DeviceHandOffCall[],
  deps: DeviceHandOffDeps,
): Promise<{ delivered: string[]; queued: string[]; duplicates: string[] }> {
  const out = { delivered: [] as string[], queued: [] as string[], duplicates: [] as string[] };
  await Promise.all(
    calls.map(async (call) => {
      if (!call.callId || !call.toolName || !call.conversationId) return;
      if (handedOff.has(call.callId)) {
        out.duplicates.push(call.callId);
        return;
      }
      handedOff.add(call.callId);
      const startedAt = Date.now();
      let answer: DeviceToolRunAnswer;
      try {
        answer = await runDeviceToolOnce(call, deps.run);
      } catch (error) {
        answer = {
          ok: false,
          error: `Tool dispatch crashed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      const body = resultBody(call, answer, Date.now() - startedAt);
      try {
        const delivery = await deps.deliver(call.conversationId, body);
        if (delivery.delivered) out.delivered.push(call.callId);
        else
          deps.report(
            `hand-off result for ${call.toolName} was not accepted by the server`,
            call.callId,
          );
        if (delivery.continuation) deps.continueRun(delivery.continuation);
      } catch (error) {
        deps.report(`hand-off delivery for ${call.toolName} failed; queued for replay`, error);
        await deps.enqueue({ conversationId: call.conversationId, result: body });
        out.queued.push(call.callId);
      }
    }),
  );
  return out;
}

/** Tests only. */
export function resetDeviceHandoffForTests(): void {
  runs.clear();
  handedOff.clear();
}
