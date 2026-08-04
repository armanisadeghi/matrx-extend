/**
 * Inline save dialog shown when the user stops a demo recording.
 * Collects a name + description and triggers the save flow. Sensitive
 * params are auto-detected by the recorder; the user doesn't have to
 * declare them here.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';

export function DemoSaveDialog({
  onSave,
  onDiscard,
  busy,
}: {
  onSave: (input: { name: string; description?: string | undefined }) => void;
  onDiscard: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  return (
    <div className="shrink-0 border-b border-violet-600/30 bg-violet-50/40 px-2 py-1.5 dark:bg-violet-900/10">
      <Label className="text-[11px] text-muted-foreground">Save this demo</Label>
      <div className="mt-1 flex flex-col gap-1.5">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g., 'Submit weekly expense report')"
          className="h-7 text-xs"
        />
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional: when should the agent use this demo?"
          rows={2}
          className="text-xs"
        />
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={onDiscard}
            disabled={busy}
          >
            <Trash2 className="size-3" />
            Discard
          </Button>
          <Button
            size="sm"
            variant="default"
            className="h-7 gap-1 px-2 text-xs"
            disabled={busy || !name.trim()}
            onClick={() =>
              onSave({ name: name.trim(), description: description.trim() || undefined })
            }
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
            Save demo
          </Button>
        </div>
      </div>
    </div>
  );
}
