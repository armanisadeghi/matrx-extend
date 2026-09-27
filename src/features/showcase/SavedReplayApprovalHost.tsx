import { AgentApprovalCard } from '@/features/chat/AgentApprovalCard';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { listPendingConfirms } from '@/lib/tools/dispatch-persist';
import type { PendingConfirmRequest } from '@/lib/tools/types';
import { useEffect, useRef, useState } from 'react';
/** Presentation of the existing approval protocol outside a chat conversation. */
export function SavedReplayApprovalHost({ signedIn }: { signedIn: boolean }) {
  const [requests, setRequests] = useState<PendingConfirmRequest[]>([]);
  const [terminalNote, setTerminalNote] = useState('');
  const current = useRef(requests);
  current.current = requests;
  useEffect(() => {
    if (!signedIn) {
      setRequests([]);
      return;
    }
    let mounted = true;
    const settled = new Set<string>();
    const off = on<PendingConfirmRequest, { ack: true }>(
      CHANNELS.TOOL_CONFIRM_REQUEST,
      (request) => {
        if (request.initiator === 'extension')
          setRequests((old) => [...old.filter((item) => item.callId !== request.callId), request]);
        return { ack: true };
      },
    );
    const expired = on<{ callId: string; reason?: string }, { ack: true }>(
      CHANNELS.TOOL_CONFIRM_EXPIRED,
      (request) => {
        settled.add(request.callId);
        if (current.current.some((item) => item.callId === request.callId))
          setTerminalNote(request.reason ?? 'Saved replay ended. Run again.');
        setRequests((old) => old.filter((item) => item.callId !== request.callId));
        return { ack: true };
      },
    );
    // Subscribe before reading storage so a reply/expiry cannot be resurrected
    // by a late hydration result. Existing pending confirmation storage is canonical.
    void listPendingConfirms().then((records) => {
      if (!mounted) return;
      const pending = records.filter(
        (record) => record.preparedOperation?.delivery === 'local' && !settled.has(record.callId),
      );
      const alive = pending.filter((record) => record.expiresAt > Date.now());
      if (pending.length !== alive.length)
        setTerminalNote('A previous saved replay approval expired. Run it again.');
      setRequests((old) => {
        const byId = new Map(old.map((request) => [request.callId, request]));
        for (const record of alive)
          if (!byId.has(record.callId))
            byId.set(record.callId, {
              callId: record.callId,
              conversationId: null,
              toolName: record.toolName,
              args: record.args,
              tier: record.effectiveTier,
              initiator: 'extension',
              ...(record.preparedOperation?.approvalPreview && {
                approvalPreview: record.preparedOperation.approvalPreview,
              }),
            });
        return [...byId.values()];
      });
    });
    return () => {
      mounted = false;
      off();
      expired();
      for (const request of current.current)
        broadcast(CHANNELS.TOOL_CONFIRM_RESPONSE, { callId: request.callId, decision: 'deny' });
    };
  }, [signedIn]);
  if (!signedIn) return null;
  return (
    <div className="space-y-2 px-3">
      {terminalNote && <p role="status">{terminalNote}</p>}
      {requests.map((request) => (
        <AgentApprovalCard
          key={request.callId}
          req={request}
          suppressRemember
          onResponse={(decision) => {
            broadcast(CHANNELS.TOOL_CONFIRM_RESPONSE, { callId: request.callId, decision });
            setRequests((old) => old.filter((item) => item.callId !== request.callId));
          }}
        />
      ))}
    </div>
  );
}
