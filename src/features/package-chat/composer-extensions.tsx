/**
 * What the extension adds around the package chat's composer (package mode only): the highlight
 * attachment source and the per-conversation task panel. Each is the extension's
 * own existing component — nothing is copied; the package draws nothing for a source or companion
 * the host did not register (`@ai-matrx/chat/host/composer-extensions`).
 *
 * The payload is the SAME context key the extension's own send path builds
 * (`lib/chat/attached-context`): `highlights` (one bundled key). There is no always-on Google
 * "Files" chip (Arman, 2026-10-25): Google files reach a chat through the platform's own
 * connections and context, not a pill on every composer.
 */

import { HighlightAttachmentChip } from '@/features/chat/HighlightAttachmentChip';
import { highlightsContextValue, resolveAttachedHighlights } from '@/lib/chat/attached-context';
import { useListsStore, useListsSubscriber } from '@/state/lists';
import {
  registerComposerAttachmentSource,
  registerConversationCompanion,
} from '@ai-matrx/chat/host/composer-extensions';
import { ListChecks } from 'lucide-react';
import { Suspense, lazy } from 'react';

// The task panel is the heaviest piece here and only matters once opened.
const TaskPanel = lazy(() =>
  import('@/features/lists/TaskPanel').then((m) => ({ default: m.TaskPanel })),
);

/** Idempotent: the package replaces a registration with the same id. */
export function registerExtensionComposerExtensions(): void {
  registerComposerAttachmentSource({
    id: 'highlights',
    Chip: () => <HighlightAttachmentChip inline />,
    contribute: async () => {
      const items = await resolveAttachedHighlights();
      return items ? { highlights: highlightsContextValue(items) } : null;
    },
  });

  registerConversationCompanion({
    id: 'tasks',
    label: 'Plan, tasks and todos',
    word: 'Todos',
    icon: ListChecks,
    // Keeps the lists store following this conversation; the pill appears once there is something in it.
    usePill: (conversationId) => {
      useListsSubscriber(conversationId);
      const plan = useListsStore((s) => s.plan);
      const tasks = useListsStore((s) => s.tasks);
      const userTodos = useListsStore((s) => s.user_todos);
      const openTodos = userTodos.filter((t) => !t.done).length;
      if (!plan && tasks.length === 0 && openTodos === 0) return { hidden: true };
      const done = tasks.filter((t) => t.status === 'done').length;
      return {
        detail:
          tasks.length > 0
            ? `${done}/${tasks.length}${openTodos > 0 ? ` · ${openTodos}` : ''}`
            : `${openTodos} todo${openTodos === 1 ? '' : 's'}`,
      };
    },
    Panel: ({ conversationId, open, onClose }) =>
      open ? (
        <Suspense fallback={null}>
          <TaskPanel conversationId={conversationId} open onClose={onClose} />
        </Suspense>
      ) : null,
  });
}
