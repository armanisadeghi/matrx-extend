import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COPY_FIXTURES,
  GUEST_COPY_MENUS,
  copyOracle,
  copyResultMatches,
  menuMatches,
  runGuestCopyMenus,
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
  const stopped = { off: true, top: 150, pageY: 0 };
  assert.equal(scrollSyncMatches(start, followed, stopped), true);
  assert.equal(scrollSyncMatches(start, { ...followed, top: 0 }, stopped), false);
  assert.equal(scrollSyncMatches(start, followed, { ...stopped, top: 80 }), false);
  assert.equal(scrollSyncMatches(start, followed, { ...stopped, pageY: 650 }), false);
  assert.equal(scrollSyncMatches({ ...start, max: 0 }, followed, stopped), false);
});
