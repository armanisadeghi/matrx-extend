/**
 * Agent variable input panel — renders inputs for every variable the
 * selected agent declares in its `variable_definitions`. Values persist
 * across reloads, scoped per agent.
 *
 * Sits between the chat header and the messages area. Collapses to a
 * single-row chip strip when filled, so it doesn't dominate the surface.
 */

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AgentVariableDef } from '@/hooks/use-agent-execution';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/state/chat';
import { ChevronDown, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

export function AgentVariablesPanel({
  agentId,
  defs,
}: {
  agentId: string;
  defs: AgentVariableDef[];
}) {
  const setVariable = useChatStore((s) => s.setVariable);
  const variableValues = useChatStore((s) => s.variableValues);
  const [open, setOpen] = useState(false);

  // Apply defaults the first time we see this agent's vars.
  useEffect(() => {
    if (defs.length === 0) return;
    const prefix = `${agentId}.`;
    const seen = new Set(
      Object.keys(variableValues)
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length)),
    );
    for (const def of defs) {
      if (!seen.has(def.name) && def.defaultValue !== undefined) {
        setVariable(agentId, def.name, def.defaultValue);
      }
    }
    // intentionally only on agentId/defs — variableValues writes would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, defs]);

  const values = useMemo(() => {
    const prefix = `${agentId}.`;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(variableValues)) {
      if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
    }
    return out;
  }, [agentId, variableValues]);

  if (defs.length === 0) return null;

  const filled = defs.filter((d) => (values[d.name] ?? '').trim().length > 0).length;

  return (
    <div className="flex shrink-0 items-center gap-2 px-3 pb-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full bg-secondary/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary',
              filled === defs.length && 'text-foreground',
            )}
          >
            <Settings2 className="size-3" />
            Variables
            <span className="rounded-full bg-background/80 px-1.5 text-[10px] tabular-nums">
              {filled}/{defs.length}
            </span>
            <ChevronDown className="size-3 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <div className="flex items-baseline justify-between border-b px-3 py-2">
            <span className="text-xs font-medium">Variables</span>
            <span className="text-[10px] text-muted-foreground">Saved per agent</span>
          </div>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto p-3">
            {defs.map((def) => (
              <VariableField
                key={def.name}
                def={def}
                value={values[def.name] ?? ''}
                onChange={(v) => setVariable(agentId, def.name, v)}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function VariableField({
  def,
  value,
  onChange,
}: {
  def: AgentVariableDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const label = def.label || humanizeKey(def.name);
  const isMultiline = def.type === 'text' || def.type === 'textarea' || value.length > 80;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs">
          {label}
          {def.required && <span className="ml-1 text-destructive">*</span>}
        </Label>
        <span className="font-mono text-[9px] text-muted-foreground/70">{def.name}</span>
      </div>
      {def.description && (
        <div className="text-[10px] leading-snug text-muted-foreground">{def.description}</div>
      )}
      {isMultiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.defaultValue ?? ''}
          rows={3}
          className="w-full resize-y rounded-md border-0 bg-secondary/40 px-2.5 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.defaultValue ?? ''}
          className="h-7 rounded-md border-0 bg-secondary/40 text-xs focus-visible:ring-1"
        />
      )}
    </div>
  );
}

function humanizeKey(s: string): string {
  return s
    .split(/[_\s-]+/)
    .map((p) => (p.length === 0 ? p : p[0]?.toUpperCase() + p.slice(1)))
    .join(' ');
}
