import { withClipboardReadPermission } from './clipboard-observation.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

export const GUEST_COPY_MENUS = [
  ['Copy capture', null, ['Markdown', 'Plain text', 'Page URL', 'For AI agent']],
  ['Copy article', 'Article', ['Markdown', 'Plain text', 'For AI agent']],
  ['Copy images', 'Images', ['Markdown', 'URLs (one per line)', 'For AI agent']],
  ['Copy videos', 'Video', ['Markdown', 'URLs (one per line)', 'For AI agent']],
  ['Copy links', 'Links', ['Markdown', 'URLs (one per line)', 'For AI agent']],
  ['Copy SEO audit', 'SEO', ['Markdown', 'Plain text', 'For AI agent']],
  ['Copy schema', 'Schema', ['Markdown', 'For AI agent']],
];

export function copyResultMatches(result) {
  return result?.read === true && result?.hasCurrent === true && result?.hasStale === false;
}

const articleScroll = `(() => {
  const rootTab = document.querySelector('button[role="tab"][title="Scrape"][data-state="active"]');
  const root = rootTab ? document.getElementById(rootTab.getAttribute('aria-controls') ?? '') : null;
  const articleTab = [...(root?.querySelectorAll('[role="tablist"] [role="tab"]') ?? [])]
    .find((tab) => tab.firstChild?.textContent?.trim() === 'Article');
  const content = articleTab ? document.getElementById(articleTab.getAttribute('aria-controls') ?? '') : null;
  const scroller = content?.querySelector('.overflow-y-auto');
  const on = root?.querySelector('button[title="Stop following the page scroll"]');
  const off = root?.querySelector('button[title="Sync scroll with the live page"]');
  return { selected: articleTab?.getAttribute('aria-selected') === 'true',
    scrollerCount: scroller ? 1 : 0, top: scroller?.scrollTop ?? null,
    max: scroller ? scroller.scrollHeight - scroller.clientHeight : null,
    on: on != null, off: off != null };
})()`;

export function scrollSyncMatches(start, followed, stopped) {
  return (
    start?.selected === true &&
    start?.scrollerCount === 1 &&
    start.max > 80 &&
    start.off === true &&
    followed?.on === true &&
    followed.top > start.top + 20 &&
    stopped?.off === true &&
    Math.abs(stopped.top - followed.top) < 4
  );
}

export async function runGuestScrollSync({ panel, page, resourceAction }) {
  await resourceAction(() => click(panel, 'scrape-result-tab', 'Article'));
  await page.evaluate(() => window.scrollTo(0, 0));
  const start = await evaluate(panel, articleScroll);
  if (!(start?.max > 80)) throw new Error('scroll_sync_fixture_not_scrollable');
  await resourceAction(() => click(panel, 'title', 'Sync scroll with the live page'));
  await page.mouse.wheel(0, 650);
  const followed = await waitFor(
    'article_follows_owned_page_scroll',
    () => evaluate(panel, articleScroll),
    (sample) => sample?.on === true && sample.top > start.top + 20,
  );
  await resourceAction(() => click(panel, 'title', 'Stop following the page scroll'));
  await page.mouse.wheel(0, -650);
  await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  const stopped = await evaluate(panel, articleScroll);
  await page.evaluate(() => window.scrollTo(0, 0));
  return { start, followed, stopped, passed: scrollSyncMatches(start, followed, stopped) };
}

async function menuLabels(panel) {
  return evaluate(
    panel,
    `(() => [...document.querySelectorAll('[data-radix-popper-content-wrapper] button')]
    .map((button) => button.querySelector('span.truncate')?.textContent.trim())
    .filter(Boolean))()`,
  );
}

export function menuMatches(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((label, index) => actual[index] === label)
  );
}

export async function runGuestCopyMenus({
  panel,
  browserSession,
  panelUrl,
  origin,
  resourceAction,
}) {
  const evidence = [];
  for (const [title, tab, options] of GUEST_COPY_MENUS) {
    if (tab) await resourceAction(() => click(panel, 'scrape-result-tab', tab));
    for (const option of options) {
      await resourceAction(() => click(panel, 'title', title));
      const labels = await waitFor(
        `copy_menu_${title}_${option}`,
        () => menuLabels(panel),
        (actual) => menuMatches(actual, options),
      );
      await resourceAction(() => click(panel, 'scrape-copy-option', option));
      const permissionEvidence = {};
      const expected =
        title === 'Copy capture' && option === 'Page URL'
          ? `${origin}/intake`
          : title === 'Copy images'
            ? '/intake.svg'
            : title === 'Copy videos'
              ? '/intake-walkthrough.mp4'
              : title === 'Copy links'
                ? '/forms'
                : title === 'Copy schema'
                  ? 'Dentist'
                  : 'Harbor Dental';
      const copied = await withClipboardReadPermission({
        browserSession,
        panel,
        panelUrl,
        evidence: permissionEvidence,
        read: () =>
          evaluate(
            panel,
            `(async () => {
          const value = await navigator.clipboard.readText();
          return { read: true, hasCurrent: value.includes(${JSON.stringify(expected)}),
            hasStale: value.includes('Referral coordinators answer weekday calls.') };
        })()`,
          ),
      });
      const entry = {
        title,
        option,
        menuCorrect: menuMatches(labels, options),
        copied,
        permissionRestored: permissionEvidence.clipboardObservationPermissionRestored,
      };
      evidence.push(entry);
      if (!entry.menuCorrect || !copyResultMatches(copied) || !entry.permissionRestored)
        throw new Error(`scrape_copy_mismatch:${title}:${option}`);
    }
  }
  return evidence;
}

export async function runGuestCopyAfterNavigation({
  panel,
  browserSession,
  panelUrl,
  origin,
  resourceAction,
}) {
  const evidence = [];
  for (const [title, tab, option, expected] of [
    ['Copy capture', null, 'Page URL', `${origin}/referrals`],
    ['Copy article', 'Article', 'Markdown', 'Referral coordinators answer weekday calls.'],
  ]) {
    if (tab) await resourceAction(() => click(panel, 'scrape-result-tab', tab));
    await resourceAction(() => click(panel, 'title', title));
    await waitFor(
      `copy_current_${title}`,
      () => menuLabels(panel),
      (labels) => labels.includes(option),
    );
    await resourceAction(() => click(panel, 'scrape-copy-option', option));
    const permissionEvidence = {};
    const copied = await withClipboardReadPermission({
      browserSession,
      panel,
      panelUrl,
      evidence: permissionEvidence,
      read: () =>
        evaluate(
          panel,
          `(async () => {
        const value = await navigator.clipboard.readText();
        return { read: true, hasCurrent: value.includes(${JSON.stringify(expected)}),
          hasStale: value.includes('Harbor Dental intake guide') };
      })()`,
        ),
    });
    evidence.push({
      title,
      option,
      copied,
      permissionRestored: permissionEvidence.clipboardObservationPermissionRestored,
    });
    if (!copyResultMatches(copied) || !permissionEvidence.clipboardObservationPermissionRestored)
      throw new Error(`scrape_copy_stale_after_navigation:${title}:${option}`);
  }
  return evidence;
}
