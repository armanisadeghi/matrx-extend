/**
 * Guidance context surfacing.
 *
 * When the user has saved guidance items for the current page's domain
 * (notes, screenshots, GIFs, demo references), this detector attaches a
 * `guidance` bundle to the chat context so the agent automatically
 * discovers them on the next visit. Mirrors the `domain_memo` pattern in
 * domain-memo.ts.
 *
 * The bundle is grouped by kind so the model can quickly orient: notes
 * are language to read, screenshots and GIFs are images to look at,
 * demos are tools to call (`replay_demo({demo_id: ...})`).
 *
 * The artifact bytes themselves live in cld_files; we surface the URL so
 * the agent can either embed in vision tools (`ai({action:'describe_image',
 * image_url: ...})`) or hand off to a downstream tool that accepts URLs.
 *
 * Returns `null` (rather than an empty object) when there's nothing to
 * surface — keeps the per-message context tight per CLAUDE.md rule #4.
 */

import { log } from '@/lib/debug/log';
import { getGuidanceItems, guidanceMatchesDomain, listAllGuidance } from '@/lib/guidance/storage';
import type {
  GuidanceDemoRef,
  GuidanceGif,
  GuidanceNote,
  GuidanceScreenshot,
} from '@/lib/guidance/types';

export interface GuidanceContextBundle {
  domain: string;
  notes: Array<{ id: string; text: string; caption?: string; updated_at: number }>;
  screenshots: Array<{
    id: string;
    url: string | null;
    annotated_url: string | null;
    caption?: string;
    width?: number;
    height?: number;
    has_annotations: boolean;
    updated_at: number;
  }>;
  gifs: Array<{
    id: string;
    url: string | null;
    caption?: string;
    duration_ms?: number;
    updated_at: number;
  }>;
  demos: Array<{
    demo_id: string;
    name: string;
    caption?: string;
    step_count: number;
    parameter_names: string[];
    updated_at: number;
  }>;
  /** Latest mtime across every item (for "is this stale?" judgement). */
  last_updated: number;
}

/**
 * Resolve the guidance bundle for a URL. Performs parent-domain matching
 * (a note saved for `atlassian.net` applies to `foo.atlassian.net`).
 */
export async function getGuidanceForUrl(url: string): Promise<GuidanceContextBundle | null> {
  let domain = '';
  try {
    domain = new URL(url).hostname;
  } catch {
    return null;
  }
  if (!domain) return null;

  const all = await listAllGuidance();
  const matches = all.filter((g) => guidanceMatchesDomain(g.domain, domain));
  if (matches.length === 0) return null;

  // Pull full records — we need text for notes, urls for media, etc.
  const items = await getGuidanceItems(matches.map((m) => m.id));
  if (items.length === 0) return null;

  const notes: GuidanceContextBundle['notes'] = [];
  const screenshots: GuidanceContextBundle['screenshots'] = [];
  const gifs: GuidanceContextBundle['gifs'] = [];
  const demos: GuidanceContextBundle['demos'] = [];
  let lastUpdated = 0;

  for (const item of items) {
    if (item.updated_at > lastUpdated) lastUpdated = item.updated_at;
    if (item.kind === 'note') {
      const n = item as GuidanceNote;
      notes.push({
        id: n.id,
        text: n.text,
        ...(n.caption !== undefined && { caption: n.caption }),
        updated_at: n.updated_at,
      });
    } else if (item.kind === 'screenshot') {
      const s = item as GuidanceScreenshot;
      screenshots.push({
        id: s.id,
        // Prefer annotated when present — the markup is part of what the
        // user wanted the agent to see.
        url: s.annotated_url ?? s.url,
        annotated_url: s.annotated_url ?? null,
        ...(s.caption !== undefined && { caption: s.caption }),
        ...(s.width !== undefined && { width: s.width }),
        ...(s.height !== undefined && { height: s.height }),
        has_annotations: s.annotated_file_id != null,
        updated_at: s.updated_at,
      });
    } else if (item.kind === 'gif') {
      const g = item as GuidanceGif;
      gifs.push({
        id: g.id,
        url: g.url,
        ...(g.caption !== undefined && { caption: g.caption }),
        ...(g.duration_ms !== undefined && { duration_ms: g.duration_ms }),
        updated_at: g.updated_at,
      });
    } else if (item.kind === 'demo_ref') {
      const d = item as GuidanceDemoRef;
      demos.push({
        demo_id: d.demo_id,
        name: d.name,
        ...(d.caption !== undefined && { caption: d.caption }),
        step_count: d.step_count,
        parameter_names: d.parameter_names,
        updated_at: d.updated_at,
      });
    }
  }

  // Pick the most-specific matching domain to label the bundle (longest match).
  const matchedDomains = Array.from(new Set(matches.map((m) => m.domain)));
  matchedDomains.sort((a, b) => b.length - a.length);
  const labelDomain = matchedDomains[0] ?? domain;

  log.info('sys', `guidance attached domain=${labelDomain}`, {
    notes: notes.length,
    screenshots: screenshots.length,
    gifs: gifs.length,
    demos: demos.length,
  });

  return {
    domain: labelDomain,
    notes,
    screenshots,
    gifs,
    demos,
    last_updated: lastUpdated,
  };
}
