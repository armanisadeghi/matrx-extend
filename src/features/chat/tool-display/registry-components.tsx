/**
 * Field components used by `results.keysInfo` (and reusable for any future
 * config that names a component to render a single value). Each one accepts
 * `{ value: unknown; className?: string }` and is responsible for coercing
 * the value into something renderable. Anything weird (null, object) should
 * render as empty / a JSON dump rather than throw.
 */

import { MarkdownView } from '@/components/MarkdownView';
import { cn } from '@/lib/utils';
import { Globe } from 'lucide-react';
import { useState } from 'react';
import type { ComponentType } from 'react';
import type { FieldComponentName } from './types';

interface FieldProps {
  value: unknown;
  className?: string;
}

function safeJson(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const BoldLabel = ({ value, className }: FieldProps) => (
  <div className={cn('text-[12px] font-semibold', className)}>{String(value ?? '')}</div>
);

const TextDisplay = ({ value, className }: FieldProps) => (
  <div className={cn('text-[12px]', className)}>{String(value ?? '')}</div>
);

const Markdown = ({ value, className }: FieldProps) => {
  // Objects/arrays aren't markdown — render a JSON dump so the user sees
  // the actual payload instead of "[object Object]". Strings (including
  // numbers coerced via String) flow through MarkdownView as before.
  if (value != null && typeof value === 'object') {
    return (
      <pre
        className={cn(
          'max-h-96 overflow-auto rounded-md bg-background/60 p-1.5 text-[11px] leading-snug whitespace-pre-wrap',
          className,
        )}
      >
        {safeJson(value)}
      </pre>
    );
  }
  return (
    <div className={className}>
      <MarkdownView content={String(value ?? '')} density="compact" />
    </div>
  );
};

const Code = ({ value, className }: FieldProps) => (
  <pre
    className={cn(
      'max-h-48 overflow-auto rounded-md bg-background/60 p-1.5 text-[11px] leading-snug',
      className,
    )}
  >
    {String(value ?? '')}
  </pre>
);

const Json = ({ value, className }: FieldProps) => (
  <pre
    className={cn(
      'max-h-48 overflow-auto rounded-md bg-background/60 p-1.5 text-[11px] leading-snug',
      className,
    )}
  >
    {safeJson(value)}
  </pre>
);

const Image = ({ value, className }: FieldProps) => {
  const src = typeof value === 'string' ? value : '';
  if (!src) return null;
  return <img src={src} className={cn('max-w-full rounded-md', className)} alt="" />;
};

/**
 * Renders a base64-encoded image. Accepts:
 *   - a `data:image/...;base64,...` URI string (used as-is)
 *   - a raw base64 string (rendered with a `data:image/png;base64,` prefix)
 *   - an object like `{ image_base64, media_type, width?, height?, byte_length? }`
 *     (the take_screenshot result shape — assembles the data URI and shows a caption)
 */
const Base64Image = ({ value, className }: FieldProps) => {
  const src = toDataUri(value);
  if (!src) return null;
  const meta = imageMeta(value);
  return (
    <div className={cn('space-y-1', className)}>
      <img
        src={src}
        alt=""
        className="max-h-[28rem] w-full rounded-md border border-border/40 object-contain"
      />
      {meta && <div className="text-[10px] text-muted-foreground">{meta}</div>}
    </div>
  );
};

function toDataUri(value: unknown): string {
  if (typeof value === 'string') {
    if (value.startsWith('http://') || value.startsWith('https://')) return value;
    return value.startsWith('data:') ? value : `data:image/png;base64,${value}`;
  }
  if (value == null || typeof value !== 'object') return '';
  const obj = value as Record<string, unknown>;
  // Prefer hosted URL when the server has uploaded the screenshot — avoids
  // shipping the full base64 payload through the DOM a second time.
  const hosted = pickString(obj, ['file_url', 'url', 'image_url']);
  if (hosted && (hosted.startsWith('http://') || hosted.startsWith('https://'))) {
    return hosted;
  }
  const raw = pickString(obj, ['image_base64', 'base64', 'data', 'image']);
  if (!raw) return '';
  if (raw.startsWith('data:')) return raw;
  const mediaType =
    pickString(obj, ['media_type', 'mediaType', 'mime_type', 'mimeType']) ??
    formatToMime(pickString(obj, ['format'])) ??
    'image/png';
  return `data:${mediaType};base64,${raw}`;
}

function imageMeta(value: unknown): string {
  if (value == null || typeof value !== 'object') return '';
  const obj = value as Record<string, unknown>;
  const w = obj.width ?? obj.w;
  const h = obj.height ?? obj.h;
  const bytes = obj.byte_length ?? obj.byteLength ?? obj.size;
  const parts: string[] = [];
  if (typeof w === 'number' && typeof h === 'number') parts.push(`${w}×${h}`);
  if (typeof bytes === 'number') parts.push(formatBytes(bytes));
  return parts.join(' · ');
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

function formatToMime(format: string | undefined): string | undefined {
  if (!format) return undefined;
  const f = format.toLowerCase();
  if (f === 'jpeg' || f === 'jpg') return 'image/jpeg';
  if (f === 'png') return 'image/png';
  if (f === 'webp') return 'image/webp';
  if (f === 'gif') return 'image/gif';
  return `image/${f}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const Badge = ({ value, className }: FieldProps) => (
  <span
    className={cn(
      'inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground',
      className,
    )}
  >
    {String(value ?? '')}
  </span>
);

/**
 * Renders an array of strings as small pill chips. Non-array values are
 * rendered as a single chip with their string form. Empty array → null.
 */
const Chips = ({ value, className }: FieldProps) => {
  const items = Array.isArray(value)
    ? value.map((v) => (v == null ? '' : String(v))).filter(Boolean)
    : value == null
      ? []
      : [String(value)];
  if (items.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {items.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className="inline-flex rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground"
        >
          {item}
        </span>
      ))}
    </div>
  );
};

/**
 * Beautiful card for an active-tab record: favicon + title + URL.
 * Accepts the whole tab object (use with `key: ''`). Reads `fav_icon_url`,
 * `title`, and `url` keys; tolerates camelCase variants too.
 */
const TabCard = ({ value, className }: FieldProps) => {
  if (value == null || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const title = pickString(obj, ['title']) ?? '';
  const url = pickString(obj, ['url']) ?? '';
  const favicon = pickString(obj, ['fav_icon_url', 'favIconUrl', 'favicon']);
  const [faviconErr, setFaviconErr] = useState(false);
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border border-border/40 bg-background/40 p-2',
        className,
      )}
    >
      {favicon && !faviconErr ? (
        <img
          src={favicon}
          alt=""
          className="size-5 shrink-0 rounded-sm object-contain"
          onError={() => setFaviconErr(true)}
        />
      ) : (
        <Globe className="size-5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <div className="truncate text-[12px] font-medium text-foreground">{title}</div>}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="block truncate text-[10px] text-muted-foreground hover:text-foreground hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {url}
          </a>
        )}
      </div>
    </div>
  );
};

/**
 * Renders the `extract_table` result shape as an actual HTML table.
 * Accepts the whole result (use `key: ''`). Reads `columns[].path` for
 * headers and `rows[].cells[].value` for cells. Skips fully-empty columns
 * (path empty AND no row has a value there) so checkbox/drag-handle
 * columns don't waste space.
 */
const Table = ({ value, className }: FieldProps) => {
  if (value == null || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const columns = Array.isArray(obj.columns)
    ? (obj.columns as Array<{ index: number; path?: string[] }>)
    : [];
  const rows = Array.isArray(obj.rows)
    ? (obj.rows as Array<{ cells: Array<{ value: unknown; is_header?: boolean }>; index: number }>)
    : [];
  if (columns.length === 0 || rows.length === 0) return null;

  const visibleCols = columns.filter((c) => {
    if (c.path && c.path.length > 0) return true;
    return rows.some((r) => {
      const cell = r.cells?.[c.index];
      const v = cell?.value;
      return typeof v === 'string' ? v.trim().length > 0 : v != null;
    });
  });
  if (visibleCols.length === 0) return null;

  return (
    <div
      className={cn('overflow-auto rounded-md border border-border/40 bg-background/40', className)}
    >
      <table className="w-full border-collapse text-[11px]">
        <thead className="bg-muted/40">
          <tr>
            {visibleCols.map((c) => (
              <th
                key={c.index}
                className="border-b border-border/40 px-2 py-1 text-left font-medium text-muted-foreground"
              >
                {(c.path ?? []).join(' › ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r.index ?? ri} className="border-t border-border/20 hover:bg-muted/30">
              {visibleCols.map((c) => {
                const cell = r.cells?.[c.index];
                return (
                  <td
                    key={c.index}
                    className="max-w-[20rem] truncate px-2 py-1 align-top text-foreground"
                    title={typeof cell?.value === 'string' ? cell.value : undefined}
                  >
                    {typeof cell?.value === 'string'
                      ? cell.value
                      : cell?.value == null
                        ? ''
                        : String(cell.value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {obj.truncated === true && (
        <div className="border-t border-border/30 bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
          Table was truncated
        </div>
      )}
    </div>
  );
};

export const fieldComponents: Record<FieldComponentName, ComponentType<FieldProps>> = {
  BoldLabel,
  TextDisplay,
  Markdown,
  Code,
  Json,
  Image,
  Base64Image,
  Badge,
  Chips,
  TabCard,
  Table,
};
