/**
 * Per-domain memory — Skyvern's moat in miniature.
 *
 * Stored in chrome.storage.local under a single key `matrx.domain_memos`
 * mapping `domain → { notes: [...], hints: { ... }, last_updated }`. Each
 * note is a free-form string the agent has chosen to remember about the
 * domain ("PO submit button is the third primary"; "DOB format is
 * MM/DD/YYYY here"). Hints are key/value pairs for structured signals.
 *
 * Surfaced as the `domain_memo` context key when one exists for the
 * current page's domain. Written via the `remember_for_domain` tool.
 *
 * Why two shapes (notes + hints):
 *   - notes are language: anything the agent learns and wants to remember
 *   - hints are structured: useful for templating, deterministic lookup
 */

import { log } from '@/lib/debug/log';

const STORAGE_KEY = 'matrx.domain_memos';

export interface DomainMemo {
  domain: string;
  notes: string[];
  hints: Record<string, string>;
  last_updated: string; // ISO
}

type MemoStore = Record<string, DomainMemo>;

function memoMatchesDomain(memoDomain: string, currentDomain: string): boolean {
  // Exact match OR memo is a parent (e.g., memo for "atlassian.net" matches "foo.atlassian.net").
  if (memoDomain === currentDomain) return true;
  if (currentDomain.endsWith(`.${memoDomain}`)) return true;
  return false;
}

async function loadStore(): Promise<MemoStore> {
  try {
    const r = await chrome.storage.local.get([STORAGE_KEY]);
    const v = r[STORAGE_KEY];
    return (v as MemoStore | undefined) ?? {};
  } catch {
    return {};
  }
}

async function saveStore(store: MemoStore): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: store });
}

/**
 * Read-side: returns the memo for the current page's domain, including
 * any parent-domain memo (so a memo on "atlassian.net" applies on
 * `foo.atlassian.net` automatically). Returns null when nothing relevant
 * exists for this domain.
 */
export async function getDomainMemoForUrl(url: string): Promise<DomainMemo | null> {
  let domain = '';
  try {
    domain = new URL(url).hostname;
  } catch {
    return null;
  }
  if (!domain) return null;

  const store = await loadStore();
  // Prefer the most-specific match (longest matching domain string).
  const matches = Object.values(store)
    .filter((m) => memoMatchesDomain(m.domain, domain))
    .sort((a, b) => b.domain.length - a.domain.length);
  return matches[0] ?? null;
}

/** Write-side primitive used by the `remember_for_domain` tool. */
export async function rememberForDomain(args: {
  domain: string;
  note?: string;
  hints?: Record<string, string>;
}): Promise<DomainMemo> {
  const store = await loadStore();
  const existing = store[args.domain] ?? {
    domain: args.domain,
    notes: [],
    hints: {},
    last_updated: new Date().toISOString(),
  };
  if (args.note) {
    // Dedup against existing notes — agents tend to re-state things.
    if (!existing.notes.includes(args.note)) {
      existing.notes.push(args.note);
    }
    // Cap notes — keep most recent 50 to avoid unbounded growth.
    if (existing.notes.length > 50) {
      existing.notes = existing.notes.slice(-50);
    }
  }
  if (args.hints) {
    existing.hints = { ...existing.hints, ...args.hints };
  }
  existing.last_updated = new Date().toISOString();
  store[args.domain] = existing;
  await saveStore(store);
  log.info('sys', `domain memo updated for ${args.domain}`, {
    notes: existing.notes.length,
    hints: Object.keys(existing.hints).length,
  });
  return existing;
}

/** Forget primitive — used by users via the Memory tab in future, or by
 *  the agent if it learns a memo was wrong. */
export async function forgetDomainMemo(domain: string): Promise<void> {
  const store = await loadStore();
  if (store[domain]) {
    delete store[domain];
    await saveStore(store);
    log.info('sys', `domain memo cleared for ${domain}`);
  }
}

/** Listing — for future Debug-tab introspection. */
export async function listDomainMemos(): Promise<DomainMemo[]> {
  const store = await loadStore();
  return Object.values(store);
}
