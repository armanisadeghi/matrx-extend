/**
 * Renders a tool entry using a `ToolDisplayEntry` from the registry. Used
 * by both `ToolTimelineRow` (client tools) and `ServerToolRow` (server
 * tools); the `kind` prop affects only the outer card styling so each
 * surface keeps its existing look.
 *
 * Anything that goes wrong inside this component (missing path, unknown
 * icon, throwing field component, throwing transform) is logged and the
 * problematic field is skipped — the row never breaks the chat surface.
 * For total failure (e.g. the registry config itself is malformed), the
 * caller's `ToolDisplayBoundary` falls back to the default row.
 */

import { cn } from '@/lib/utils';
import { ChevronRight, Globe } from 'lucide-react';
import { Component, type ComponentType, type ReactNode, useState } from 'react';
import type { ToolTimelineEntry } from '../ToolTimelineRow';
import { ShimmerText } from '../BreathingOrb';
import { CopyToolButton } from './CopyToolButton';
import {
  applyTransforms,
  getByPath,
  resolveColor,
  resolveIcon,
  resolvePhase,
} from './helpers';
import { fieldComponents } from './registry-components';
import type {
  ArgsConfig,
  IconName,
  InfoSpec,
  KeyDisplay,
  Phase,
  ResultsConfig,
  ToolDisplayEntry,
} from './types';

interface Props {
  entry: ToolTimelineEntry;
  kind: 'server' | 'client';
  cfg: ToolDisplayEntry;
}

export function ConfigurableToolRow({ entry, kind, cfg }: Props) {
  const [open, setOpen] = useState(false);
  const phase = entry.phase as Phase;
  const inline = cfg.inline ?? {};
  const results = cfg.results ?? {};

  const inlineHidden = resolvePhase(inline.hidden, phase);
  if (inlineHidden) return null;

  const colorClass = resolveColor(resolvePhase(inline.color, phase), phase);
  const shouldSpin = resolvePhase(inline.spinIcon, phase) ?? phase === 'started';

  const prefix = resolvePhase(inline.prefix, phase) ?? '';
  const namePart = resolvePhase(inline.name, phase);
  const resolvedName = resolveNamePart(entry, namePart);
  const displayName = resolvedName === undefined ? titleCase(entry.toolName) : resolvedName;
  const suffix = resolvePhase(inline.suffix, phase) ?? '';
  const infoText = resolveInfo(entry, resolvePhase(inline.info, phase));

  const headerSegments = [prefix, displayName, suffix].filter((s) => s && s.length > 0);
  const headerLabel = headerSegments.join(' ');
  const shimmer = phase === 'started' && (inline.shimmerOnRunning ?? true);

  const alwaysShowResults =
    phase === 'completed' &&
    results.alwaysShow === true &&
    !resolvePhase(results.hidden, phase) &&
    entry.output != null;

  return (
    <div className="group rounded py-0.5 pr-1 text-xs hover:bg-muted/40">
      <div className="flex w-full items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-1.5 text-left"
          aria-expanded={open}
        >
          {kind === 'server' && (
            <ChevronRight
              className={`size-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
            />
          )}
          <InlineIcon
            entry={entry}
            phase={phase}
            value={resolvePhase(inline.icon, phase)}
            colorClass={colorClass}
            spin={shouldSpin}
          />
          {headerLabel && (
            <span className={cn('truncate text-foreground', shimmer && 'min-w-0')}>
              {shimmer ? <ShimmerText>{headerLabel}</ShimmerText> : headerLabel}
            </span>
          )}
          {infoText && (
            <span
              className={cn(
                'text-muted-foreground',
                inline.isMultiline ? 'whitespace-pre-wrap' : 'truncate',
              )}
            >
              {infoText}
            </span>
          )}
          {phase !== 'started' && entry.endedAt && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {Math.max(1, entry.endedAt - entry.startedAt)}ms
            </span>
          )}
        </button>
        <CopyToolButton
          data={{
            toolName: entry.toolName,
            args: entry.args,
            result: entry.output,
            message: entry.message,
            phase,
            startedAt: entry.startedAt,
            endedAt: entry.endedAt,
            callId: entry.callId,
          }}
        />
      </div>
      {alwaysShowResults && (
        <div className="mt-1 ml-5">
          <ResultsSection result={entry.output} cfg={results} />
        </div>
      )}
      {open && (
        <ExpandedBody
          entry={entry}
          kind={kind}
          cfg={cfg}
          skipResults={alwaysShowResults}
        />
      )}
    </div>
  );
}

/**
 * Resolve an icon config to a rendered element. Supports:
 *   - lucide name string ('HandGrab', 'Camera', …)
 *   - URL string (http(s):// or data:) → renders as <img>
 *   - InfoSpec → resolved against the entry; the resolved value is then
 *     either a lucide name OR a URL (auto-detected by prefix).
 *   - undefined → phase-default lucide icon
 *
 * Image load failures fall back to the phase-default lucide icon (or Globe
 * if we were trying for a URL — keeps the visual polish for things like
 * favicons that occasionally 404).
 */
function InlineIcon({
  entry,
  phase,
  value,
  colorClass,
  spin,
}: {
  entry: ToolTimelineEntry;
  phase: Phase;
  value: IconName | InfoSpec | undefined;
  colorClass: string;
  spin: boolean;
}) {
  const [imgErr, setImgErr] = useState(false);
  let resolved: string | undefined;
  if (typeof value === 'string') {
    resolved = value;
  } else if (value && typeof value === 'object') {
    const text = resolveInfo(entry, value);
    resolved = text || undefined;
  }
  const isUrl =
    typeof resolved === 'string' && (resolved.startsWith('http') || resolved.startsWith('data:'));
  if (isUrl && !imgErr && resolved) {
    return (
      <img
        src={resolved}
        alt=""
        className={cn('size-3.5 shrink-0 rounded-sm object-contain', colorClass)}
        onError={() => setImgErr(true)}
      />
    );
  }
  if (isUrl && imgErr) {
    return <Globe className={cn('size-3.5 shrink-0', colorClass)} />;
  }
  const LucideIcon = resolveIcon(resolved, phase);
  return <LucideIcon className={cn('size-3.5 shrink-0', colorClass, spin && 'animate-spin')} />;
}

function ExpandedBody({
  entry,
  cfg,
  skipResults = false,
}: Props & { skipResults?: boolean }) {
  const phase = entry.phase as Phase;
  const args = cfg.args ?? {};
  const results = cfg.results ?? {};
  const argsHidden = resolvePhase(args.hidden, phase);
  const resultsHidden = resolvePhase(results.hidden, phase);

  const showArgs = !argsHidden && entry.args != null;
  const showResults =
    !skipResults && !resultsHidden && phase === 'completed' && entry.output != null;
  const showError = phase === 'error' && entry.message;

  if (!showArgs && !showResults && !showError) return null;

  return (
    <div className="mt-1 ml-5 space-y-1.5">
      {showArgs && <ArgsSection args={entry.args} cfg={args} />}
      {showResults && <ResultsSection result={entry.output} cfg={results} />}
      {showError && (
        <SectionLabel label="error">
          <pre className={preClass}>{entry.message}</pre>
        </SectionLabel>
      )}
    </div>
  );
}

const preClass =
  'mt-0.5 max-h-48 overflow-auto rounded-md bg-background/60 p-1.5 text-[11px] leading-snug';

function SectionLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function ArgsSection({ args, cfg }: { args: unknown; cfg: ArgsConfig }) {
  const displayType = cfg.displayType ?? 'json';
  return (
    <SectionLabel label="args">
      {renderStandardDisplay(args, displayType)}
    </SectionLabel>
  );
}

function ResultsSection({ result, cfg }: { result: unknown; cfg: ResultsConfig }) {
  const displayType = cfg.displayType ?? 'json';
  if (displayType === 'custom') {
    return (
      <SectionLabel label="result">
        <CustomResults result={result} keysInfo={cfg.keysInfo ?? []} />
      </SectionLabel>
    );
  }
  return (
    <SectionLabel label="result">
      {renderStandardDisplay(result, displayType)}
    </SectionLabel>
  );
}

function renderStandardDisplay(
  value: unknown,
  displayType: 'json' | 'key-value' | 'values-only',
): ReactNode {
  if (displayType === 'key-value' || displayType === 'values-only') {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      // Non-object payloads can't be rendered as key/value — fall back to JSON.
      return <pre className={preClass}>{safeStringify(value)}</pre>;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return null;
    if (displayType === 'values-only') {
      return (
        <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[11px] text-foreground">
          {entries.map(([k, v]) => (
            <li key={k}>{stringifyValue(v)}</li>
          ))}
        </ul>
      );
    }
    return (
      <div className="mt-0.5 grid grid-cols-[minmax(0,auto)_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        {entries.map(([k, v]) => (
          <FieldRow key={k} k={k} v={v} />
        ))}
      </div>
    );
  }
  return <pre className={preClass}>{safeStringify(value)}</pre>;
}

function FieldRow({ k, v }: { k: string; v: unknown }) {
  return (
    <>
      <span className="font-medium text-muted-foreground">{k}</span>
      <span className="min-w-0 truncate text-foreground">{stringifyValue(v)}</span>
    </>
  );
}

function CustomResults({ result, keysInfo }: { result: unknown; keysInfo: KeyDisplay[] }) {
  if (result == null || typeof result !== 'object') return null;
  return (
    <div className="mt-0.5 space-y-1.5">
      {keysInfo.map((info, i) => (
        <CustomResultField key={`${info.key}-${i}`} result={result as Record<string, unknown>} info={info} />
      ))}
    </div>
  );
}

function CustomResultField({
  result,
  info,
}: {
  result: Record<string, unknown>;
  info: KeyDisplay;
}) {
  const FieldComponent = fieldComponents[info.component] as
    | ComponentType<{ value: unknown; className?: string }>
    | undefined;
  if (!FieldComponent) {
    console.warn(`[tool-display] unknown field component: "${info.component}"`);
    return null;
  }
  const raw =
    !info.key || info.key === '*'
      ? result
      : info.key.includes('.')
        ? lookupShallow(result, info.key)
        : result[info.key];
  if (raw == null || raw === '') {
    if (info.fallback) {
      return <FieldComponent value={info.fallback} className={info.className} />;
    }
    console.warn(`[tool-display] missing key "${info.key}" in result`, { result });
    return null;
  }
  const value = applyTransforms(raw, info.transform ?? null);
  try {
    return <FieldComponent value={value} className={info.className} />;
  } catch (err) {
    console.warn(`[tool-display] field component "${info.component}" threw:`, err, { info, value });
    return null;
  }
}

function lookupShallow(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let cursor: unknown = obj;
  for (const seg of segments) {
    if (cursor == null) return undefined;
    if (Array.isArray(cursor)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx)) return undefined;
      cursor = cursor[idx];
    } else if (typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cursor;
}

function safeStringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function stringifyValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function titleCase(name: string): string {
  return name
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((p) => (p[0] ? p[0].toUpperCase() + p.slice(1) : p))
    .join(' ');
}

/**
 * `name` accepts a literal string OR an `InfoSpec`. A literal '' suppresses
 * the auto title-case; a missing/empty `InfoSpec` resolution does the same.
 * Returns undefined to mean "fall back to titleCase(toolName)".
 */
function resolveNamePart(
  entry: ToolTimelineEntry,
  value: string | InfoSpec | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  return resolveInfo(entry, value);
}

function resolveInfo(entry: ToolTimelineEntry, info: string | InfoSpec | undefined): string {
  if (!info) return '';
  const spec: InfoSpec = typeof info === 'string' ? { path: info } : info;
  const raw = getByPath(entry, spec.path);
  if (raw == null || raw === '') {
    return spec.fallback ?? '';
  }
  const transformed = applyTransforms(raw, spec.transform ?? null);
  if (transformed == null || transformed === '') return spec.fallback ?? '';
  if (typeof transformed === 'string') return transformed;
  if (typeof transformed === 'number' || typeof transformed === 'boolean') return String(transformed);
  try {
    return JSON.stringify(transformed);
  } catch {
    return String(transformed);
  }
}

/**
 * React error boundary that catches anything thrown deeper in the
 * configurable render and falls back to a passed-in default row.
 * Class component is the only React mechanism that catches render errors.
 */
interface BoundaryProps {
  toolName: string;
  fallback: ReactNode;
  children: ReactNode;
}
interface BoundaryState {
  errored: boolean;
}
export class ToolDisplayBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { errored: false };
  static getDerivedStateFromError(): BoundaryState {
    return { errored: true };
  }
  override componentDidCatch(error: Error, info: unknown) {
    console.warn(`[tool-display] custom render threw for "${this.props.toolName}":`, error, info);
  }
  override render() {
    if (this.state.errored) return this.props.fallback;
    return this.props.children;
  }
}
