/**
 * Page-diagnostic probe — runs once in the page context and reports every
 * structured-data signal we know how to detect, plus the fingerprint of any
 * unknown-but-promising signal (window.* assignments). Output is small (<5KB
 * typical) and pasteable into chat.
 *
 * Used by the Doctor sub-tab so the user can see at a glance which extraction
 * mode will work on the active page, AND ship a copy-paste snippet to a
 * developer / AI when nothing's working.
 *
 * Self-contained — runs across the chrome.scripting boundary.
 */

export interface PageDiagnostic {
  url: string;
  host: string;
  title: string;
  lang: string | null;
  meta_count: number;
  // Structured data sources we can directly extract from
  sources: {
    json_ld: { count: number; types: string[]; total_size_bytes: number };
    microdata: { count: number; types: string[] };
    tables: { count: number; usable_count: number };
    next_data: { present: boolean; size_bytes: number };
    nuxt_data: { present: boolean; size_bytes: number };
    apollo_dom: { present: boolean; size_bytes: number };
    apollo_inline: { present: boolean };
    bpr_guid: { count: number; total_size_bytes: number };
    window_assignments: { name: string; size_bytes: number }[];
  };
  // Recommendations: which mode is most likely to work
  recommendations: { mode: string; reason: string }[];
  // Lightweight body sample for debugging (first ~500 chars of <main>/<article>/<body>)
  body_sample: string;
  body_total_bytes: number;
}

export function pageDiagnosticInPage(): PageDiagnostic {
  const out: PageDiagnostic = {
    url: location.href,
    host: location.host,
    title: document.title || '',
    lang: document.documentElement.getAttribute('lang'),
    meta_count: document.querySelectorAll('meta').length,
    sources: {
      json_ld: { count: 0, types: [], total_size_bytes: 0 },
      microdata: { count: 0, types: [] },
      tables: { count: 0, usable_count: 0 },
      next_data: { present: false, size_bytes: 0 },
      nuxt_data: { present: false, size_bytes: 0 },
      apollo_dom: { present: false, size_bytes: 0 },
      apollo_inline: { present: false },
      bpr_guid: { count: 0, total_size_bytes: 0 },
      window_assignments: [],
    },
    recommendations: [],
    body_sample: '',
    body_total_bytes: 0,
  };

  // ── JSON-LD ─────────────────────────────────────────────────────────────
  const jsonLd = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
  );
  const jsonLdTypes = new Set<string>();
  let jsonLdSize = 0;
  for (const s of jsonLd) {
    const txt = s.textContent ?? '';
    jsonLdSize += txt.length;
    try {
      const parsed = JSON.parse(txt) as unknown;
      const collect = (item: unknown): void => {
        if (!item || typeof item !== 'object') return;
        if (Array.isArray(item)) {
          for (const i of item) collect(i);
          return;
        }
        const obj = item as Record<string, unknown>;
        if (Array.isArray(obj['@graph'])) {
          for (const g of obj['@graph']) collect(g);
          return;
        }
        const t = obj['@type'];
        if (Array.isArray(t)) {
          for (const v of t as unknown[]) jsonLdTypes.add(String(v));
        } else if (t) jsonLdTypes.add(String(t));
      };
      collect(parsed);
    } catch {
      // skip malformed
    }
  }
  out.sources.json_ld = {
    count: jsonLd.length,
    types: Array.from(jsonLdTypes),
    total_size_bytes: jsonLdSize,
  };

  // ── Microdata ───────────────────────────────────────────────────────────
  const microdataEls = Array.from(
    document.querySelectorAll<HTMLElement>('[itemscope][itemtype]'),
  );
  const topMicrodata = microdataEls.filter((el) => !el.parentElement?.closest('[itemscope]'));
  const mdTypes = new Set<string>();
  for (const el of topMicrodata) {
    const t = el.getAttribute('itemtype') ?? '';
    mdTypes.add(t.split('/').pop() ?? t);
  }
  out.sources.microdata = { count: topMicrodata.length, types: Array.from(mdTypes) };

  // ── Tables ──────────────────────────────────────────────────────────────
  const tables = Array.from(document.querySelectorAll<HTMLTableElement>('table'));
  out.sources.tables = {
    count: tables.length,
    usable_count: tables.filter((t) => t.querySelectorAll('tr').length >= 2).length,
  };

  // ── __NEXT_DATA__ / __NUXT_DATA__ / Apollo DOM ──────────────────────────
  const checkScript = (id: string): { present: boolean; size: number } => {
    const el = document.getElementById(id);
    if (!el?.textContent) return { present: false, size: 0 };
    try {
      JSON.parse(el.textContent);
      return { present: true, size: el.textContent.length };
    } catch {
      return { present: false, size: 0 };
    }
  };
  const next = checkScript('__NEXT_DATA__');
  out.sources.next_data = { present: next.present, size_bytes: next.size };
  const nuxt = checkScript('__NUXT_DATA__');
  out.sources.nuxt_data = { present: nuxt.present, size_bytes: nuxt.size };
  const apolloDom = checkScript('__APOLLO_STATE__');
  out.sources.apollo_dom = { present: apolloDom.present, size_bytes: apolloDom.size };

  // ── LinkedIn bpr-guid ───────────────────────────────────────────────────
  const bpr = Array.from(document.querySelectorAll<HTMLElement>('code[id^="bpr-guid-"]'));
  let bprSize = 0;
  let bprParsed = 0;
  for (const b of bpr) {
    const txt = b.textContent ?? '';
    try {
      JSON.parse(txt);
      bprParsed++;
      bprSize += txt.length;
    } catch {
      // skip
    }
  }
  out.sources.bpr_guid = { count: bprParsed, total_size_bytes: bprSize };

  // ── Inline window.* assignments + Apollo inline ─────────────────────────
  // Scan all inline <script> tags for `window.X = {...}` or `var X = {...};`
  // patterns where the right-hand side is a JSON object/array. We only
  // record the IDENTIFIER and SIZE, not the content (privacy + brevity).
  const ASSIGN_RE =
    /(?:window\.|var\s+|let\s+|const\s+)?(_initialData|__INITIAL_STATE__|__INITIAL_DATA__|__PRELOADED_STATE__|__APP_STATE__|__REDUX_STATE__|__APOLLO_STATE__|apolloState)\s*=\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*[;,)<]/g;
  const seenAssignments = new Map<string, number>();
  const inlineScripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script:not([src])'),
  );
  for (const s of inlineScripts) {
    const txt = s.textContent ?? '';
    if (txt.length > 5_000_000) continue; // skip pathologically large blobs
    let m: RegExpExecArray | null;
    ASSIGN_RE.lastIndex = 0;
    while ((m = ASSIGN_RE.exec(txt))) {
      const name = m[1];
      const blob = m[2];
      if (!name || !blob) continue;
      try {
        // Just verify it's valid JSON at the LHS of the captured chunk —
        // the regex is non-greedy so we may have undershot. Best effort.
        // We don't store the blob; just its length.
        const trimmed = blob.endsWith(',') ? blob.slice(0, -1) : blob;
        // Don't actually JSON.parse here — many of these are JS object
        // literals (unquoted keys), not JSON. Just record presence + size.
        const prev = seenAssignments.get(name) ?? 0;
        if (trimmed.length > prev) seenAssignments.set(name, trimmed.length);
      } catch {
        // skip
      }
    }
    // Apollo apolloState is sometimes nested inside Object.assign or similar.
    if (txt.includes('apolloState') || txt.includes('__APOLLO_STATE__')) {
      out.sources.apollo_inline.present = true;
    }
  }
  out.sources.window_assignments = Array.from(seenAssignments.entries()).map(([name, size]) => ({
    name,
    size_bytes: size,
  }));

  // ── Body sample ─────────────────────────────────────────────────────────
  const main = document.querySelector('main, article, [role="main"]') ?? document.body;
  const text = (main as HTMLElement)?.innerText ?? document.body.innerText ?? '';
  out.body_total_bytes = text.length;
  out.body_sample = text.replace(/\s+/g, ' ').trim().slice(0, 500);

  // ── Recommendations ─────────────────────────────────────────────────────
  if (out.sources.json_ld.count > 0) {
    out.recommendations.push({
      mode: 'json_ld',
      reason: `Found ${out.sources.json_ld.count} JSON-LD block${out.sources.json_ld.count === 1 ? '' : 's'} (types: ${out.sources.json_ld.types.join(', ') || 'none typed'})`,
    });
  }
  if (out.sources.microdata.count > 0) {
    out.recommendations.push({
      mode: 'microdata',
      reason: `Found ${out.sources.microdata.count} microdata item${out.sources.microdata.count === 1 ? '' : 's'} (${out.sources.microdata.types.join(', ')})`,
    });
  }
  if (out.sources.next_data.present) {
    out.recommendations.push({
      mode: 'next_data',
      reason: `__NEXT_DATA__ present (${(out.sources.next_data.size_bytes / 1024).toFixed(1)} KB) — pick a key path in Framework tab`,
    });
  }
  if (out.sources.nuxt_data.present) {
    out.recommendations.push({
      mode: 'next_data',
      reason: `__NUXT_DATA__ present — pick a key path in Framework tab`,
    });
  }
  if (out.sources.apollo_dom.present) {
    out.recommendations.push({
      mode: 'next_data',
      reason: `__APOLLO_STATE__ present — pick a key path in Framework tab`,
    });
  }
  if (out.sources.bpr_guid.count > 0) {
    out.recommendations.push({
      mode: 'next_data',
      reason: `${out.sources.bpr_guid.count} LinkedIn Voyager hydration block(s) — Framework tab → bpr-guid source`,
    });
  }
  if (out.sources.window_assignments.length > 0) {
    const names = out.sources.window_assignments.map((a) => a.name).join(', ');
    out.recommendations.push({
      mode: 'network_capture',
      reason: `Inline window.* state detected (${names}). Framework tab handles common ones; otherwise use Network capture.`,
    });
  }
  if (out.sources.tables.usable_count > 0) {
    out.recommendations.push({
      mode: 'auto_table',
      reason: `${out.sources.tables.usable_count} table(s) on the page`,
    });
  }
  if (out.recommendations.length === 0) {
    out.recommendations.push({
      mode: 'list_pattern',
      reason: 'No structured-data signals detected. Try List Pattern (click an example item) or AI Extract.',
    });
  }

  return out;
}
