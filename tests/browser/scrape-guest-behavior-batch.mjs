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

export const COPY_FIXTURES = {
  intake: {
    path: '/intake',
    title: 'Harbor Dental intake guide',
    article: 'New patients can review appointment timing, forms, and arrival instructions',
    image: '/intake.svg',
    imageAlt: 'New patient intake desk',
    video: '/intake-walkthrough.mp4',
    link: '/forms',
    linkText: 'Patient forms',
    schema: 'Dentist',
    stale: 'Referral coordinators answer weekday calls.',
  },
  referrals: {
    path: '/referrals',
    title: 'Harbor Dental referral hours',
    article: 'Referral coordinators answer weekday calls.',
    image: null,
    imageAlt: null,
    video: null,
    link: null,
    linkText: null,
    schema: null,
    stale: 'Harbor Dental intake guide',
  },
};

// An independent, fixture-specific oracle runs inside the extension so raw
// clipboard content never enters the receipt. No product converter is imported.
export function copyOracle(value, sentinel, title, option, fixture, origin) {
  if (typeof value !== 'string' || value === sentinel || value.includes(fixture.stale))
    return false;
  const url = `${origin}${fixture.path}`;
  if (title === 'Copy capture' && option === 'Page URL') return value === url;
  const ai = option === 'For AI agent';
  const markdown = option === 'Markdown';
  const plain = option === 'Plain text';
  const urls = option === 'URLs (one per line)';
  if (ai) {
    const description = {
      'Copy capture': 'a full Matrx scrape result',
      'Copy article': 'an article scraped',
      'Copy images': 'a list of images extracted',
      'Copy videos': 'a list of video sources extracted',
      'Copy links': 'a list of links extracted',
      'Copy SEO audit': 'an SEO audit for a webpage',
      'Copy schema': 'metadata + JSON-LD schema extracted',
    }[title];
    if (
      !value.startsWith(`The following is ${description}`) ||
      !value.includes(`- Source URL: ${url}`) ||
      !value.includes('```markdown\n')
    )
      return false;
  } else if (value.startsWith('The following is ') || value.includes('- Source URL: '))
    return false;
  if (title === 'Copy capture') {
    if (!value.includes(fixture.article) || !value.includes(fixture.title)) return false;
    return (
      ai ||
      (markdown
        ? value.startsWith(`# ${fixture.title}`) &&
          value.includes('## SEO audit') &&
          value.includes('## Metadata & schema')
        : plain && !value.includes(`# ${fixture.title}`) && value.includes('SEO audit'))
    );
  }
  if (title === 'Copy article') {
    if (!value.includes(fixture.article)) return false;
    return (
      ai ||
      (markdown
        ? value.startsWith(`# ${fixture.title}`) && !value.includes('## Images')
        : plain &&
          value.startsWith(fixture.title) &&
          !value.includes(`# ${fixture.title}`) &&
          !value.includes('SEO audit'))
    );
  }
  if (title === 'Copy SEO audit') {
    if (!value.includes(fixture.title) || !value.includes(url)) return false;
    return (
      ai ||
      (markdown
        ? value.startsWith('## SEO audit') && value.includes('**Title**')
        : plain && value.startsWith('SEO audit') && !value.includes('**Title**'))
    );
  }
  if (title === 'Copy schema') {
    if (!value.includes('"metadata"') || !value.includes(fixture.title)) return false;
    return (
      (ai || (markdown && value.startsWith('## Metadata & schema'))) &&
      (fixture.schema === null || value.includes(`"@type": "${fixture.schema}"`))
    );
  }
  const media = {
    'Copy images': { heading: 'Images', path: fixture.image, label: fixture.imageAlt },
    'Copy videos': { heading: 'Videos', path: fixture.video },
    'Copy links': { heading: 'Links', path: fixture.link, label: fixture.linkText },
  }[title];
  if (!media) return false;
  if (urls) {
    if (!media.path) return value === '';
    const lines = value.split('\n');
    return (
      lines.length > 0 &&
      lines.every((line) => line.startsWith(origin)) &&
      lines.includes(`${origin}${media.path}`) &&
      !value.includes('## ')
    );
  }
  if (media.path) {
    if (!value.includes(`${origin}${media.path}`)) return false;
    if (media.label && !value.includes(media.label)) return false;
  } else if (!value.includes(`_No ${media.heading.toLowerCase()} on this page._`)) return false;
  return (
    ai ||
    (markdown &&
      (media.path ? value.startsWith(`## ${media.heading} (`) : value.startsWith('_No ')))
  );
}

export function copyResultMatches(result) {
  return (
    result?.read === true && result?.formatCorrect === true && result?.sentinelReplaced === true
  );
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
    start.pageY === 0 &&
    followed?.on === true &&
    followed.pageY > 200 &&
    followed.top > start.top + 20 &&
    stopped?.off === true &&
    stopped.pageY < followed.pageY &&
    Math.abs(stopped.top - followed.top) < 4
  );
}

export async function runGuestScrollSync({ panel, page, resourceAction }) {
  await resourceAction(() => click(panel, 'scrape-result-tab', 'Article'));
  await page.evaluate(() => window.scrollTo(0, 0));
  const start = await evaluate(panel, articleScroll);
  start.pageY = await page.evaluate(() => window.scrollY);
  if (!(start?.max > 80)) throw new Error('scroll_sync_fixture_not_scrollable');
  await resourceAction(() => click(panel, 'title', 'Sync scroll with the live page'));
  await page.mouse.wheel(0, 650);
  const followed = await waitFor(
    'article_follows_owned_page_scroll',
    () => evaluate(panel, articleScroll),
    (sample) => sample?.on === true && sample.top > start.top + 20,
  );
  followed.pageY = await page.evaluate(() => window.scrollY);
  await resourceAction(() => click(panel, 'title', 'Stop following the page scroll'));
  await page.mouse.wheel(0, -650);
  await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  const stopped = await evaluate(panel, articleScroll);
  stopped.pageY = await page.evaluate(() => window.scrollY);
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
  fixtureKey,
  resourceAction,
}) {
  const fixture = COPY_FIXTURES[fixtureKey];
  if (!fixture) throw new Error('scrape_copy_fixture_unknown');
  const evidence = [];
  for (const [title, tab, options] of GUEST_COPY_MENUS) {
    if (tab) await resourceAction(() => click(panel, 'scrape-result-tab', tab));
    for (const option of options) {
      const sentinel = `MATRX_QA_COPY_SENTINEL:${fixtureKey}:${title}:${option}`;
      const seeded = await evaluate(
        panel,
        `(async () => {
        await navigator.clipboard.writeText(${JSON.stringify(sentinel)});
        return true;
      })()`,
      );
      if (seeded !== true) throw new Error(`scrape_copy_sentinel_not_seeded:${title}:${option}`);
      await resourceAction(() => click(panel, 'title', title));
      const labels = await waitFor(
        `copy_menu_${title}_${option}`,
        () => menuLabels(panel),
        (actual) => menuMatches(actual, options),
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
          const oracle = ${copyOracle.toString()};
          const value = await navigator.clipboard.readText();
          const sentinel = ${JSON.stringify(sentinel)};
          return { read: true, sentinelReplaced: value !== sentinel,
            formatCorrect: oracle(value, sentinel, ${JSON.stringify(title)},
              ${JSON.stringify(option)}, ${JSON.stringify(fixture)}, ${JSON.stringify(origin)}) };
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
