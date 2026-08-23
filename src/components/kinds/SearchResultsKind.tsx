/**
 * The SEARCH FAMILY — `web_search_results` (Brave), `google_search_results`,
 * `news_search_results`.
 *
 * ONE component for three kinds on purpose: at the registry level they are the
 * same shape wearing three provider vocabularies — a query plus a list of
 * (title, url, snippet). The three `kind_component` rows name this one key, so
 * the REGISTRY records three explicit decisions while the client keeps one
 * renderer. That is not a silent fallback: an unregistered search kind still
 * gets the generic floor, not this.
 *
 * Item objects are open passthroughs (`additionalProperties: true` — the Brave
 * item's docstring says so outright), so every field is read defensively and a
 * result missing a URL renders as plain text rather than a dead link.
 */

import { ExternalLink } from 'lucide-react';
import type { KindComponentProps } from './types';

interface SearchItem {
  title: string;
  url: string | null;
  snippet: string;
  meta: string;
}

function str(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * The three providers name their list differently. Read them in a fixed order
 * and take the first NON-EMPTY one — a google payload carries several lists
 * and `organic_results` is the one a human means by "the results".
 */
const LIST_KEYS = ['results', 'organic_results', 'articles', 'top_stories'] as const;

function readItems(value: unknown): { query: string; items: SearchItem[] } {
  if (typeof value !== 'object' || value === null) return { query: '', items: [] };
  const root = value as Record<string, unknown>;

  let raw: unknown[] = [];
  for (const key of LIST_KEYS) {
    const list = root[key];
    if (Array.isArray(list) && list.length > 0) {
      raw = list;
      break;
    }
  }

  const items: SearchItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const title = str(item, 'title', 'name', 'headline');
    const url = str(item, 'url', 'link', 'source_url');
    const snippet = str(item, 'description', 'snippet', 'summary', 'excerpt');
    if (!title && !url && !snippet) continue;
    items.push({
      title: title || url || 'Untitled result',
      url: url || null,
      snippet,
      meta: str(item, 'age', 'page_age', 'date', 'published_at', 'source'),
    });
  }

  return { query: str(root, 'query', 'q'), items };
}

/** Strip the scheme/www so a 400px panel shows the domain, not a truncated URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function SearchResultsKind({ value, complete }: KindComponentProps) {
  const { query, items } = readItems(value);

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-[12px] text-muted-foreground">
        {complete ? 'No results.' : 'Searching…'}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="truncate text-[12px] font-medium">{query || 'Search results'}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {items.length}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {items.map((item, i) => (
          <li key={`${item.url ?? item.title}-${i}`} className="px-3 py-2">
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer noopener"
                className="group flex items-start gap-1.5 text-[12px] font-medium text-primary hover:underline"
              >
                <span className="min-w-0 flex-1">{item.title}</span>
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
              </a>
            ) : (
              <span className="text-[12px] font-medium">{item.title}</span>
            )}
            {item.snippet && (
              <p className="mt-0.5 line-clamp-3 text-[11px] leading-snug text-muted-foreground">
                {item.snippet}
              </p>
            )}
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {item.url && <span className="truncate">{hostOf(item.url)}</span>}
              {item.meta && <span className="shrink-0">· {item.meta}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
