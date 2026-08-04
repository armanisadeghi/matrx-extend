/**
 * Scrape-queue view model — pure filter / search / sort / group + facet logic
 * for the Tasks tab. No React, no chrome.* — just data in, view out, so it's
 * unit-testable and the UI (TasksView, QueueToolbar) stays thin.
 *
 * The server returns the queue split into six buckets (four capture-level + two
 * §5 policy buckets). This flattens them into one tagged list, then lets the UI
 * filter by project / domain / status / policy / capture-level, free-text search,
 * sort, and group either by capture level (the existing ladder) or by project.
 */

import type {
  CaptureLevel,
  ExtensionScrapeItem,
  ExtensionScrapeQueue,
  PolicyCategory,
  ScrapeStatus,
} from '@/lib/api/routes/research';

export type BucketKey =
  | 'level_1_quick'
  | 'level_2_scroll'
  | 'level_3_user_gated'
  | 'level_4_paste'
  | 'gated_login'
  | 'low_value';

export interface FlatQueueItem {
  item: ExtensionScrapeItem;
  bucket: BucketKey;
  /** itemKey — `${topic_id}:${source_id}`, stable identity for selection. */
  key: string;
  /** Hostname, lowercased, leading `www.` stripped. '' when the URL won't parse. */
  domain: string;
}

export type GroupMode = 'level' | 'project';
export type SortKey = 'topic' | 'recency' | 'chars' | 'attempts' | 'domain' | 'status';
export type SortDir = 'asc' | 'desc';
export interface SortSpec {
  key: SortKey;
  dir: SortDir;
}

/** Empty array on a facet = "no filter, everything passes". */
export interface QueueFilters {
  search: string;
  topicId: string | null;
  domain: string | null;
  statuses: ScrapeStatus[];
  categories: PolicyCategory[];
  buckets: BucketKey[];
}

export const EMPTY_FILTERS: QueueFilters = {
  search: '',
  topicId: null,
  domain: null,
  statuses: [],
  categories: [],
  buckets: [],
};

export const DEFAULT_SORT: SortSpec = { key: 'topic', dir: 'asc' };

export interface QueueGroup {
  id: string;
  label: string;
  subtitle?: string | undefined;
  tone?: 'amber' | undefined;
  /** The buckets this group draws from (level mode) — drives section toggles + batch-run scope. */
  buckets: BucketKey[];
  items: FlatQueueItem[];
}

export interface QueueFacets {
  topics: { id: string; name: string; count: number }[];
  domains: { domain: string; count: number }[];
  statuses: { status: ScrapeStatus; count: number }[];
  categories: { category: PolicyCategory; count: number }[];
  total: number;
}

/** Bucket → capture level (paste = 4; the policy buckets fold onto their effective level). */
export const BUCKET_LEVEL: Record<BucketKey, CaptureLevel> = {
  level_1_quick: 1,
  level_2_scroll: 2,
  level_3_user_gated: 3,
  level_4_paste: 4,
  gated_login: 3,
  low_value: 2,
};

/**
 * Capture-level sections — the existing ladder IA. L1+L2 collapse into one
 * "Automated" section (matching today's UI + the batch-run scope); the rest are
 * one bucket each. Order = render order.
 */
export const LEVEL_SECTIONS: {
  id: string;
  label: string;
  subtitle: string;
  tone?: 'amber';
  buckets: BucketKey[];
}[] = [
  {
    id: 'automated',
    label: 'Automated',
    subtitle: 'No interaction needed — extension scrapes for you.',
    buckets: ['level_1_quick', 'level_2_scroll'],
  },
  {
    id: 'level_3_user_gated',
    label: 'Needs your help',
    subtitle:
      'The auto-scraper kept getting thin pages here. Trigger one, get the page fully loaded, then press Go — or resolve it directly.',
    tone: 'amber',
    buckets: ['level_3_user_gated'],
  },
  {
    id: 'gated_login',
    label: 'Sign in to capture',
    subtitle:
      "Login / paywall sources. Only you can capture these — as the signed-in user. Open one, make sure you're signed in, then press Go.",
    tone: 'amber',
    buckets: ['gated_login'],
  },
  {
    id: 'level_4_paste',
    label: 'Manual paste',
    subtitle:
      'Open the URL in a normal tab, copy the content, paste it here — or resolve directly if the page is gone.',
    tone: 'amber',
    buckets: ['level_4_paste'],
  },
  {
    id: 'low_value',
    label: 'Low-value',
    subtitle:
      'Rarely useful sources (nav junk, social walls). Opt in only if you know one matters — these never auto-queue or auto-batch.',
    buckets: ['low_value'],
  },
];

const ALL_BUCKETS: BucketKey[] = [
  'level_1_quick',
  'level_2_scroll',
  'level_3_user_gated',
  'level_4_paste',
  'gated_login',
  'low_value',
];

export function itemKey(it: ExtensionScrapeItem): string {
  return `${it.topic_id}:${it.source_id}`;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function flattenQueue(queue: ExtensionScrapeQueue | undefined): FlatQueueItem[] {
  if (!queue) return [];
  const out: FlatQueueItem[] = [];
  for (const bucket of ALL_BUCKETS) {
    for (const item of queue[bucket]) {
      out.push({ item, bucket, key: itemKey(item), domain: domainOf(item.url) });
    }
  }
  return out;
}

function effectiveCategory(item: ExtensionScrapeItem): PolicyCategory {
  return item.policy_category ?? 'open';
}

export function computeFacets(flat: FlatQueueItem[]): QueueFacets {
  const topics = new Map<string, { name: string; count: number }>();
  const domains = new Map<string, number>();
  const statuses = new Map<ScrapeStatus, number>();
  const categories = new Map<PolicyCategory, number>();

  for (const { item, domain } of flat) {
    const t = topics.get(item.topic_id);
    if (t) t.count++;
    else topics.set(item.topic_id, { name: item.topic_name, count: 1 });

    if (domain) domains.set(domain, (domains.get(domain) ?? 0) + 1);
    statuses.set(item.scrape_status, (statuses.get(item.scrape_status) ?? 0) + 1);
    const cat = effectiveCategory(item);
    categories.set(cat, (categories.get(cat) ?? 0) + 1);
  }

  return {
    topics: [...topics.entries()]
      .map(([id, v]) => ({ id, name: v.name, count: v.count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    domains: [...domains.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)),
    statuses: [...statuses.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    categories: [...categories.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    total: flat.length,
  };
}

export function matchesFilters(flat: FlatQueueItem, f: QueueFilters): boolean {
  const { item, domain, bucket } = flat;
  if (f.topicId && item.topic_id !== f.topicId) return false;
  if (f.domain && domain !== f.domain) return false;
  if (f.statuses.length > 0 && !f.statuses.includes(item.scrape_status)) return false;
  if (f.categories.length > 0 && !f.categories.includes(effectiveCategory(item))) return false;
  if (f.buckets.length > 0 && !f.buckets.includes(bucket)) return false;
  const q = f.search.trim().toLowerCase();
  if (q) {
    const hay = `${item.topic_name} ${item.url} ${item.title ?? ''} ${domain}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function attemptsOf(item: ExtensionScrapeItem): number {
  return item.server_attempts + (item.attempted_levels?.length ?? 0);
}

function recencyOf(item: ExtensionScrapeItem): number {
  const iso = item.last_attempt_at ?? item.last_server_attempt_at ?? null;
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? 0 : t;
}

export function sortFlat(items: FlatQueueItem[], sort: SortSpec): FlatQueueItem[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const cmp = (a: FlatQueueItem, b: FlatQueueItem): number => {
    switch (sort.key) {
      case 'topic':
        return (
          a.item.topic_name.localeCompare(b.item.topic_name) || a.domain.localeCompare(b.domain)
        );
      case 'domain':
        return a.domain.localeCompare(b.domain) || a.item.url.localeCompare(b.item.url);
      case 'chars':
        return (a.item.last_char_count ?? 0) - (b.item.last_char_count ?? 0);
      case 'attempts':
        return attemptsOf(a.item) - attemptsOf(b.item);
      case 'recency':
        return recencyOf(a.item) - recencyOf(b.item);
      case 'status':
        return a.item.scrape_status.localeCompare(b.item.scrape_status);
    }
  };
  // Stable tiebreak on key so equal sorts render deterministically.
  return [...items].sort((a, b) => cmp(a, b) * dir || a.key.localeCompare(b.key));
}

export function filterAndSort(
  flat: FlatQueueItem[],
  filters: QueueFilters,
  sort: SortSpec,
): FlatQueueItem[] {
  return sortFlat(
    flat.filter((f) => matchesFilters(f, filters)),
    sort,
  );
}

/** Group already-filtered+sorted items by project (topic). Group order follows sort. */
export function groupByProject(items: FlatQueueItem[]): QueueGroup[] {
  const groups: QueueGroup[] = [];
  const byId = new Map<string, QueueGroup>();
  for (const f of items) {
    let g = byId.get(f.item.topic_id);
    if (!g) {
      g = {
        id: f.item.topic_id,
        label: f.item.topic_name,
        buckets: [],
        items: [],
      };
      byId.set(f.item.topic_id, g);
      groups.push(g);
    }
    g.items.push(f);
  }
  return groups;
}

/** Group already-filtered+sorted items into the capture-level sections. */
export function groupByLevel(items: FlatQueueItem[]): QueueGroup[] {
  return LEVEL_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    subtitle: section.subtitle,
    tone: section.tone,
    buckets: section.buckets,
    items: items.filter((f) => section.buckets.includes(f.bucket)),
  })).filter((g) => g.items.length > 0);
}

export function buildGroups(items: FlatQueueItem[], mode: GroupMode): QueueGroup[] {
  return mode === 'project' ? groupByProject(items) : groupByLevel(items);
}

// ── Shared display labels (toolbar filters, badges, batch menu) ──────────────

export const STATUS_LABELS: Record<ScrapeStatus, string> = {
  pending: 'Pending',
  success: 'Success',
  thin: 'Thin',
  failed: 'Failed',
  manual: 'Manual',
  skipped: 'Skipped',
  complete: 'Complete',
  dead_link: 'Dead link',
  gated: 'Gated',
  ignored: 'Ignored',
  content_mismatch: 'Wrong content',
};

export const CATEGORY_LABELS: Record<PolicyCategory, string> = {
  open: 'Open',
  gated_login: 'Login required',
  low_value: 'Low-value',
  special: 'Worth it',
  blocked: 'Blocked',
};

export const BUCKET_LABELS: Record<BucketKey, string> = {
  level_1_quick: 'L1 · Quick',
  level_2_scroll: 'L2 · Scroll',
  level_3_user_gated: 'L3 · Needs help',
  level_4_paste: 'L4 · Paste',
  gated_login: 'Sign-in',
  low_value: 'Low-value',
};

/** True when any facet/search filter is active (drives the "Clear filters" affordance). */
export function hasActiveFilters(f: QueueFilters): boolean {
  return (
    f.search.trim() !== '' ||
    f.topicId !== null ||
    f.domain !== null ||
    f.statuses.length > 0 ||
    f.categories.length > 0 ||
    f.buckets.length > 0
  );
}
