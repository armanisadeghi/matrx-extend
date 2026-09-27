/** Scratch extraction of dispatch policy + execution, not a second dispatcher.
 * Only dispatcher-owned code constructs Boundary; no member crosses a port.
 * The approval identity is the real data_patterns call and immutable operation.
 */
import type { ToolTier } from './types';
export interface OperationIdentity {
  toolName: string;
  callId: string;
  runId: string;
  assignedTabId: number;
  snapshotKey: string;
}
export interface PreparedOperation<T> {
  identity: OperationIdentity;
  tier: ToolTier;
  /** Calls existing admin/browser/permission/Pilot checks with resolved policy. */
  checkRequirements(): Promise<void>;
  run(signal: AbortSignal): Promise<T>;
}
export interface RecoveredApproval {
  identity: OperationIdentity;
  tier: ToolTier;
  delivery: 'agent' | 'local';
  expiresAt: number;
}
export interface DispatchBoundary<T> {
  permissionMode: 'ask' | 'act';
  signal: AbortSignal;
  prepare(): Promise<PreparedOperation<T>>;
  /** Existing requestConfirmation persists the identity with real tool args.
   * Existing takePendingConfirm owns exactly-once claiming on recovery.
   */
  confirm(identity: OperationIdentity, tier: ToolTier, signal: AbortSignal): Promise<boolean>;
  recovered?: RecoveredApproval;
}
function same(a: OperationIdentity, b: OperationIdentity): boolean {
  return a.toolName === b.toolName && a.callId === b.callId && a.runId === b.runId &&
    a.assignedTabId === b.assignedTabId && a.snapshotKey === b.snapshotKey;
}
function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Saved replay was cancelled.');
}
export async function executePreparedOperation<T>(boundary: DispatchBoundary<T>): Promise<T> {
  cancelled(boundary.signal);
  const operation = await boundary.prepare();
  await operation.checkRequirements();
  cancelled(boundary.signal);
  const needsConfirm = operation.tier === 'privileged' ||
    (operation.tier === 'action' && boundary.permissionMode === 'ask');
  if (boundary.recovered) {
    const recovered = boundary.recovered;
    if (recovered.delivery === 'local') throw new Error('The replay connection ended. Run the saved recipe again.');
    if (recovered.expiresAt <= Date.now()) throw new Error('Approval timed out.');
    if (recovered.tier !== operation.tier || !same(recovered.identity, operation.identity)) {
      throw new Error('The saved recipe or source document changed since approval. Run it again.');
    }
  } else if (needsConfirm && !(await boundary.confirm(operation.identity, operation.tier, boundary.signal))) {
    throw new Error('User denied this action.');
  }
  cancelled(boundary.signal);
  // Re-read the canonical recipe, document and policy after approval latency or
  // recovery. A caller-supplied pattern kind cannot downgrade this operation.
  const current = await boundary.prepare();
  if (current.tier !== operation.tier || !same(current.identity, operation.identity)) {
    throw new Error('The saved recipe or source document changed while waiting. Run it again.');
  }
  await current.checkRequirements();
  cancelled(boundary.signal);
  return current.run(boundary.signal);
}
