/**
 * NotesView — placeholder.
 *
 * The Notes tab is intended for free-form per-user notes (separate from
 * the per-domain `guidance` notes which are agent-facing). Wiring TBD;
 * this stub keeps the App.tsx import valid so the build succeeds while
 * the feature is being designed.
 */

import { StickyNote } from 'lucide-react';

export function NotesView() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
      <StickyNote className="size-6" />
      <p className="text-sm font-medium">Notes</p>
      <p className="max-w-xs text-xs">
        Personal notes coming soon. For per-domain notes the agent should see, use the Guidance tab.
      </p>
    </div>
  );
}
