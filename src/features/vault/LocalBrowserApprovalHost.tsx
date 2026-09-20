import { AgentApprovalCard } from '@/features/chat/AgentApprovalCard';
import type { LocalBrowserApprovalRequest } from '@/lib/desktop/local-browser/approvals';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type { PendingConfirmRequest } from '@/lib/tools/types';
import { useLocalBrowserApprovals } from '@/state/local-browser-approvals';
import { useEffect, useRef } from 'react';

export function LocalBrowserApprovalHost({ signedIn }: { signedIn: boolean }) {
  const approvals = useLocalBrowserApprovals((s) => s.approvals);
  const show = useLocalBrowserApprovals((s) => s.show);
  const remove = useLocalBrowserApprovals((s) => s.remove);
  const clear = useLocalBrowserApprovals((s) => s.clear);
  const displayed = useRef<string[]>([]);
  displayed.current = Object.keys(approvals);
  useEffect(() => {
    if (!signedIn) {
      clear();
      return;
    }
    const offRequest = on<LocalBrowserApprovalRequest, { ack: true }>(
      CHANNELS.LOCAL_BROWSER_APPROVAL_REQUEST,
      (request) => {
        if (Date.now() >= request.deadlineMs) return { ack: true };
        show(request);
        return { ack: true };
      },
    );
    const offCancel = on<{ approvalContextId: string }, { ack: true }>(
      CHANNELS.LOCAL_BROWSER_APPROVAL_CANCEL,
      ({ approvalContextId }) => {
        remove(approvalContextId);
        return { ack: true };
      },
    );
    return () => {
      offRequest();
      offCancel();
      for (const id of displayed.current)
        broadcast(CHANNELS.LOCAL_BROWSER_APPROVAL_VIEW_CLOSED, { approvalContextId: id });
    };
  }, [signedIn, show, remove, clear]);
  useEffect(() => {
    const timers = Object.values(approvals).map((approval) =>
      setTimeout(
        () => remove(approval.approvalContextId),
        Math.max(0, approval.deadlineMs - Date.now()),
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [approvals, remove]);
  if (!signedIn) return null;
  return (
    <div className="space-y-2 px-3 py-2">
      {Object.values(approvals).map((approval) => {
        const req: PendingConfirmRequest = {
          callId: approval.approvalContextId,
          toolName: `Owned browser: ${approval.operation}`,
          args: {
            ...(approval.origin && { origin: approval.origin }),
            ...(approval.fields && { fields: approval.fields }),
          },
          tier: approval.tier,
          description: 'This affects the browser tab assigned to this local session.',
        };
        return (
          <AgentApprovalCard
            key={approval.approvalContextId}
            req={req}
            suppressRemember
            onResponse={(decision) =>
              broadcast(CHANNELS.LOCAL_BROWSER_APPROVAL_RESPONSE, {
                approvalContextId: approval.approvalContextId,
                decision,
              })
            }
          />
        );
      })}
    </div>
  );
}
