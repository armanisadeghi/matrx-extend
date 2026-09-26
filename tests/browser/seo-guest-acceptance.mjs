#!/usr/bin/env node
/**
 * Guest SEO native-panel acceptance. Root owns release preflight and execution.
 * Break caught: navigation leaves the SEO view showing the previous page's title.
 * Two real public pages have distinct document titles; no response or auth is mocked.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'seo-guest-acceptance.json');
const PAGES = ['https://example.org/', 'https://www.iana.org/domains/reserved'];
const DETAIL_PAGE = 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/link';
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
      part: 'schema chips, hreflang, broken social preview image, readability, performance values, and other URL doors',
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
          (node.getAttribute('property') ?? '').startsWith('og:') ||
          (node.getAttribute('name') ?? '').startsWith('twitter:'),
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

async function activateCanonicalLink(panel, page, expectedHref) {
  // A real mouse press reaches only the scoped, hit-tested canonical anchor.
  // The anchor's href and target are asserted before any outbound navigation.
  const sample = () =>
    evaluate(
      panel,
      `(() => {
    ${SEO_SCOPE}
    if (!linked || tab?.getAttribute('aria-selected') !== 'true') return null;
    const group = [...pane.querySelectorAll('span')]
      .find((node) => node.textContent.trim() === 'Title & description');
    const card = group?.parentElement?.nextElementSibling;
    const label = [...(card?.querySelectorAll('span') ?? [])]
      .find((node) => node.textContent.trim() === 'Canonical');
    const anchors = [...(label?.parentElement?.querySelectorAll('a') ?? [])];
    if (anchors.length !== 1) return { count: anchors.length };
    const anchor = anchors[0];
    anchor.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = anchor.getBoundingClientRect();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    return { count: 1, href: anchor.href, target: anchor.target,
      x, y, width: rect.width, height: rect.height,
      hit: anchor.contains(document.elementFromPoint(x, y)) };
  })()`,
    );
  const first = await sample();
  assert.equal(first?.count, 1, 'unique canonical anchor');
  assert.equal(first.href, expectedHref, 'canonical anchor points to public DOM destination');
  assert.equal(first.target, '_blank', 'canonical opens in a new tab');
  let previous = first;
  for (let index = 0; index < 2; index += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    const current = await sample();
    assert.equal(current?.hit, true, 'canonical link is unobstructed for real pointer');
    assert.ok(current.width > 0 && current.height > 0, 'canonical link has a click area');
    assert.ok(
      Math.abs(previous.x - current.x) < 0.25 && Math.abs(previous.y - current.y) < 0.25,
      'canonical link remains stable',
    );
    previous = current;
  }
  const openedPromise = page.context().waitForEvent('page', { timeout: 20000 });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: previous.x,
    y: previous.y,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: previous.x,
    y: previous.y,
    button: 'left',
    clickCount: 1,
  });
  const opened = await openedPromise;
  try {
    await opened.waitForURL((url) => url.href === expectedHref, { timeout: 20000 });
    assert.equal(opened.url(), expectedHref, 'new tab reaches the public canonical URL');
  } finally {
    await opened.close();
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
      await activateCanonicalLink(panel, page, richExpected.canonical);
      target('T09', 'canonical_outbound_opens_expected_public_tab', {
        trustedInput: true,
        destinationMatchesPublicDom: true,
      });
      advance('canonical_outbound_verified', { destinationMatchesPublicDom: true });
    },
  });
  report.extension_id = harness.extensionId;
  report.status = 'partial';
} catch {
  report.status = 'unverified';
  report.failure_stage = report.current_operation ?? report.last_safe_stage;
  process.exitCode = 1;
}
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} seo_guest_native_batch\n`);
