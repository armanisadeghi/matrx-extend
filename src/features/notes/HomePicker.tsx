/**
 * Home picker — a simple searchable list of the person's homes (each
 * organization's General + scopes). Used to filter the list by home and to
 * move a note to another home. A home is chosen here, never created.
 */

import type { NoteHomeChoice } from '@/lib/notes/types';
import { searchHomes } from '@/lib/notes/utils';
import { BasicInput as Input } from '@ai-matrx/design-system';
import { Home } from 'lucide-react';
import { useMemo, useState } from 'react';

interface HomePickerProps {
  homes: NoteHomeChoice[];
  /** Selected home id; null = no selection (shows `placeholder`). */
  value: string | null;
  placeholder: string;
  /** Optional first row that clears the selection (e.g. "All homes"). */
  clearLabel?: string;
  disabled?: boolean;
  onChange: (homeId: string | null) => void;
}

export function HomePicker({
  homes,
  value,
  placeholder,
  clearLabel,
  disabled,
  onChange,
}: HomePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const visible = useMemo(() => searchHomes(homes, query), [homes, query]);
  const current = homes.find((h) => h.id === value)?.label ?? null;

  const choose = (id: string | null) => {
    setOpen(false);
    setQuery('');
    onChange(id);
  };

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-full items-center gap-1.5 rounded-md border border-border bg-transparent px-2 text-left text-xs disabled:opacity-50"
      >
        <Home className="size-3 shrink-0 text-muted-foreground" />
        <span className="truncate">{current ?? placeholder}</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full min-w-[200px] rounded-md border border-border bg-popover p-1 shadow-lg">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search homes"
            aria-label="Search homes"
            autoFocus
            className="mb-1 h-7 text-xs"
          />
          <ul className="max-h-56 overflow-y-auto">
            {clearLabel && (
              <li>
                <button
                  type="button"
                  onClick={() => choose(null)}
                  className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-secondary/60"
                >
                  {clearLabel}
                </button>
              </li>
            )}
            {visible.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  aria-pressed={h.id === value}
                  onClick={() => choose(h.id)}
                  className={`w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-secondary/60 ${
                    h.id === value ? 'font-semibold' : ''
                  }`}
                >
                  {h.label}
                </button>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">No matching homes</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
