-- wbx_pattern lifecycle hardening + recipes move to DB (Showcase audit batch 5).
--
-- 1. Dedupe + UNIQUE(user_id, domain, name) on wbx_pattern — double-saves and
--    cross-window races could insert identical patterns (audit M2/P1-7).
--    Client savePattern auto-suffixes "name (2)" on conflict.
-- 2. public.wbx_recipe — curated extraction recipes move out of the bundled
--    src/lib/data-pattern/recipes.ts so they're updatable without a release
--    (decision D6). The bundled list remains as offline fallback + seed.
--    Recipes are public curated content: RLS SELECT for everyone (guests
--    use the extension too); writes are service-role only (no policies).
--
-- Note: the valid pattern kinds are the NINE in PATTERN_KINDS
-- (src/lib/supabase/queries.ts): manual_css, json_ld, og_meta, auto_table,
-- next_data, ai_extract, list_pattern, microdata, network_capture.
-- (The 2026_04_30_wbx_pattern_modes.sql comment listing 7 predates the last
-- two and can't be edited in place — applied migrations are checksummed.)

-- ── 1. wbx_pattern dedupe + unique name per (user, domain) ─────────────────
delete from public.wbx_pattern a
using public.wbx_pattern b
where a.user_id = b.user_id
  and a.domain = b.domain
  and a.name = b.name
  and (a.created_at < b.created_at
       or (a.created_at = b.created_at and a.id < b.id));

create unique index if not exists wbx_pattern_user_domain_name_key
  on public.wbx_pattern (user_id, domain, name);

-- ── 2. wbx_recipe ───────────────────────────────────────────────────────────
create table if not exists public.wbx_recipe (
  id text primary key,
  label text not null,
  description text not null default '',
  hosts text[] not null,
  routes text[],
  kind text not null,
  config jsonb not null default '{}'::jsonb,
  yields_rows boolean not null default false,
  is_active boolean not null default true,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.wbx_recipe enable row level security;

drop policy if exists wbx_recipe_read_all on public.wbx_recipe;
create policy wbx_recipe_read_all
  on public.wbx_recipe
  for select
  using (true);

-- ── 3. Seed from the bundled list (generated from recipes.ts) ──────────────
insert into public.wbx_recipe (id, label, description, hosts, routes, kind, config, yields_rows) values
  ('linkedin-jsonld-job', 'LinkedIn — JobPosting (JSON-LD)', 'Public LinkedIn job pages embed a JobPosting JSON-LD with title, company, location, dates, salary.', array['linkedin.com']::text[], array['/jobs/view/**', '/jobs/**']::text[], 'json_ld', '{"ld_type":"JobPosting"}'::jsonb, false),
  ('linkedin-bpr-included', 'LinkedIn — Voyager hydration entities', 'Aggregates every <code id="bpr-guid-*"> hydration block and surfaces the typed entities under `included[]`. Profiles, posts, companies.', array['linkedin.com']::text[], null, 'next_data', '{"source":"bpr-guid","key_path":"included"}'::jsonb, true),
  ('indeed-jsonld-job', 'Indeed — JobPosting (JSON-LD)', 'Indeed job pages emit a structured JobPosting block with all canonical fields.', array['indeed.com']::text[], array['/viewjob*', '/jobs*']::text[], 'json_ld', '{"ld_type":"JobPosting"}'::jsonb, false),
  ('indeed-initial-data', 'Indeed — window._initialData', 'Indeed exposes page state on window._initialData (an inline JS object literal, not JSON). The Framework tab uses paren-balanced scan + safe-eval to read it. Pick the right key path from the tree.', array['indeed.com']::text[], null, 'next_data', '{"source":"window._initialData","key_path":""}'::jsonb, false),
  ('yelp-restaurant-microdata', 'Yelp — Restaurant (microdata)', 'Yelp business pages publish complete Schema.org microdata for restaurants.', array['yelp.com']::text[], array['/biz/**']::text[], 'microdata', '{"itemtype":"Restaurant"}'::jsonb, false),
  ('yelp-reviews-microdata', 'Yelp — Reviews (microdata)', 'Each review is its own Review itemscope with rating, author, date, body.', array['yelp.com']::text[], array['/biz/**']::text[], 'microdata', '{"itemtype":"Review"}'::jsonb, true),
  ('glassdoor-apollo', 'Glassdoor — Apollo cache', 'Glassdoor stores listings, reviews, salaries in an Apollo cache. Use Framework tab to navigate.', array['glassdoor.com']::text[], null, 'next_data', '{"source":"apollo","key_path":""}'::jsonb, false),
  ('amazon-product-jsonld', 'Amazon — Product (JSON-LD)', 'Amazon product pages emit Product JSON-LD with name, brand, offers, ratings.', array['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca', 'amazon.in']::text[], array['/dp/**', '/gp/product/**']::text[], 'json_ld', '{"ld_type":"Product"}'::jsonb, false),
  ('hn-frontpage', 'Hacker News — front-page stories', 'Click 1 story to seed the list-pattern picker, then click title/score/author.', array['news.ycombinator.com']::text[], null, 'list_pattern', '{"list_root":"table.itemlist tbody, table#hnmain tbody","item_selector":"tr.athing","field_paths":[{"name":"title","rel_selector":".titleline > a"},{"name":"url","rel_selector":".titleline > a","attr":"href"}]}'::jsonb, true),
  ('eventbrite-event-jsonld', 'Eventbrite — Event (JSON-LD)', 'Public event pages emit a complete Event JSON-LD with date, venue, prices.', array['eventbrite.com', 'eventbrite.co.uk', 'eventbrite.ca']::text[], null, 'json_ld', '{"ld_type":"Event"}'::jsonb, false),
  ('github-readme', 'GitHub — repo metadata snapshot', 'OG/meta + repo description + language + topics.', array['github.com']::text[], array['/*/*']::text[], 'og_meta', '{}'::jsonb, false),
  ('recipe-jsonld', 'Recipe — Recipe (JSON-LD)', 'Most recipe sites (NYT Cooking, Serious Eats, Allrecipes, Bon Appetit) emit Recipe JSON-LD with ingredients, instructions, nutrition.', array['cooking.nytimes.com', 'seriouseats.com', 'allrecipes.com', 'bonappetit.com', 'foodnetwork.com', 'epicurious.com']::text[], null, 'json_ld', '{"ld_type":"Recipe"}'::jsonb, false)
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description,
  hosts = excluded.hosts,
  routes = excluded.routes,
  kind = excluded.kind,
  config = excluded.config,
  yields_rows = excluded.yields_rows,
  updated_at = now();
-- 12 recipes seeded

