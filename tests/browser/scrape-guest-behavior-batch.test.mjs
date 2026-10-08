import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  COPY_FIXTURES,
  GUEST_COPY_MENUS,
  copyOracle,
  copyResultMatches,
  menuMatches,
  retainCopyTargetContext,
  runGuestCopyMenus,
  runGuestScrollSync,
  scrollSyncMatches,
} from './scrape-guest-behavior-batch.mjs';

test('copy verdict rejects unchanged clipboard and wrong selected representation', () => {
  const origin = 'http://127.0.0.1:65000';
  const fixture = COPY_FIXTURES.intake;
  const sentinel = 'MATRX_QA_COPY_SENTINEL';
  const markdown = `# ${fixture.title}\n${fixture.article}\n## SEO audit\n## Metadata & schema`;
  const plain = `${fixture.title}\n${fixture.article}\nSEO audit\nMetadata & schema`;
  assert.equal(copyOracle(markdown, sentinel, 'Copy capture', 'Markdown', fixture, origin), true);
  assert.equal(copyOracle(plain, sentinel, 'Copy capture', 'Plain text', fixture, origin), true);
  assert.equal(copyOracle(sentinel, sentinel, 'Copy capture', 'Markdown', fixture, origin), false);
  assert.equal(copyOracle(plain, sentinel, 'Copy capture', 'Markdown', fixture, origin), false);
  assert.equal(
    copyOracle(markdown, sentinel, 'Copy capture', 'Plain text', fixture, origin),
    false,
  );
  assert.equal(copyOracle(plain, sentinel, 'Copy article', 'Plain text', fixture, origin), false);
  assert.equal(
    copyOracle(
      `${markdown}\n${fixture.stale}`,
      sentinel,
      'Copy capture',
      'Markdown',
      fixture,
      origin,
    ),
    false,
  );
  assert.equal(
    copyOracle(`${origin}/intake`, sentinel, 'Copy capture', 'Page URL', fixture, origin),
    true,
  );
  assert.equal(
    copyOracle(`${origin}/referrals`, sentinel, 'Copy capture', 'Page URL', fixture, origin),
    false,
  );
  assert.equal(
    copyResultMatches({ read: true, formatCorrect: true, sentinelReplaced: true }),
    true,
  );
  assert.equal(
    copyResultMatches({ read: true, formatCorrect: true, sentinelReplaced: false }),
    false,
  );
  assert.equal(
    copyResultMatches({ read: true, formatCorrect: false, sentinelReplaced: true }),
    false,
  );
  const labels = GUEST_COPY_MENUS[0][2];
  assert.equal(menuMatches(labels, labels), true);
  assert.equal(menuMatches(labels.slice(1), labels), false);
  assert.equal(menuMatches([...labels, 'Full capture (JSON)'], labels), false);
});

test('Copy capture failure observes real DOM states and forwards only bounded receipt data', async () => {
  const secret = 'PRIVATE_PAGE_BODY_AND_TOKEN';
  for (const state of ['inactive', 'missing', 'aria-only', 'title']) {
    const window = new Window();
    const control =
      state === 'aria-only'
        ? '<button aria-label="Copy capture">Copy</button>'
        : state === 'title'
          ? '<button title="Copy capture" aria-label="Copy capture">Copy</button>'
          : '';
    const result =
      state === 'missing'
        ? ''
        : `<div role="tablist"><button role="tab" aria-selected="true" aria-controls="article-pane">Article</button></div>
        <div id="article-pane" data-state="active">${secret}</div>`;
    window.document.body.innerHTML = `<button role="tab" title="Scrape" data-state="${state === 'inactive' ? 'inactive' : 'active'}" aria-controls="scrape-pane">Scrape</button>
      <section id="scrape-pane" role="tabpanel" data-state="active">
        ${control}
        ${result}
        ${state === 'missing' ? 'A capture from a previous page is retained. Capture this page to extract content.' : ''}
      </section>`;
    const article = window.document.getElementById('article-pane');
    if (article) article.getBoundingClientRect = () => ({ height: 40 });
    const failure = new Error('unique visible pointer target');
    failure.driverFailure = { code: 'pointer_target_not_unique', matchedTargetCount: 0 };
    let observations = 0;
    await assert.rejects(
      runGuestCopyMenus({
        panel: {},
        browserSession: {},
        panelUrl: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/panel.html',
        origin: 'http://127.0.0.1:65000',
        fixtureKey: 'referrals',
        resourceAction: (action) => action(),
        menus: [['Copy capture', null, ['Markdown']]],
        adapters: {
          click: async () => {
            throw failure;
          },
          evaluate: async (_panel, expression) => {
            if (expression.includes('MATRX_QA_COPY_SENTINEL')) return true;
            observations++;
            return window.eval(expression);
          },
        },
      }),
      (caught) => caught === failure,
    );
    assert.equal(observations, 1);
    const receipt = {};
    retainCopyTargetContext(receipt, failure);
    const serialized = JSON.parse(JSON.stringify(receipt));
    assert.deepEqual(serialized, {
      copy_target_context: {
        activeScrapeTabs: state === 'inactive' ? 0 : 1,
        activeScrapePanel: state !== 'inactive',
        copyTitleCount: state === 'title' ? 1 : 0,
        copyDataTitleCount: 0,
        copyAriaLabelCount: state === 'aria-only' || state === 'title' ? 1 : 0,
        captureContentVisible: state !== 'inactive' && state !== 'missing',
        previousPageBanner: state === 'missing',
        emptyPrompt: state === 'missing',
      },
    });
    assert.equal(JSON.stringify(serialized).includes(secret), false);
    assert.equal(
      Object.values(serialized.copy_target_context).every(
        (value) => typeof value === 'boolean' || Number.isInteger(value),
      ),
      true,
    );
  }
});

test('copy oracle separates section formats, empty URL lists and page freshness', () => {
  const origin = 'http://127.0.0.1:65000';
  const intake = COPY_FIXTURES.intake;
  const referrals = COPY_FIXTURES.referrals;
  const sentinel = 'SENTINEL';
  const imageMd = `## Images (1)\n- ![${intake.imageAlt}](${origin}${intake.image})`;
  assert.equal(copyOracle(imageMd, sentinel, 'Copy images', 'Markdown', intake, origin), true);
  assert.equal(
    copyOracle(imageMd, sentinel, 'Copy images', 'URLs (one per line)', intake, origin),
    false,
  );
  assert.equal(
    copyOracle(
      `${origin}${intake.image}`,
      sentinel,
      'Copy images',
      'URLs (one per line)',
      intake,
      origin,
    ),
    true,
  );
  assert.equal(
    copyOracle('', sentinel, 'Copy images', 'URLs (one per line)', referrals, origin),
    true,
  );
  assert.equal(
    copyOracle(
      `${origin}${intake.image}`,
      sentinel,
      'Copy images',
      'URLs (one per line)',
      referrals,
      origin,
    ),
    false,
  );
  assert.equal(
    copyOracle('_No links on this page._', sentinel, 'Copy links', 'Markdown', referrals, origin),
    true,
  );
  assert.equal(
    copyOracle(
      `# ${intake.title}\n${intake.article}`,
      sentinel,
      'Copy article',
      'Markdown',
      referrals,
      origin,
    ),
    false,
  );
});

test('schema AI uses JSON fence; wrong fence, no-op, stale and wrong option fail the actual copy loop', async () => {
  const origin = 'http://127.0.0.1:65000';
  const fixture = COPY_FIXTURES.intake;
  const body = JSON.stringify(
    { metadata: { title: fixture.title }, ld_json: [{ '@type': 'Dentist' }] },
    null,
    2,
  );
  const samples = {
    Markdown: `## Metadata & schema\n\n\`\`\`json\n${body}\n\`\`\``,
    JSON: body,
    'For AI agent': `The following is metadata + JSON-LD schema extracted from a webpage.\n\n- Source URL: ${origin}/intake\n\n\`\`\`json\n${body}\n\`\`\``,
  };
  const wrongFence = samples['For AI agent'].replace('```json', '```markdown');
  assert.equal(
    copyOracle(samples['For AI agent'], 'seed', 'Copy schema', 'For AI agent', fixture, origin),
    true,
  );
  assert.equal(
    copyOracle(wrongFence, 'seed', 'Copy schema', 'For AI agent', fixture, origin),
    false,
  );
  assert.equal(copyOracle(samples.JSON, 'seed', 'Copy schema', 'JSON', fixture, origin), true);
  assert.equal(copyOracle(samples.Markdown, 'seed', 'Copy schema', 'JSON', fixture, origin), false);

  async function exercise(producer) {
    let clipboard = '';
    const navigator = {
      clipboard: {
        writeText: async (value) => {
          clipboard = value;
        },
        readText: async () => clipboard,
      },
    };
    return runGuestCopyMenus({
      panel: {},
      browserSession: {},
      panelUrl: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/panel.html',
      origin,
      fixtureKey: 'intake',
      resourceAction: (action) => action(),
      menus: [['Copy schema', 'Schema', ['Markdown', 'JSON', 'For AI agent']]],
      adapters: {
        click: async (_panel, kind, option) => {
          if (kind === 'scrape-copy-option') clipboard = producer(option, clipboard);
        },
        evaluate: async (_panel, expression) => {
          if (expression.includes('[data-radix-popper-content-wrapper]'))
            return ['Markdown', 'JSON', 'For AI agent'];
          return Function('navigator', `return ${expression}`)(navigator);
        },
        waitFor: async (_label, read, accept) => {
          const value = await read();
          if (!accept(value)) throw new Error('menu_not_observed');
          return value;
        },
        withClipboardReadPermission: async ({ read, evidence }) => {
          const result = await read();
          evidence.clipboardObservationPermissionRestored = true;
          return result;
        },
      },
    });
  }
  assert.equal((await exercise((option) => samples[option])).length, 3);
  await assert.rejects(() => exercise((_option, prior) => prior), /scrape_copy_mismatch/);
  await assert.rejects(
    () => exercise((option) => (option === 'JSON' ? samples.Markdown : samples[option])),
    /scrape_copy_mismatch:Copy schema:JSON/,
  );
  await assert.rejects(
    () => exercise((option) => (option === 'For AI agent' ? wrongFence : samples[option])),
    /scrape_copy_mismatch:Copy schema:For AI agent/,
  );
  await assert.rejects(
    () => exercise((option) => `${samples[option]}\n${fixture.stale}`),
    /scrape_copy_mismatch/,
  );
});

test('scroll verdict requires real movement while on and no movement after off', () => {
  const start = { selected: true, scrollerCount: 1, max: 300, off: true, top: 0, pageY: 0 };
  const followed = { on: true, top: 150, pageY: 650 };
  const armed = { off: true, on: false, top: 150, pageY: 650 };
  const stopped = { off: true, on: false, top: 150, pageY: 0 };
  assert.equal(scrollSyncMatches(start, followed, armed, stopped), true);
  assert.equal(scrollSyncMatches(start, { ...followed, top: 0 }, armed, stopped), false);
  assert.equal(scrollSyncMatches(start, followed, { ...armed, top: 0 }, stopped), false);
  assert.equal(scrollSyncMatches(start, followed, armed, { ...stopped, top: 0 }), false);
  assert.equal(scrollSyncMatches(start, followed, armed, { ...stopped, pageY: 650 }), false);
  assert.equal(scrollSyncMatches({ ...start, max: 0 }, followed, armed, stopped), false);
});

test('scroll exercise holds an article position established after the trusted stop click', async () => {
  const exercise = async (stopWorks) => {
    let pageY = 0;
    let articleTop = 0;
    let following = false;
    const state = () => ({
      selected: true,
      scrollerCount: 1,
      max: 1505,
      top: articleTop,
      on: following,
      off: !following,
    });
    return runGuestScrollSync({
      panel: {},
      page: {
        evaluate: async (fn) => {
          if (String(fn).includes('scrollTo')) pageY = 0;
          return pageY;
        },
        mouse: {
          wheel: async (_x, delta) => {
            pageY = Math.max(0, pageY + delta);
            if (following) articleTop = pageY === 0 ? 0 : 310;
          },
        },
      },
      resourceAction: (action) => action(),
      adapters: {
        click: async (_panel, _kind, label) => {
          if (label === 'Sync scroll with the live page') following = true;
          if (label === 'Stop following the page scroll') {
            // The real pointer driver's scrollIntoView moves this control and
            // its article scroller to the top before it dispatches the click.
            articleTop = 0;
            if (stopWorks) following = false;
          }
        },
        evaluate: async () => state(),
        waitFor: async (_name, sample, condition) => {
          const result = await sample();
          assert.equal(condition(result), true);
          return result;
        },
        armArticleScroll: async (_panel, top) => {
          articleTop = top;
          return articleTop > 20;
        },
      },
    });
  };
  const correct = await exercise(true);
  assert.equal(correct.followed.top, 310);
  assert.equal(correct.armed.top, 310);
  assert.equal(correct.stopped.top, 310);
  assert.equal(correct.passed, true);
  const broken = await exercise(false);
  assert.equal(broken.armed.top, 310);
  assert.equal(broken.stopped.top, 0);
  assert.equal(broken.passed, false);
});
