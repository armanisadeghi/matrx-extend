/**
 * Curated, host-keyed extraction recipes. The Showcase pre-loads the recipes
 * for the active host so users can one-click-apply known-good configs.
 *
 * Add new recipes here. Each recipe declares a mode + a pre-baked config.
 * The user can then save it as a wbx_pattern (or tweak first).
 */

import { PATTERN_KINDS, type PatternKind } from '@/lib/supabase/queries';
import { getSupabase } from '@/lib/supabase/client';
import { z } from 'zod';

export interface Recipe {
  /** Unique within this file. */
  id: string;
  label: string;
  description: string;
  /** Match: any of these hosts (suffix-matched, so `www.linkedin.com` matches `linkedin.com`). */
  hosts: string[];
  /** Match: optional path glob (`/jobs/**`, `/in/**`). */
  routes?: string[];
  kind: PatternKind;
  config: Record<string, unknown>;
  /** Recipes that target a list / many rows are visually marked. */
  yieldsRows?: boolean;
}

export const RECIPES: Recipe[] = [
  // ── LinkedIn ──────────────────────────────────────────────────────────────
  {
    id: 'linkedin-jsonld-job',
    label: 'LinkedIn — JobPosting (JSON-LD)',
    description:
      'Public LinkedIn job pages embed a JobPosting JSON-LD with title, company, location, dates, salary.',
    hosts: ['linkedin.com'],
    routes: ['/jobs/view/**', '/jobs/**'],
    kind: 'json_ld',
    config: { ld_type: 'JobPosting' },
  },
  {
    id: 'linkedin-bpr-included',
    label: 'LinkedIn — Voyager hydration entities',
    description:
      'Aggregates every <code id="bpr-guid-*"> hydration block and surfaces the typed entities under `included[]`. Profiles, posts, companies.',
    hosts: ['linkedin.com'],
    kind: 'next_data',
    config: { source: 'bpr-guid', key_path: 'included' },
    yieldsRows: true,
  },

  // ── Indeed ────────────────────────────────────────────────────────────────
  {
    id: 'indeed-jsonld-job',
    label: 'Indeed — JobPosting (JSON-LD)',
    description: 'Indeed job pages emit a structured JobPosting block with all canonical fields.',
    hosts: ['indeed.com'],
    routes: ['/viewjob*', '/jobs*'],
    kind: 'json_ld',
    config: { ld_type: 'JobPosting' },
  },
  {
    id: 'indeed-initial-data',
    label: 'Indeed — window._initialData',
    description:
      'Indeed exposes page state on window._initialData (an inline JS object literal, not JSON). The Framework tab uses paren-balanced scan + safe-eval to read it. Pick the right key path from the tree.',
    hosts: ['indeed.com'],
    kind: 'next_data',
    config: { source: 'window._initialData', key_path: '' },
  },

  // ── Yelp ──────────────────────────────────────────────────────────────────
  {
    id: 'yelp-restaurant-microdata',
    label: 'Yelp — Restaurant (microdata)',
    description: 'Yelp business pages publish complete Schema.org microdata for restaurants.',
    hosts: ['yelp.com'],
    routes: ['/biz/**'],
    kind: 'microdata',
    config: { itemtype: 'Restaurant' },
  },
  {
    id: 'yelp-reviews-microdata',
    label: 'Yelp — Reviews (microdata)',
    description: 'Each review is its own Review itemscope with rating, author, date, body.',
    hosts: ['yelp.com'],
    routes: ['/biz/**'],
    kind: 'microdata',
    config: { itemtype: 'Review' },
    yieldsRows: true,
  },

  // ── Glassdoor ─────────────────────────────────────────────────────────────
  {
    id: 'glassdoor-apollo',
    label: 'Glassdoor — Apollo cache',
    description:
      'Glassdoor stores listings, reviews, salaries in an Apollo cache. Use Framework tab to navigate.',
    hosts: ['glassdoor.com'],
    kind: 'next_data',
    config: { source: 'apollo', key_path: '' },
  },

  // ── Amazon ────────────────────────────────────────────────────────────────
  {
    id: 'amazon-product-jsonld',
    label: 'Amazon — Product (JSON-LD)',
    description: 'Amazon product pages emit Product JSON-LD with name, brand, offers, ratings.',
    hosts: ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca', 'amazon.in'],
    routes: ['/dp/**', '/gp/product/**'],
    kind: 'json_ld',
    config: { ld_type: 'Product' },
  },

  // ── Hacker News ───────────────────────────────────────────────────────────
  {
    id: 'hn-frontpage',
    label: 'Hacker News — front-page stories',
    description: 'Click 1 story to seed the list-pattern picker, then click title/score/author.',
    hosts: ['news.ycombinator.com'],
    kind: 'list_pattern',
    config: {
      list_root: 'table.itemlist tbody, table#hnmain tbody',
      item_selector: 'tr.athing',
      field_paths: [
        { name: 'title', rel_selector: '.titleline > a' },
        { name: 'url', rel_selector: '.titleline > a', attr: 'href' },
      ],
    },
    yieldsRows: true,
  },

  // ── Eventbrite ────────────────────────────────────────────────────────────
  {
    id: 'eventbrite-event-jsonld',
    label: 'Eventbrite — Event (JSON-LD)',
    description: 'Public event pages emit a complete Event JSON-LD with date, venue, prices.',
    hosts: ['eventbrite.com', 'eventbrite.co.uk', 'eventbrite.ca'],
    kind: 'json_ld',
    config: { ld_type: 'Event' },
  },

  // ── GitHub ────────────────────────────────────────────────────────────────
  {
    id: 'github-readme',
    label: 'GitHub — repo metadata snapshot',
    description: 'OG/meta + repo description + language + topics.',
    hosts: ['github.com'],
    routes: ['/*/*'],
    kind: 'og_meta',
    config: {},
  },

  // ── Recipe sites ──────────────────────────────────────────────────────────
  {
    id: 'recipe-jsonld',
    label: 'Recipe — Recipe (JSON-LD)',
    description:
      'Most recipe sites (NYT Cooking, Serious Eats, Allrecipes, Bon Appetit) emit Recipe JSON-LD with ingredients, instructions, nutrition.',
    hosts: [
      'cooking.nytimes.com',
      'seriouseats.com',
      'allrecipes.com',
      'bonappetit.com',
      'foodnetwork.com',
      'epicurious.com',
    ],
    kind: 'json_ld',
    config: { ld_type: 'Recipe' },
  },
];

const hostMatches = (host: string, recipeHost: string): boolean => {
  return host === recipeHost || host.endsWith(`.${recipeHost}`);
};

const routeMatches = (path: string, glob: string): boolean => {
  const re = new RegExp(
    `^${glob
      .replace(/\*\*/g, '__DS__')
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/__DS__/g, '.*')}$`,
  );
  return re.test(path);
};

export function recipesForUrl(url: string, recipes: Recipe[] = RECIPES): Recipe[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const host = parsed.host.toLowerCase();
  const path = parsed.pathname;
  return recipes.filter((r) => {
    if (!r.hosts.some((h) => hostMatches(host, h))) return false;
    if (!r.routes || r.routes.length === 0) return true;
    return r.routes.some((g) => routeMatches(path, g));
  });
}

// ── DB-backed recipes (decision D6) ─────────────────────────────────────────
// public.wbx_recipe is the live catalog — updatable without shipping a
// release. The bundled RECIPES above is the seed and the offline fallback.

const RecipeRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().default(''),
  hosts: z.array(z.string()),
  routes: z.array(z.string()).nullable(),
  kind: z.enum(PATTERN_KINDS),
  config: z.record(z.string(), z.unknown()).default({}),
  yields_rows: z.boolean().default(false),
});

let recipeCache: { recipes: Recipe[]; fetchedAt: number } | null = null;
const RECIPE_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Live recipe catalog: DB rows when reachable, bundled list otherwise.
 * Cached for 10 minutes — recipes change rarely and the Recipes tab calls
 * this on every URL change.
 */
export async function loadRecipes(): Promise<Recipe[]> {
  if (recipeCache && Date.now() - recipeCache.fetchedAt < RECIPE_CACHE_TTL_MS) {
    return recipeCache.recipes;
  }
  try {
    const c = getSupabase();
    const { data, error } = await c
      .from('wbx_recipe')
      .select('id, label, description, hosts, routes, kind, config, yields_rows')
      .eq('is_active', true)
      .order('id');
    if (error) throw new Error(error.message);
    const rows = z.array(RecipeRowSchema).parse(data ?? []);
    if (rows.length === 0) return RECIPES; // empty table → seed not applied yet
    const recipes: Recipe[] = rows.map((r) => ({
      id: r.id,
      label: r.label,
      description: r.description,
      hosts: r.hosts,
      routes: r.routes ?? undefined,
      kind: r.kind,
      config: r.config,
      yieldsRows: r.yields_rows,
    }));
    recipeCache = { recipes, fetchedAt: Date.now() };
    return recipes;
  } catch (err) {
    console.warn('[matrx-extend] loadRecipes fell back to bundled list:', err);
    return RECIPES;
  }
}
