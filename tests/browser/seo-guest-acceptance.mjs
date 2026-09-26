#!/usr/bin/env node
/**
 * Guest SEO native-panel acceptance. Root owns release preflight and execution.
 * Break caught: navigation leaves the SEO view showing the previous page's title.
 * Two real public pages have distinct document titles; no response or auth is mocked.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'seo-guest-acceptance.json');
const PAGES = ['https://example.org/', 'https://www.iana.org/domains/reserved'];
const DETAIL_PAGE = 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/link';
const NEXT_DETAIL_PAGE = 'https://en.wikipedia.org/wiki/HTML';
const METADATA_FIXTURE_PAGE = 'https://www.airbnb.com/';
const RUN_METADATA_FIXTURE = process.env.SEO_GUEST_METADATA_FIXTURE === 'airbnb';
const report = {
  schema_version: 1,
  feature_id: 'EXT-F-1008',
  mode: 'guest',
  status: 'unverified',
  scope: 'public-page guest SEO actions in an owned native side panel',
  targets: [],
  deferred: [
    { case: 'T01', part: 'one audit per URL and slow-old-result race' },
    { case: 'T02', part: 'fresh capture and stale advice replacement after re-audit' },
    { case: 'T03', part: 'unreachable HTTP(S), other restricted schemes, and reload dimension' },
    { case: 'T04-T06,T08', part: 'database save, history, and diff flows' },
    { case: 'T07', part: 'actual clipboard output, member/admin role gates, and JSON contents' },
    {
      case: 'T09',
      part: 'broken social preview image and detail controls beyond the bounded next batch; optional hreflang/schema doors remain unverified when their live source data is absent',
    },
    { case: 'T10-T14', part: 'recommendations, Chat staging, and social snippet actions' },
    { case: 'all', part: 'member and admin modes' },
  ],
  last_safe_stage: 'before_owned_profile',
  last_safe_observable: null,
  current_operation: null,
};
const advance = (stage, observable = null) => {
  report.last_safe_stage = stage;
  report.last_safe_observable = observable;
  report.current_operation = null;
};
const enter = (operation) => {
  report.current_operation = operation;
};
async function observe(stage, read) {
  enter(stage);
  try {
    const value = await read();
    advance(stage, value);
    return value;
  } catch {
    throw new Error(`${stage}_observation_failed`);
  }
}
async function waitObserved(operation, read, accept, timeoutMs) {
  enter(operation);
  const result = await waitFor(
    operation,
    async () => {
      const value = await read();
      report.last_safe_stage = `${operation}_sample`;
      report.last_safe_observable = value;
      return value;
    },
    accept,
    timeoutMs,
  );
  advance(`${operation}_accepted`, result);
  return result;
}
const target = (caseId, subtarget, evidence) =>
  report.targets.push({ case_id: `EXT-F-1008-${caseId}`, subtarget, status: 'pass', evidence });
const unverifiedTarget = (caseId, subtarget, reason) =>
  report.targets.push({ case_id: `EXT-F-1008-${caseId}`, subtarget, status: 'unverified', reason });

// New-batch failures retain only our fixed assertion label and scalar values.
// Public page text, arbitrary DOM strings, transport errors, and URLs never
// enter this diagnostic; the run receipt can identify the failed predicate.
function assertNext(predicate, verify) {
  enter(`next_detail_${predicate}_assertion`);
  try {
    verify();
  } catch (error) {
    // Node appends a multiline actual/expected diff to strict equality
    // messages. The first line is our fixed label; never retain the diff.
    const firstLine = typeof error?.message === 'string' ? error.message.split('\n', 1)[0] : '';
    const scalar = (value) =>
      typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
        ? value
        : null;
    report.failure = {
      predicate,
      assertion_label:
        error?.code === 'ERR_ASSERTION' && firstLine.length > 0 && firstLine.length <= 100
          ? firstLine
          : 'predicate_evaluation_failed',
      actual_scalar: scalar(error?.actual),
      expected_scalar: scalar(error?.expected),
    };
    throw error;
  }
}

// One scoped relationship for all SEO observations. The outer tablist is the
// app navigation; mounted feature panels may contain their own nested tabs.
const SEO_SCOPE = `
  const lists = [...document.querySelectorAll('[role="tablist"]')]
    .filter((node) => !node.closest('[role="tabpanel"]'));
  const tabs = lists.length === 1
    ? [...lists[0].querySelectorAll('[role="tab"]')]
      .filter((node) => node.closest('[role="tablist"]') === lists[0]
        && node.title === 'SEO')
    : [];
  const tab = tabs.length === 1 ? tabs[0] : null;
  const controls = tab?.getAttribute('aria-controls');
  const pane = controls ? document.getElementById(controls) : null;
  const linked = !!pane && pane.id === controls
    && pane.getAttribute('aria-labelledby') === tab.id
    && pane.getAttribute('data-state') === 'active'
    && pane.getBoundingClientRect().height > 0;
`;

async function selectedSeo(panel) {
  return evaluate(
    panel,
    `(() => {
      ${SEO_SCOPE}
      const visible = (node) => {
        const style = getComputedStyle(node), rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden'
          && style.display !== 'none' && !node.closest('[inert]');
      };
      const clickCandidates = [...document.querySelectorAll('button[title]')]
        .filter((node) => node.title === 'SEO' && visible(node));
      const heading = [...(pane?.querySelectorAll('span') ?? [])]
        .some((node) => node.textContent.trim() === 'SEO audit');
      const text = pane?.innerText ?? '';
      return { mainTablists: lists.length, seoTabs: tabs.length,
        documentTimeOrigin: performance.timeOrigin,
        visibleSeoTitleButtons: clickCandidates.length,
        clickCandidateIsMainTab: clickCandidates.length === 1 && clickCandidates[0] === tab,
        selected: tab?.getAttribute('aria-selected') === 'true',
        linked,
        heading, fallback: !!pane?.querySelector('svg.animate-spin') && !text.trim(),
        auditButtonCount: [...(pane?.querySelectorAll('button') ?? [])]
          .filter((node) => /^(Audit this page|Re-audit)$/.test(node.textContent.trim())).length,
        auditError: /Audit failed:|This page cannot be audited/.test(text) };
    })()`,
  );
}

async function seoContent(panel) {
  return evaluate(
    panel,
    `(() => {
      ${SEO_SCOPE}
      if (!linked || tab?.getAttribute('aria-selected') !== 'true')
        return { scopeValid: false, title: null, headings: false, reAudit: false, error: false };
      const group = [...(pane?.querySelectorAll('span') ?? [])]
        .find((node) => node.textContent.trim() === 'Title & description');
      // SeoGroup places its SeoRow children inside the card's inner divider.
      // The card itself has only that divider as a child, not the Title row.
      const rows = group?.parentElement?.nextElementSibling?.firstElementChild;
      const titleRow = [...(rows?.children ?? [])]
        .find((node) => node.firstElementChild?.textContent.trim() === 'Title');
      const title = titleRow?.lastElementChild?.lastElementChild?.textContent.trim() ?? null;
      const headingGroup = [...(pane?.querySelectorAll('span') ?? [])]
        .find((node) => node.textContent.trim() === 'Headings');
      return { scopeValid: true, title, headings: !!headingGroup,
        reAudit: [...(pane?.querySelectorAll('button') ?? [])]
          .some((node) => node.textContent.trim() === 'Re-audit' && !node.disabled),
        error: [...(pane?.querySelectorAll('div') ?? [])]
          .some((node) => /^Audit failed:|^This page cannot be audited/.test(node.textContent.trim())) };
    })()`,
  );
}

async function restrictedSeoState(panel) {
  return evaluate(
    panel,
    `(() => {
      ${SEO_SCOPE}
      if (!linked || tab?.getAttribute('aria-selected') !== 'true')
        return { scopeValid: false };
      const error = [...pane.querySelectorAll('div')]
        .find((node) => node.textContent?.trim()
          === 'This page cannot be audited (browser-internal or restricted URL).');
      const buttons = [...pane.querySelectorAll('button')];
      const titleGroup = [...pane.querySelectorAll('span')]
        .some((node) => node.textContent.trim() === 'Title & description');
      return { scopeValid: true,
        expectedErrorVisible: !!error && error.getBoundingClientRect().height > 0,
        staleAuditAbsent: !titleGroup,
        copyAuditAbsent: !buttons.some((node) => node.title === 'Copy audit'),
        retryOffered: buttons.some((node) => node.textContent.trim() === 'Audit this page'
          && !node.disabled) };
    })()`,
  );
}

async function pageEvidence(page) {
  await page.waitForFunction(() => document.readyState === 'complete' && !!document.title);
  return page.evaluate(() => ({
    title: document.title.trim(),
    heading: document.querySelector('h1')?.textContent?.trim() ?? null,
  }));
}

// Expected detail values come from the public tab's DOM, independently of the
// extension's audit and renderer. The sparse and rich pages must disagree so
// a fixed detail response cannot pass both observations.
async function publicDetailEvidence(page) {
  return page.evaluate(() => {
    const meta = (selector) => document.querySelector(selector)?.getAttribute('content') ?? null;
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .map((node) => node.textContent?.trim() ?? '')
      .filter(Boolean);
    const links = [...document.querySelectorAll('a[href]')].filter((node) => {
      try {
        return ['http:', 'https:'].includes(
          new URL(node.getAttribute('href'), location.href).protocol,
        );
      } catch {
        return false;
      }
    });
    return {
      title: document.title.trim(),
      description: meta('meta[name="description"]'),
      canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
      robots: meta('meta[name="robots"]'),
      language: document.documentElement.lang || null,
      headingCount: Math.min(headings.length, 200),
      firstHeading: headings[0] ?? null,
      hasSocialMetadata: [...document.querySelectorAll('meta')].some(
        (node) =>
          Boolean(node.getAttribute('content')) &&
          ((node.getAttribute('property') ?? '').startsWith('og:') ||
            (node.getAttribute('name') ?? '').startsWith('twitter:')),
      ),
      hasLinks: links.length > 0,
      hasImages: document.querySelectorAll('img').length > 0,
    };
  });
}

async function seoDetailState(panel) {
  return evaluate(
    panel,
    `(() => {
    ${SEO_SCOPE}
    if (!linked || tab?.getAttribute('aria-selected') !== 'true') return { scopeValid: false };
    const card = (label) => [...pane.querySelectorAll('span')]
      .find((node) => node.textContent.trim() === label)
      ?.parentElement?.nextElementSibling ?? null;
    const row = (group, label) => [...(card(group)?.querySelectorAll('span') ?? [])]
      .find((node) => node.textContent.trim() === label)?.parentElement ?? null;
    const rowText = (group, label) =>
      row(group, label)?.lastElementChild?.lastElementChild?.textContent.trim() ?? null;
    const canonical = row('Title & description', 'Canonical')?.querySelector('a');
    const headingsCard = card('Headings');
    const firstHeading = [...(headingsCard?.querySelectorAll('span') ?? [])]
      .find((node) => /^H[1-6]$/.test(node.textContent.trim()))?.parentElement;
    return {
      scopeValid: true,
      title: rowText('Title & description', 'Title'),
      description: rowText('Title & description', 'Description'),
      robots: rowText('Title & description', 'Robots'),
      canonical: canonical ? { href: canonical.href, target: canonical.target,
        noopener: canonical.relList.contains('noopener'),
        noreferrer: canonical.relList.contains('noreferrer') } : null,
      language: rowText('International', 'Page language'),
      groups: {
        social: !!card('Social preview'), international: !!card('International'),
        headings: !!headingsCard, links: !!card('Links'),
        images: !!card('Images'), readability: !!card('Readability'),
        performance: !!card('Performance'),
      },
      firstHeading: firstHeading?.textContent.trim() ?? null,
    };
  })()`,
  );
}

// This oracle reads the public tab only. It never receives the extension's
// audit object, and absent browser timing stays absent rather than becoming 0.
async function publicNextDetailEvidence(page, response) {
  const dom = await page.evaluate(() => {
    const host = location.host.toLowerCase();
    const links = { internal: 0, external: 0 };
    for (const anchor of document.querySelectorAll('a[href]')) {
      try {
        const url = new URL(anchor.getAttribute('href'), location.href);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
        if (url.host.toLowerCase() === host) links.internal += 1;
        else links.external += 1;
      } catch {
        // An invalid public href cannot be counted as a destination.
      }
    }
    const images = [...document.images];
    const bodyText = document.body?.innerText || document.body?.textContent || '';
    const alternates = [...document.querySelectorAll('link[rel~="alternate"][hreflang]')]
      .map((node) => ({ lang: node.getAttribute('hreflang')?.trim() ?? '', href: node.href }))
      .filter((item) => item.lang && /^https?:/.test(item.href));
    const schemaTypes = new Set();
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        JSON.parse(script.textContent, (key, value) => {
          if (key === '@type') {
            for (const type of Array.isArray(value) ? value : [value]) {
              if (typeof type === 'string' && type.trim()) {
                schemaTypes.add(type);
              }
            }
          }
          return value;
        });
      } catch {
        // Malformed public JSON-LD cannot support a schema assertion.
      }
    }
    for (const node of document.querySelectorAll('[itemtype]')) {
      const type = node.getAttribute('itemtype');
      if (type) schemaTypes.add(type);
    }
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      title: document.title.trim(),
      links,
      images: {
        total: images.length,
        missingAlt: images.filter((image) => !image.getAttribute('alt')?.trim()).length,
      },
      bodyHasText: Boolean(bodyText.trim()),
      alternates,
      schemaTypes: [...schemaTypes],
      navigation: nav
        ? {
            type: nav.type,
            durationMs: nav.duration > 0 ? Math.round(nav.duration) : null,
            transferSizeBytes: nav.transferSize,
            responseStatus: nav.responseStatus || null,
          }
        : null,
    };
  });
  return { ...dom, responseStatus: response?.status() ?? null };
}

async function seoNextDetailState(panel) {
  return evaluate(
    panel,
    `(() => {
      ${SEO_SCOPE}
      if (!linked || tab?.getAttribute('aria-selected') !== 'true') return { scopeValid: false };
      const header = (label) => [...pane.querySelectorAll('span')]
        .find((node) => node.textContent.trim() === label &&
          node.parentElement?.nextElementSibling?.matches('div'));
      const card = (label) => header(label)?.parentElement?.nextElementSibling ?? null;
      const hint = (label) => header(label)?.nextElementSibling?.textContent.trim() ?? null;
      const stat = (group, label) => {
        const labels = [...(card(group)?.querySelectorAll('div') ?? [])]
          .filter((node) => node.textContent.trim() === label && node.children.length === 0);
        return labels.length === 1 ? labels[0].previousElementSibling?.textContent.trim() ?? null : null;
      };
      const row = (group, label) => [...(card(group)?.querySelectorAll('span') ?? [])]
        .find((node) => node.textContent.trim() === label)?.parentElement ?? null;
      const rowText = (group, label) =>
        row(group, label)?.lastElementChild?.lastElementChild?.textContent.trim() ?? null;
      const readabilityCard = card('Readability');
      const fleschLabel = [...(readabilityCard?.querySelectorAll('span') ?? [])]
        .find((node) => node.textContent.trim() === 'Flesch reading ease');
      const hreflang = [...(card('International')?.querySelectorAll('a[href]') ?? [])]
        .map((anchor) => ({ lang: anchor.parentElement?.firstElementChild?.textContent.trim() ?? '',
          href: anchor.href, target: anchor.target,
          noopener: anchor.relList.contains('noopener'),
          noreferrer: anchor.relList.contains('noreferrer') }));
      const schema = [...(card('Structured data')?.querySelectorAll('a[href]') ?? [])]
        .map((anchor) => ({ label: anchor.textContent.trim(), href: anchor.href,
          title: anchor.title, target: anchor.target,
          noopener: anchor.relList.contains('noopener'),
          noreferrer: anchor.relList.contains('noreferrer') }));
      const schemaChips = [...(card('Structured data')?.firstElementChild?.firstElementChild?.children ?? [])]
        .map((node) => node.textContent.trim());
      return {
        scopeValid: true,
        title: rowText('Title & description', 'Title'),
        links: card('Links') ? { internal: stat('Links', 'Internal'),
          external: stat('Links', 'External'), hint: hint('Links') } : null,
        images: card('Images') ? { total: stat('Images', 'Total'),
          missingAlt: stat('Images', 'Missing alt'), hint: hint('Images') } : null,
        readability: readabilityCard ? { words: stat('Readability', 'Words'),
          sentences: stat('Readability', 'Sentences'),
          score: fleschLabel?.previousElementSibling?.textContent.trim() ?? null,
          summary: fleschLabel?.parentElement?.nextElementSibling?.textContent.trim() ?? null } : null,
        performance: card('Performance') ? { status: rowText('Performance', 'HTTP status'),
          navigation: rowText('Performance', 'Navigation'),
          duration: rowText('Performance', 'Load duration'),
          transfer: rowText('Performance', 'Transfer size') } : null,
        internationalHint: hint('International'), hreflang,
        schemaHint: hint('Structured data'), schema, schemaChips,
      };
    })()`,
  );
}

function displayedCount(value) {
  return value === null || !/^[0-9][0-9,]*$/.test(value) ? null : Number(value.replaceAll(',', ''));
}

function schemaDestination(type) {
  if (/^https?:\/\//i.test(type)) return type;
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(type) ? `https://schema.org/${type}` : null;
}

function schemaChipLabel(type) {
  try {
    const url = new URL(type);
    return /^www[.]schema[.]org$|^schema[.]org$/i.test(url.hostname)
      ? `${url.pathname.slice(1)}${url.search}${url.hash}`
      : type;
  } catch {
    return type;
  }
}

function assertPublicDetails(actual, expected) {
  assert.equal(actual.scopeValid, true, 'active SEO pane is linked to its tab');
  assert.equal(actual.title, expected.title, 'detail title comes from public document');
  assert.equal(actual.description, expected.description ?? '—', 'description matches public meta');
  assert.equal(actual.robots, expected.robots, 'robots row follows public meta');
  assert.equal(
    actual.canonical?.href ?? null,
    expected.canonical,
    'canonical destination matches public link',
  );
  assert.equal(actual.language, expected.language, 'language follows public html element');
  assert.equal(
    actual.groups.social,
    expected.hasSocialMetadata,
    'social group follows public metadata',
  );
  assert.equal(
    actual.groups.international,
    Boolean(expected.language),
    'language group is measured',
  );
  assert.equal(
    actual.groups.headings,
    expected.headingCount > 0,
    'headings group follows public headings',
  );
  assert.equal(actual.groups.links, expected.hasLinks, 'links group follows public anchors');
  assert.equal(actual.groups.images, expected.hasImages, 'images group follows public images');
  if (expected.firstHeading)
    assert.ok(
      actual.firstHeading?.includes(expected.firstHeading),
      'first heading text matches public page',
    );
}

function assertNextLinks(actual, expected) {
  assert.equal(actual.scopeValid, true, 'next detail observation uses the active SEO pane');
  assert.equal(actual.title, expected.title, 'next detail audit belongs to the owned public tab');
  const totalLinks = expected.links.internal + expected.links.external;
  assert.equal(Boolean(actual.links), totalLinks > 0, 'Links group follows counted public anchors');
  if (totalLinks > 0) {
    assert.equal(
      displayedCount(actual.links.internal),
      expected.links.internal,
      'internal link count',
    );
    assert.equal(
      displayedCount(actual.links.external),
      expected.links.external,
      'external link count',
    );
    assert.equal(displayedCount(actual.links.hint), totalLinks, 'Links group total');
  }
}

function assertNextImages(actual, expected) {
  assert.equal(
    Boolean(actual.images),
    expected.images.total > 0,
    'Images group follows public img tags',
  );
  if (expected.images.total > 0) {
    assert.equal(displayedCount(actual.images.total), expected.images.total, 'image total');
    assert.equal(
      displayedCount(actual.images.missingAlt),
      expected.images.missingAlt,
      'missing alt count',
    );
    assert.equal(displayedCount(actual.images.hint), expected.images.total, 'Images group total');
  }
}

function assertNextReadability(actual, expected) {
  assert.equal(
    Boolean(actual.readability),
    expected.bodyHasText,
    'readability follows public text',
  );
  if (!expected.bodyHasText) return;
  assert.ok(displayedCount(actual.readability.words) > 0, 'word count is populated');
  assert.ok(displayedCount(actual.readability.sentences) > 0, 'sentence count is populated');
  assert.ok(
    actual.readability.score !== null && Number.isFinite(Number(actual.readability.score)),
    'Flesch score is numeric',
  );
  assert.match(
    actual.readability.summary ?? '',
    /^(Very easy|Easy|Fairly easy|Plain English|Fairly difficult|Difficult|Very difficult|Extremely difficult) — .+$/,
    'Flesch score has a named reading band and grade',
  );
}

function assertNextPerformance(actual, expected) {
  const nav = expected.navigation;
  assert.equal(Boolean(actual.performance), Boolean(nav), 'performance follows navigation entry');
  if (!nav) return;
  assert.equal(actual.performance.navigation, nav.type, 'navigation type comes from owned page');
  assert.equal(
    actual.performance.status,
    nav.responseStatus === null ? null : String(nav.responseStatus),
    'unavailable HTTP status is omitted; exposed status matches navigation',
  );
  if (nav.responseStatus !== null && expected.responseStatus !== null)
    assert.equal(
      nav.responseStatus,
      expected.responseStatus,
      'browser status matches page response',
    );
  assert.equal(
    actual.performance.duration,
    nav.durationMs === null ? null : `${nav.durationMs.toLocaleString('en-US')} ms`,
    'load duration follows available browser timing',
  );
  assert.equal(
    actual.performance.transfer !== null,
    nav.transferSizeBytes !== null,
    'transfer row is present only when navigation timing exposes it',
  );
  if (actual.performance.transfer !== null) {
    const match = /^([0-9]+(?:[.][0-9]+)?) (B|KB|MB|GB|TB|PB)$/.exec(actual.performance.transfer);
    assert.ok(match, 'transfer is a numeric size');
    const scale = 1024 ** ['B', 'KB', 'MB', 'GB', 'TB', 'PB'].indexOf(match[2]);
    const precision = match[1].includes('.') ? 0.05 : 0.5;
    assert.ok(
      Math.abs(Number(match[1]) * scale - nav.transferSizeBytes) <= precision * scale + 1,
      'displayed transfer size quantifies owned navigation bytes',
    );
  }
}

function assertNextDoors(actual, expected) {
  assert.equal(
    displayedCount(actual.internationalHint?.replace(' alternates', '') ?? null),
    expected.alternates.length > 0 ? expected.alternates.length : null,
    'alternate count follows public hreflang links',
  );
  assert.deepEqual(
    actual.hreflang
      .map(({ lang, href }) => ({ lang, href }))
      .sort((a, b) => `${a.lang}:${a.href}`.localeCompare(`${b.lang}:${b.href}`)),
    [...expected.alternates].sort((a, b) =>
      `${a.lang}:${a.href}`.localeCompare(`${b.lang}:${b.href}`),
    ),
    'visible hreflang values follow public alternate links',
  );
  assert.equal(
    displayedCount(actual.schemaHint),
    expected.schemaTypes.length > 0 ? expected.schemaTypes.length : null,
    'schema group count follows public structured data',
  );
  assert.deepEqual(
    [...actual.schemaChips].sort(),
    expected.schemaTypes.map(schemaChipLabel).sort(),
    'all visible schema chips, including plain text chips, follow public types',
  );
  const expectedSchemaLinks = expected.schemaTypes
    .map((type) => ({ type, href: schemaDestination(type) }))
    .filter(({ href }) => href !== null);
  assert.deepEqual(
    actual.schema
      .map(({ title, href }) => ({ title, href }))
      .sort((a, b) => a.title.localeCompare(b.title)),
    expectedSchemaLinks
      .map(({ type, href }) => ({ title: `Open ${type} on schema.org`, href }))
      .sort((a, b) => a.title.localeCompare(b.title)),
    'schema chips link to the matching type documentation',
  );
  for (const link of [...actual.hreflang, ...actual.schema]) {
    assert.equal(link.target, '_blank', 'detail door opens a new tab');
    assert.equal(link.noopener, true, 'detail door omits opener');
    assert.equal(link.noreferrer, true, 'detail door omits referrer');
  }
  return expectedSchemaLinks;
}

async function activateSeoLink(panel, page, groupName, expectedHref) {
  // A real mouse press reaches only the scoped, hit-tested outbound anchor.
  // The anchor's href and target are asserted before any outbound navigation.
  const diagnostic = {
    group: groupName === 'International' ? 'international' : 'structured_data',
    step: 'anchor_sample',
    candidateCount: null,
    destinationMatched: null,
    opensNewTab: null,
    stableHitSamples: 0,
    pointerPressReturned: false,
    pointerReleaseReturned: false,
    newPageObserved: false,
    expectedPageReached: false,
    sourcePageStillOpen: null,
    sourceUrlUnchanged: null,
    samples: [],
    sampleFailure: null,
    privateScreenshot: null,
  };
  const sourceUrl = page.url();
  let opened;
  const sample = () =>
    evaluate(
      panel,
      `(() => {
    ${SEO_SCOPE}
    if (!linked || tab?.getAttribute('aria-selected') !== 'true') return null;
    const group = [...pane.querySelectorAll('span')]
      .find((node) => node.textContent.trim() === ${JSON.stringify(groupName)});
    const card = group?.parentElement?.nextElementSibling;
    const anchors = [...(card?.querySelectorAll('a[href]') ?? [])]
      .filter((anchor) => anchor.href === ${JSON.stringify(expectedHref)});
    if (anchors.length !== 1) return { count: anchors.length };
    const anchor = anchors[0];
    anchor.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = anchor.getBoundingClientRect();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    const top = document.elementFromPoint(x, y);
    const hit = top === anchor || anchor.contains(top);
    const topCategory = hit ? 'target'
      : !top ? 'none'
      : top.closest('[data-sonner-toast], [role="status"], [role="alert"]') ? 'notification'
      : top.closest('[role="dialog"], [role="alertdialog"]') ? 'dialog'
      : top.closest('header, [role="tablist"]') ? 'header_or_tabs'
      : pane?.contains(top) ? 'same_pane_other_element' : 'outside_pane';
    return { count: 1, href: anchor.href, target: anchor.target,
      x, y, width: rect.width, height: rect.height,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      paneScrollTop: pane?.scrollTop ?? null,
      hit, topCategory };
  })()`,
    );
  try {
    diagnostic.sampleFailure = 'initial_sample_unavailable';
    const first = await sample();
    const safeSample = (value) => ({
      candidateCount: Number.isInteger(value?.count) ? value.count : null,
      hit: value?.hit === true,
      topCategory: value?.topCategory ?? 'unavailable',
      x: Number.isFinite(value?.x) ? Math.round(value.x) : null,
      y: Number.isFinite(value?.y) ? Math.round(value.y) : null,
      width: Number.isFinite(value?.width) ? Math.round(value.width) : null,
      height: Number.isFinite(value?.height) ? Math.round(value.height) : null,
      viewportWidth: Number.isFinite(value?.viewportWidth) ? value.viewportWidth : null,
      viewportHeight: Number.isFinite(value?.viewportHeight) ? value.viewportHeight : null,
      paneScrollTop: Number.isFinite(value?.paneScrollTop) ? value.paneScrollTop : null,
    });
    diagnostic.samples.push(safeSample(first));
    diagnostic.candidateCount = Number.isInteger(first?.count) ? first.count : null;
    diagnostic.destinationMatched = first?.href === expectedHref;
    diagnostic.opensNewTab = first?.target === '_blank';
    diagnostic.sampleFailure =
      first?.count !== 1
        ? 'initial_candidate_count'
        : first.href !== expectedHref
          ? 'initial_destination'
          : first.target !== '_blank'
            ? 'initial_target'
            : null;
    assert.equal(first?.count, 1, `unique ${groupName} outbound anchor`);
    assert.equal(first.href, expectedHref, `${groupName} anchor points to public DOM destination`);
    assert.equal(first.target, '_blank', `${groupName} opens in a new tab`);
    let previous = first;
    for (let index = 0; index < 2; index += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      diagnostic.sampleFailure = 'followup_sample_unavailable';
      const current = await sample();
      diagnostic.samples.push(safeSample(current));
      diagnostic.sampleFailure =
        current?.count !== 1
          ? 'followup_candidate_count'
          : current?.hit !== true
            ? 'hit'
            : !(current.width > 0 && current.height > 0)
              ? 'area'
              : Math.abs(previous.x - current.x) >= 0.25 || Math.abs(previous.y - current.y) >= 0.25
                ? 'position_stability'
                : null;
      assert.equal(current?.hit, true, `${groupName} link is unobstructed for real pointer`);
      assert.ok(current.width > 0 && current.height > 0, `${groupName} link has a click area`);
      assert.ok(
        Math.abs(previous.x - current.x) < 0.25 && Math.abs(previous.y - current.y) < 0.25,
        `${groupName} link remains stable`,
      );
      diagnostic.stableHitSamples += 1;
      previous = current;
    }
    diagnostic.step = 'pointer_press';
    const openedPromise = page.context().waitForEvent('page', { timeout: 20000 });
    await panel.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: previous.x,
      y: previous.y,
      button: 'left',
      clickCount: 1,
    });
    diagnostic.pointerPressReturned = true;
    diagnostic.step = 'pointer_release';
    await panel.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: previous.x,
      y: previous.y,
      button: 'left',
      clickCount: 1,
    });
    diagnostic.pointerReleaseReturned = true;
    diagnostic.step = 'new_page_wait';
    opened = await openedPromise;
    diagnostic.newPageObserved = true;
    diagnostic.step = 'destination_wait';
    await opened.waitForURL((url) => url.href === expectedHref, { timeout: 20000 });
    diagnostic.expectedPageReached = true;
    assert.equal(opened.url(), expectedHref, 'new tab reaches the observed outbound URL');
    diagnostic.step = 'source_page_restoration';
  } catch (error) {
    if (diagnostic.step === 'anchor_sample') {
      try {
        const shot = await panel.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
        });
        const relativePath = `test-results/seo-guest-door-failure-${randomUUID()}.png`;
        const handle = await open(join(REPO, relativePath), 'wx', 0o600);
        try {
          await handle.writeFile(Buffer.from(shot.data, 'base64'));
          await handle.sync();
        } finally {
          await handle.close();
        }
        diagnostic.privateScreenshot = relativePath;
      } catch {
        diagnostic.privateScreenshot = 'capture_unavailable';
      }
    }
    if (error && typeof error === 'object') error.seoDoorDiagnostic = diagnostic;
    throw error;
  } finally {
    if (opened) await opened.close();
    diagnostic.sourcePageStillOpen = !page.isClosed();
    diagnostic.sourceUrlUnchanged = page.url() === sourceUrl;
  }
}

async function copyMenu(panel) {
  enter('copy_menu_click');
  await click(panel, 'title', 'Copy audit');
  advance('copy_menu_click_dispatched', { trustedInput: true });
  return waitObserved(
    'copy_menu_choices_wait',
    () =>
      evaluate(
        panel,
        `(() => {
      const popover = [...document.querySelectorAll('[data-state="open"]')]
        .find((node) => node.textContent?.includes('Summary (text)')
          && node.textContent?.includes('For AI agent'));
      const choices = [...(popover?.querySelectorAll('button') ?? [])]
        .map((node) => node.textContent.trim());
      return { open: !!popover, choices };
    })()`,
      ),
    (state) =>
      state?.open &&
      state.choices.includes('Summary (text)') &&
      state.choices.includes('For AI agent'),
  );
}

try {
  const harness = await runNativeSidepanelQa({
    exercisePanel: async ({ page, panel }) => {
      advance('owned_guest_panel_ready', { nativePanel: true });
      const publicPages = [];
      for (const [index, url] of PAGES.entries()) {
        enter(`public_page_${index}_navigation`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        advance(`public_page_${index}_loaded`, { reachedExpectedPage: page.url() === url });
        const observedPage = {
          ...(await observe(`public_page_${index}_inspected`, () => pageEvidence(page))),
          url: page.url(),
        };
        assert.ok(observedPage.title, 'public page has a real title');
        publicPages.push(observedPage);
        advance(`public_page_${index}_ready`, { title: observedPage.title });
        if (index === 0) {
          const beforeClick = await observe('seo_click_preflight', () => selectedSeo(panel));
          assert.equal(
            beforeClick.clickCandidateIsMainTab,
            true,
            'SEO click candidate is the unique main navigation tab',
          );
          enter('seo_click');
          await click(panel, 'title', 'SEO');
          advance('seo_click_dispatched', { trustedInput: true });
          await observe('seo_post_click_observation', () => selectedSeo(panel));
        }
        await waitObserved(
          `seo_page_${index}_readiness_wait`,
          () => selectedSeo(panel),
          (state) => state?.selected && state.linked && state.heading && !state.fallback,
        );
        const content = await waitObserved(
          `seo_page_${index}_audit_wait`,
          () => seoContent(panel),
          (state) =>
            state?.scopeValid &&
            state.title === observedPage.title &&
            state.reAudit &&
            !state.error,
          30000,
        );
        assert.equal(
          content.headings,
          !!observedPage.heading,
          'SEO headings group agrees with the real page',
        );
        target('T09', `page_${index}_title_and_headings`, {
          publicTitle: observedPage.title,
          titleMatches: true,
          headingsPresenceMatches: true,
        });
        advance(`seo_page_${index}_matched`, { title: observedPage.title });
      }
      assert.notEqual(
        report.targets[0].evidence.publicTitle,
        report.targets[1].evidence.publicTitle,
        'public pages must distinguish stale audits',
      );
      target('T01', 'new_url_replaces_visible_title', { twoDistinctPublicTitles: true });

      await observe('manual_reaudit_preflight', () => seoContent(panel));
      enter('manual_reaudit_click');
      await click(panel, 'button', 'Re-audit');
      advance('manual_reaudit_click_dispatched', { trustedInput: true });
      await waitObserved(
        'manual_reaudit_running_wait',
        () => seoContent(panel),
        (state) => state?.scopeValid && state.reAudit === false,
      );
      await waitObserved(
        'manual_reaudit_settle_wait',
        () => seoContent(panel),
        (state) =>
          state?.scopeValid &&
          state.title === report.targets[1].evidence.publicTitle &&
          state.reAudit &&
          !state.error,
        30000,
      );
      target('T02', 'manual_button_returns_to_current_page', { currentTitlePreserved: true });
      advance('manual_reaudit_settled', { currentTitlePreserved: true });

      await observe('copy_menu_preflight', () => selectedSeo(panel));
      const menu = await copyMenu(panel);
      assert.equal(menu.choices.includes('JSON'), false, 'guest JSON choice is hidden');
      target('T07', 'guest_menu_offers_text_and_ai_but_hides_json', {
        textChoice: true,
        agentChoice: true,
        jsonAbsent: true,
      });
      advance('guest_copy_menu_verified', {
        textChoice: true,
        agentChoice: true,
        jsonAbsent: true,
      });

      // The panel document is reloaded in the owned target. React state is
      // gone; a fresh audit must match the actual current browser page.
      const beforeReload = await observe('seo_before_reload_document', () => selectedSeo(panel));
      enter('seo_panel_reload');
      await panel.send('Page.reload', { ignoreCache: false });
      advance('seo_panel_reload_dispatched', { currentUrl: publicPages[1].url });
      let afterReload = await waitObserved(
        'seo_reload_navigation_wait',
        () => selectedSeo(panel),
        (state) =>
          state?.mainTablists === 1 &&
          state.seoTabs === 1 &&
          state.documentTimeOrigin > beforeReload.documentTimeOrigin,
        30000,
      );
      const reselectedAfterReload = !afterReload.selected;
      if (!afterReload.selected) {
        enter('seo_reselect_after_reload');
        await click(panel, 'title', 'SEO');
        advance('seo_reselect_after_reload_dispatched', { trustedInput: true });
        afterReload = await waitObserved(
          'seo_reselect_after_reload_wait',
          () => selectedSeo(panel),
          (state) => state?.selected && state.linked && state.heading,
        );
      }
      assert.equal(
        afterReload.selected && afterReload.linked,
        true,
        'SEO tab restored after reload',
      );
      const reloadedAudit = await waitObserved(
        'seo_reload_current_page_audit_wait',
        () => seoContent(panel),
        (state) =>
          state?.scopeValid &&
          state.title === publicPages[1].title &&
          state.headings === !!publicPages[1].heading &&
          state.reAudit &&
          !state.error,
        30000,
      );
      target('T01', 'reload_audits_current_url', {
        currentUrl: publicPages[1].url,
        currentTitleMatched: reloadedAudit.title === publicPages[1].title,
        headingsPresenceMatched: reloadedAudit.headings === !!publicPages[1].heading,
        reselectedAfterReload,
      });
      const reloadMenu = await copyMenu(panel);
      assert.equal(reloadMenu.choices.includes('JSON'), false, 'guest JSON hidden after reload');
      target('T07', 'guest_role_gate_after_reload', {
        textChoice: reloadMenu.choices.includes('Summary (text)'),
        agentChoice: reloadMenu.choices.includes('For AI agent'),
        jsonAbsent: true,
      });

      // about:blank is a real browser-restricted scheme in the capture
      // contract. Keep the same owned tab and require the previous audit to
      // disappear before testing recovery on a known public page.
      enter('restricted_page_navigation');
      await page.goto('about:blank', { waitUntil: 'domcontentloaded' });
      assert.equal(page.url(), 'about:blank', 'owned tab reached restricted URL');
      advance('restricted_page_loaded', { restrictedScheme: 'about:' });
      const restricted = await waitObserved(
        'restricted_audit_error_wait',
        () => restrictedSeoState(panel),
        (state) =>
          state?.scopeValid &&
          state.expectedErrorVisible &&
          state.staleAuditAbsent &&
          state.copyAuditAbsent &&
          state.retryOffered,
        30000,
      );
      target('T03', 'about_blank_clear_error_without_stale_audit', restricted);

      enter('restricted_recovery_navigation');
      await page.goto(PAGES[0], { waitUntil: 'domcontentloaded' });
      const recoveryPage = await observe('restricted_recovery_page_inspected', () =>
        pageEvidence(page),
      );
      assert.equal(recoveryPage.title, publicPages[0].title, 'known public recovery title');
      advance('restricted_recovery_page_loaded', { title: recoveryPage.title });
      const recovered = await waitObserved(
        'restricted_recovery_audit_wait',
        () => seoContent(panel),
        (state) =>
          state?.scopeValid &&
          state.title === recoveryPage.title &&
          state.headings === !!recoveryPage.heading &&
          state.reAudit &&
          !state.error,
        30000,
      );
      target('T03', 'public_page_recovers_after_restricted_url', {
        publicTitleMatched: recovered.title === recoveryPage.title,
        headingsPresenceMatched: recovered.headings === !!recoveryPage.heading,
        auditErrorAbsent: !recovered.error,
      });

      // Two independent public DOMs give the detail renderer different
      // expected values: the sparse Example page has no description/canonical,
      // while the documentation page supplies both and a real outbound door.
      const sparseExpected = await observe('sparse_public_details_inspected', () =>
        publicDetailEvidence(page),
      );
      assert.equal(sparseExpected.description, null, 'sparse public page has no meta description');
      assert.equal(sparseExpected.canonical, null, 'sparse public page has no canonical link');
      const sparseDetails = await observe('sparse_seo_details_inspected', () =>
        seoDetailState(panel),
      );
      assertPublicDetails(sparseDetails, sparseExpected);
      target('T09', 'sparse_public_detail_groups', {
        descriptionAbsent: sparseExpected.description === null,
        canonicalAbsent: sparseExpected.canonical === null,
        groupsMatchPublicDom: true,
      });

      enter('rich_detail_page_navigation');
      await page.goto(DETAIL_PAGE, { waitUntil: 'domcontentloaded' });
      const richExpected = await observe('rich_public_details_inspected', () =>
        publicDetailEvidence(page),
      );
      assert.ok(
        richExpected.description && richExpected.canonical,
        'public detail page provides description and canonical link',
      );
      assert.notEqual(
        richExpected.title,
        sparseExpected.title,
        'detail pages distinguish fixed audit responses',
      );
      await waitObserved(
        'rich_detail_audit_wait',
        () => seoContent(panel),
        (state) =>
          state?.scopeValid && state.title === richExpected.title && state.reAudit && !state.error,
        30000,
      );
      const richDetails = await observe('rich_seo_details_inspected', () => seoDetailState(panel));
      assertPublicDetails(richDetails, richExpected);
      assert.equal(richDetails.canonical?.target, '_blank', 'canonical offers outbound tab');
      assert.equal(richDetails.canonical?.noopener, true, 'canonical tab does not retain opener');
      assert.equal(richDetails.canonical?.noreferrer, true, 'canonical tab omits referrer');
      target('T09', 'rich_public_detail_groups_and_canonical_door', {
        descriptionMatchesPublicDom: true,
        canonicalMatchesPublicDom: true,
        groupsMatchPublicDom: true,
        outboundAnchorSafe: true,
      });
      enter('canonical_outbound_activation');
      await activateSeoLink(panel, page, 'Title & description', richExpected.canonical);
      target('T09', 'canonical_outbound_opens_expected_public_tab', {
        trustedInput: true,
        destinationMatchesPublicDom: true,
      });
      advance('canonical_outbound_verified', { destinationMatchesPublicDom: true });

      // A second rich page supplies an independent live DOM and browser
      // navigation entry. The collector's values are never used as the oracle.
      enter('next_detail_page_navigation');
      const nextResponse = await page.goto(NEXT_DETAIL_PAGE, { waitUntil: 'load' });
      const nextExpected = await observe('next_public_details_inspected', () =>
        publicNextDetailEvidence(page, nextResponse),
      );
      report.next_detail_public_counts = {
        links: nextExpected.links,
        images: nextExpected.images,
        bodyHasText: nextExpected.bodyHasText,
        alternateCount: nextExpected.alternates.length,
        schemaTypeCount: nextExpected.schemaTypes.length,
      };
      assert.equal(page.url(), NEXT_DETAIL_PAGE, 'owned tab reached the selected public URL');
      assert.ok(nextExpected.title, 'selected public page has a title');
      await waitObserved(
        'next_detail_audit_wait',
        () => seoContent(panel),
        (state) =>
          state?.scopeValid && state.title === nextExpected.title && state.reAudit && !state.error,
        30000,
      );
      const autoDetails = await observe('next_auto_seo_details_inspected', () =>
        seoNextDetailState(panel),
      );
      // Auto-run is a point-in-time snapshot on URL change, which may precede
      // load completion. Record it, but measure exact details after a trusted
      // re-audit against stable public DOM and navigation timing samples.
      report.next_detail_auto_observed = {
        links: autoDetails.links,
        images: autoDetails.images,
        performance: autoDetails.performance,
        exactDataStatus: 'unverified',
      };
      const manualBefore = await observe('next_manual_public_before_inspected', () =>
        publicNextDetailEvidence(page, nextResponse),
      );
      assert.equal(page.url(), NEXT_DETAIL_PAGE, 'manual audit starts on the selected public URL');
      enter('next_manual_reaudit_click');
      await click(panel, 'button', 'Re-audit');
      advance('next_manual_reaudit_click_dispatched', { trustedInput: true });
      await waitObserved(
        'next_manual_reaudit_running_wait',
        () => seoContent(panel),
        (state) => state?.scopeValid && !state.reAudit,
      );
      await waitObserved(
        'next_manual_reaudit_settle_wait',
        () => seoContent(panel),
        (state) =>
          state?.scopeValid && state.title === manualBefore.title && state.reAudit && !state.error,
        30000,
      );
      const manualAfter = await observe('next_manual_public_after_inspected', () =>
        publicNextDetailEvidence(page, nextResponse),
      );
      assert.equal(page.url(), NEXT_DETAIL_PAGE, 'manual audit ends on the selected public URL');
      const publicScalars = (value) => ({
        links: value.links,
        images: value.images,
        bodyHasText: value.bodyHasText,
        alternateCount: value.alternates.length,
        schemaTypeCount: value.schemaTypes.length,
        navigation: value.navigation,
        responseStatus: value.responseStatus,
      });
      report.next_detail_manual_public = {
        before: publicScalars(manualBefore),
        after: publicScalars(manualAfter),
      };
      assertNext('manual_source_stability', () =>
        assert.deepEqual(
          manualAfter,
          manualBefore,
          'public DOM and navigation timing remain stable around manual re-audit',
        ),
      );
      const nextDetails = await observe('next_manual_seo_details_inspected', () =>
        seoNextDetailState(panel),
      );
      assertNext('manual_links', () => assertNextLinks(nextDetails, manualAfter));
      target('T09', 'guest_manual_link_counts_match_live_dom', {
        url: NEXT_DETAIL_PAGE,
        ...manualAfter.links,
      });
      assertNext('manual_images', () => assertNextImages(nextDetails, manualAfter));
      target('T09', 'guest_manual_image_alt_counts_match_live_dom', {
        url: NEXT_DETAIL_PAGE,
        ...manualAfter.images,
      });
      assertNext('manual_readability', () => assertNextReadability(nextDetails, manualAfter));
      if (manualAfter.bodyHasText)
        target('T09', 'guest_manual_readability_display_is_populated_and_explained', {
          publicBodyHasText: true,
          displayed: nextDetails.readability,
          metricValueCorrectness: 'unverified',
        });
      else
        unverifiedTarget(
          'T09',
          'guest_manual_readability_display_is_populated_and_explained',
          'The public body had no text, so populated readability fields could not be exercised.',
        );
      report.next_detail_public_navigation = manualAfter.navigation
        ? {
            type: manualAfter.navigation.type,
            durationMs: manualAfter.navigation.durationMs,
            transferSizeBytes: manualAfter.navigation.transferSizeBytes,
            responseStatus: manualAfter.navigation.responseStatus,
            pageResponseStatus: manualAfter.responseStatus,
          }
        : null;
      assertNext('manual_performance', () => assertNextPerformance(nextDetails, manualAfter));
      target('T09', 'guest_manual_performance_reflects_current_navigation', {
        pageResponseStatus: manualAfter.responseStatus,
        exposedNavigation: manualAfter.navigation,
        displayed: nextDetails.performance,
      });

      // A missing public datum makes the door action unverified; no assumed
      // Wikipedia hreflang or JSON-LD is allowed to turn it green.
      const uniqueAlternate = manualAfter.alternates.find(
        (item) => manualAfter.alternates.filter((other) => other.href === item.href).length === 1,
      );
      let schemaLinks;
      assertNext('manual_doors', () => {
        schemaLinks = assertNextDoors(nextDetails, manualAfter);
      });
      const uniqueSchema = schemaLinks.find(
        (item) => schemaLinks.filter((other) => other.href === item.href).length === 1,
      );
      if (uniqueAlternate && uniqueSchema) {
        enter('hreflang_outbound_activation');
        await activateSeoLink(panel, page, 'International', uniqueAlternate.href);
        enter('schema_outbound_activation');
        await activateSeoLink(panel, page, 'Structured data', uniqueSchema.href);
        target('T09', 'guest_manual_hreflang_and_schema_doors_match_page', {
          hreflang: uniqueAlternate,
          schemaType: uniqueSchema.type,
          schemaUrl: uniqueSchema.href,
          trustedInput: true,
        });
      } else {
        unverifiedTarget(
          'T09',
          'guest_manual_hreflang_and_schema_doors_match_page',
          'The public DOM did not expose unique hreflang and openable schema door candidates.',
        );
      }
      advance('next_manual_detail_batch_observed', {
        sourceUrl: NEXT_DETAIL_PAGE,
        doorStatus: report.targets.at(-1).status,
      });

      // Optional bounded continuation for public sources whose HTTP markup
      // exposes both metadata groups. The default Wikipedia run is unchanged.
      if (RUN_METADATA_FIXTURE) {
        enter('metadata_fixture_page_navigation');
        const fixtureResponse = await page.goto(METADATA_FIXTURE_PAGE, { waitUntil: 'load' });
        const fixtureExpected = await observe('metadata_fixture_public_dom_inspected', () =>
          publicNextDetailEvidence(page, fixtureResponse),
        );
        assert.equal(page.url(), METADATA_FIXTURE_PAGE, 'owned tab reached public fixture URL');
        await waitObserved(
          'metadata_fixture_audit_wait',
          async () => {
            const state = await seoContent(panel);
            const publicDomTitleAtSample = await page.evaluate(() => document.title.trim());
            return {
              ...state,
              expectedPublicTitleAtNavigation: fixtureExpected.title,
              publicDomTitleAtSample,
              publicTitleStable: publicDomTitleAtSample === fixtureExpected.title,
              seoTitleMatchesExpected: state.title === fixtureExpected.title,
            };
          },
          (state) =>
            state?.scopeValid &&
            state.title === fixtureExpected.title &&
            state.reAudit &&
            !state.error,
          30000,
        );
        const fixtureBefore = await observe('metadata_fixture_public_before_inspected', () =>
          publicNextDetailEvidence(page, fixtureResponse),
        );
        enter('metadata_fixture_reaudit_click');
        await click(panel, 'button', 'Re-audit');
        advance('metadata_fixture_reaudit_click_dispatched', { trustedInput: true });
        await waitObserved(
          'metadata_fixture_reaudit_running_wait',
          () => seoContent(panel),
          (state) => state?.scopeValid && !state.reAudit,
        );
        await waitObserved(
          'metadata_fixture_reaudit_settle_wait',
          () => seoContent(panel),
          (state) =>
            state?.scopeValid &&
            state.title === fixtureBefore.title &&
            state.reAudit &&
            !state.error,
          30000,
        );
        const fixtureAfter = await observe('metadata_fixture_public_after_inspected', () =>
          publicNextDetailEvidence(page, fixtureResponse),
        );
        assertNext('metadata_fixture_source_stability', () =>
          assert.deepEqual(
            fixtureAfter,
            fixtureBefore,
            'public metadata and navigation remain stable around manual re-audit',
          ),
        );
        const fixtureDetails = await observe('metadata_fixture_seo_details_inspected', () =>
          seoNextDetailState(panel),
        );
        let fixtureSchemaLinks;
        assertNext('metadata_fixture_doors', () => {
          fixtureSchemaLinks = assertNextDoors(fixtureDetails, fixtureAfter);
        });
        const uniqueFixtureAlternate = fixtureAfter.alternates.find(
          (item) =>
            item.href !== METADATA_FIXTURE_PAGE &&
            fixtureAfter.alternates.filter((other) => other.href === item.href).length === 1,
        );
        const uniqueFixtureSchema = fixtureSchemaLinks.find(
          (item) => fixtureSchemaLinks.filter((other) => other.href === item.href).length === 1,
        );
        if (uniqueFixtureAlternate && uniqueFixtureSchema) {
          enter('metadata_fixture_hreflang_outbound_activation');
          await activateSeoLink(panel, page, 'International', uniqueFixtureAlternate.href);
          enter('metadata_fixture_schema_outbound_activation');
          await activateSeoLink(panel, page, 'Structured data', uniqueFixtureSchema.href);
          target('T09', 'guest_airbnb_hreflang_and_schema_doors_match_public_dom', {
            sourceUrl: METADATA_FIXTURE_PAGE,
            alternate: uniqueFixtureAlternate,
            schemaType: uniqueFixtureSchema.type,
            schemaUrl: uniqueFixtureSchema.href,
            trustedInput: true,
          });
        } else {
          unverifiedTarget(
            'T09',
            'guest_airbnb_hreflang_and_schema_doors_match_public_dom',
            'The live public DOM did not expose unique hreflang and openable schema candidates.',
          );
        }
        advance('metadata_fixture_bounded_observation_complete', {
          sourceUrl: METADATA_FIXTURE_PAGE,
          alternateCount: fixtureAfter.alternates.length,
          schemaTypeCount: fixtureAfter.schemaTypes.length,
          doorStatus: report.targets.at(-1).status,
        });
      }
    },
  });
  report.extension_id = harness.extensionId;
  report.status = 'partial';
} catch (error) {
  report.status = 'unverified';
  report.failure_stage = report.current_operation ?? report.last_safe_stage;
  if (error?.seoDoorDiagnostic) report.door_activation_diagnostic = error.seoDoorDiagnostic;
  process.exitCode = 1;
}
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} seo_guest_native_batch\n`);
