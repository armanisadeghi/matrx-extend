/**
 * The extension's own tool rows, registered into `@ai-matrx/chat`'s renderer
 * registry for the package chat: `sleep` (live countdown) and `chrome_batch`
 * (one native row per sub-call). Both render through the extension's
 * ToolTimelineRow, so its signed-run receipt dialog comes with them.
 */

import { ToolTimelineRow, type ToolTimelineEntry } from '@/features/chat/ToolTimelineRow';
import type { ToolLifecycleEntry } from '@ai-matrx/chat/agents/types/request.types';
import { registerToolRenderer } from '@ai-matrx/chat/tool-call-visualization/registry/registry';
import type { ToolRendererProps } from '@ai-matrx/chat/tool-call-visualization/types';
import { Hourglass, Layers } from 'lucide-react';

/** The package's lifecycle view in the shape the extension's rows read. */
export function toTimelineEntry(entry: ToolLifecycleEntry): ToolTimelineEntry {
  const phase: ToolTimelineEntry['phase'] =
    entry.status === 'completed' ? 'completed' : entry.status === 'error' ? 'error' : 'started';
  const ended = entry.completedAt ? Date.parse(entry.completedAt) : undefined;
  const message = entry.errorMessage ?? entry.latestMessage ?? undefined;
  return {
    callId: entry.callId,
    toolName: entry.toolName.replace(/^matrx-extend:/, ''),
    startedAt: Date.parse(entry.startedAt),
    phase,
    args: entry.arguments,
    output: entry.result ?? undefined,
    ...(ended !== undefined && { endedAt: ended }),
    ...(message !== undefined && { message }),
  };
}

function ExtensionToolRow({ entry }: ToolRendererProps) {
  return <ToolTimelineRow entry={toTimelineEntry(entry)} />;
}

const EXTENSION_ROWS = [
  { name: 'sleep', displayName: 'Sleep', icon: Hourglass },
  { name: 'chrome_batch', displayName: 'Batch', icon: Layers },
] as const;

let registered = false;
/** Register once per page; the server may name a call with or without the executor prefix. */
export function registerExtensionToolRenderers(): void {
  if (registered) return;
  registered = true;
  for (const row of EXTENSION_ROWS) {
    for (const toolName of [row.name, `matrx-extend:${row.name}`]) {
      registerToolRenderer(toolName, {
        toolName,
        displayName: row.displayName,
        icon: row.icon,
        chrome: 'card',
        InlineComponent: ExtensionToolRow,
      });
    }
  }
}
