/**
 * Admin-only request-level overrides for `POST /ai/agent/{id}`.
 *
 * Mounts inside the Debug tab. The whole panel only renders if the user is
 * an admin; `useChatStream` also strips these fields from the body if
 * `isAdmin === false` as a defense-in-depth check, so a stale store from a
 * previous admin session can never bleed into a non-admin's request.
 *
 * State lives in `useAdminFlagsStore`, persisted to chrome.storage.session
 * (cleared on browser restart). That's the right scope: "I'm debugging this
 * morning" — the flags shouldn't outlive the browser session.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { AdminModelPicker } from '@/features/debug/AdminModelPicker';
import { cn } from '@/lib/utils';
import {
  type AdminFlagsValues,
  type MemoryScope,
  countActiveAdminFlags,
  useAdminFlagsStore,
} from '@/state/admin-flags';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { useState } from 'react';

const MEMORY_SCOPES: MemoryScope[] = ['user', 'project', 'organization', 'agent', 'conversation'];

export function AdminAgentFlagsPanel() {
  const state = useAdminFlagsStore();
  const [open, setOpen] = useState(false);
  const activeCount = countActiveAdminFlags(state);

  return (
    <div className="rounded-lg border border-amber-300/40 bg-amber-50/30 dark:border-amber-700/30 dark:bg-amber-950/15">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
        <span className="text-[11px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
          Agent request overrides (admin)
        </span>
        {activeCount > 0 && (
          <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
            {activeCount} active
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">session-only</span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-amber-300/30 px-3 pt-2 pb-3 dark:border-amber-700/20">
          <p className="text-[10px] leading-snug text-muted-foreground">
            These flags merge into every chat request. Each is unset by default — toggling adds it
            to the next outgoing body. Cleared on browser restart and stripped automatically for
            non-admin users.
          </p>

          <SectionHeader>Model</SectionHeader>
          <AdminModelPicker />

          <SectionHeader>Tracing</SectionHeader>
          <BoolRow
            label="debug"
            desc="Enable verbose debug events in the SSE stream."
            value={state.debug}
            onChange={(v) => state.set('debug', v)}
          />
          <BoolRow
            label="snapshot"
            desc="Persist a conversation snapshot at end of run."
            value={state.snapshot}
            onChange={(v) => state.set('snapshot', v)}
          />
          <BoolRow
            label="block_mode"
            desc="Render structured blocks instead of plain text."
            value={state.block_mode}
            onChange={(v) => state.set('block_mode', v)}
          />
          <BoolRow
            label="is_version"
            desc="Track this run as a versioned re-execution of an existing turn."
            value={state.is_version}
            onChange={(v) => state.set('is_version', v)}
          />
          <BoolRow
            label="allow_context_create"
            desc="Allow the server to lazily create a missing context bucket."
            value={state.allow_context_create}
            onChange={(v) => state.set('allow_context_create', v)}
          />

          <SectionHeader>Iteration limits</SectionHeader>
          <NumberRow
            label="max_iterations"
            desc="Override agent loop iteration cap."
            value={state.max_iterations}
            onChange={(v) => state.set('max_iterations', v)}
            min={1}
            max={50}
          />
          <NumberRow
            label="max_retries_per_iteration"
            desc="Override per-iteration retry cap."
            value={state.max_retries_per_iteration}
            onChange={(v) => state.set('max_retries_per_iteration', v)}
            min={0}
            max={10}
          />

          <SectionHeader>Memory</SectionHeader>
          <BoolRow
            label="memory"
            desc="Enable / disable the agent's memory layer for this run."
            value={state.memory}
            onChange={(v) => state.set('memory', v)}
          />
          <TextRow
            label="memory_model"
            desc="Override the memory model used."
            value={state.memory_model}
            onChange={(v) => state.set('memory_model', v)}
            placeholder="claude-haiku-4-5"
          />
          <SelectRow
            label="memory_scope"
            desc="Memory scope — drives where memories are written / read."
            value={state.memory_scope}
            options={MEMORY_SCOPES}
            onChange={(v) => state.set('memory_scope', v as MemoryScope | null)}
          />

          <SectionHeader>Power-user (raw JSON)</SectionHeader>
          <JsonRow
            label="cache_bypass"
            desc="Bypass model-response cache. JSON object — see CacheBypass schema."
            value={state.cache_bypass_json}
            onChange={(v) => state.set('cache_bypass_json', v)}
          />
          <JsonRow
            label="config_overrides"
            desc="LLMParams override blob. JSON object — see LLMParams schema."
            value={state.config_overrides_json}
            onChange={(v) => state.set('config_overrides_json', v)}
          />

          <div className="flex justify-end pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={state.reset}
              className="h-7 gap-1 text-[11px] text-muted-foreground"
              disabled={activeCount === 0}
            >
              <RotateCcw className="size-3" /> Reset all
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function FlagRow({
  label,
  desc,
  active,
  control,
}: {
  label: string;
  desc: string;
  active: boolean;
  control: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-md px-2 py-1.5',
        active && 'bg-amber-100/50 dark:bg-amber-900/20',
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[11px] font-medium">{label}</div>
        <div className="text-[10px] leading-snug text-muted-foreground">{desc}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function BoolRow({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <FlagRow
      label={label}
      desc={desc}
      active={value !== null}
      control={
        <div className="flex items-center gap-1">
          {value === null ? (
            <button
              type="button"
              onClick={() => onChange(true)}
              className="h-6 rounded-full bg-secondary px-2 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              unset
            </button>
          ) : (
            <>
              <Switch checked={value} onCheckedChange={onChange} />
              <button
                type="button"
                onClick={() => onChange(null)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
                title="Clear override"
              >
                ×
              </button>
            </>
          )}
        </div>
      }
    />
  );
}

function NumberRow({
  label,
  desc,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  desc: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
}) {
  return (
    <FlagRow
      label={label}
      desc={desc}
      active={value !== null}
      control={
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={min}
            max={max}
            value={value ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw.trim() === '') return onChange(null);
              const n = Number(raw);
              if (!Number.isFinite(n)) return;
              onChange(n);
            }}
            placeholder="(default)"
            className="h-7 w-20 text-xs"
          />
          {value !== null && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
              title="Clear override"
            >
              ×
            </button>
          )}
        </div>
      }
    />
  );
}

function TextRow({
  label,
  desc,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  desc: string;
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
}) {
  return (
    <FlagRow
      label={label}
      desc={desc}
      active={value !== null && value.trim() !== ''}
      control={
        <div className="flex items-center gap-1">
          <Input
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
            placeholder={placeholder ?? '(default)'}
            className="h-7 w-40 text-xs"
          />
          {value !== null && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
              title="Clear override"
            >
              ×
            </button>
          )}
        </div>
      }
    />
  );
}

function SelectRow<T extends string>({
  label,
  desc,
  value,
  options,
  onChange,
}: {
  label: string;
  desc: string;
  value: T | null;
  options: readonly T[];
  onChange: (v: T | null) => void;
}) {
  return (
    <FlagRow
      label={label}
      desc={desc}
      active={value !== null}
      control={
        <div className="flex items-center gap-1">
          <select
            value={value ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              onChange(v === '' ? null : (v as T));
            }}
            className="h-7 rounded-md border bg-background px-2 text-xs"
          >
            <option value="">(default)</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {value !== null && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
              title="Clear override"
            >
              ×
            </button>
          )}
        </div>
      }
    />
  );
}

function JsonRow({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const trimmed = (value ?? '').trim();
  let parseError: string | null = null;
  if (trimmed) {
    try {
      JSON.parse(trimmed);
    } catch (e) {
      parseError = (e as Error).message;
    }
  }
  return (
    <div
      className={cn(
        'rounded-md px-2 py-1.5',
        trimmed && !parseError && 'bg-amber-100/50 dark:bg-amber-900/20',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[11px] font-medium">{label}</div>
          <div className="text-[10px] leading-snug text-muted-foreground">{desc}</div>
        </div>
        {value !== null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
            title="Clear override"
          >
            ×
          </button>
        )}
      </div>
      <Textarea
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        placeholder='(default — leave empty)  e.g. {"strategy":"force"}'
        rows={2}
        className="mt-1 font-mono text-[10px]"
      />
      {parseError && (
        <div className="mt-0.5 text-[10px] text-red-600 dark:text-red-400">
          JSON parse error: {parseError}
        </div>
      )}
    </div>
  );
}

// Imported only to keep the module dependency-graph honest — this file is
// intentionally NOT exported from a barrel. Use directly.
export type { AdminFlagsValues };
