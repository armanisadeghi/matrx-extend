import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';
import { screenshotPublicLink, screenshotViewer } from './screenshot-current-controls.mjs';
import { click as currentClick } from './settings-panel-driver.mjs';

const click = process.env.SCREENSHOT_OLD_DRIVER
  ? (
      await import(
        `data:text/javascript;base64,${Buffer.from((await readFile(process.env.SCREENSHOT_OLD_DRIVER, 'utf8')).replace("'./native-oauth-session.mjs'", JSON.stringify(new URL('./native-oauth-session.mjs', import.meta.url).href))).toString('base64')}`
      )
    ).click
  : currentClick;

function fixture() {
  const window = new Window();
  const { document } = window;
  window.innerWidth = 800;
  window.innerHeight = 600;
  document.body.innerHTML = `<button role="tab" title="Screenshots" data-state="active" aria-controls="screens"></button><div id="screens"><div class="group"><button title="View screenshot"><img src="blob:harbor"></button><button title="Open in Files">Files</button></div></div><button title="Open in Files">Unrelated</button>`;
  const hits = [];
  let target;
  window.chrome = { tabs: { query: async () => [{ id: 17 }] } };
  function prepare() {
    for (const element of document.querySelectorAll('button')) {
      element.getBoundingClientRect = () => {
        target = element;
        return { x: 20, y: 20, left: 20, top: 20, right: 120, bottom: 60, width: 100, height: 40 };
      };
      element.scrollIntoView = () => {};
      element.getAnimations = () => [];
    }
    for (const image of document.querySelectorAll('img')) {
      Object.defineProperties(image, {
        complete: { value: true, configurable: true },
        naturalWidth: { value: 320, configurable: true },
      });
    }
  }
  document.elementFromPoint = () => target;
  const panel = {
    async send(method, params) {
      if (method === 'Runtime.evaluate')
        return { result: { value: await window.eval(params.expression) } };
      if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') {
        const label = target.title || target.textContent.trim();
        hits.push(label);
        if (label === 'View screenshot') {
          document.body.insertAdjacentHTML(
            'beforeend',
            '<div role="dialog"><img src="blob:harbor"><button>Share</button><button>Close</button></div>',
          );
          prepare();
        } else if (label === 'Share') {
          document.querySelector('[role="dialog"]').remove();
          document.body.insertAdjacentHTML(
            'beforeend',
            '<div role="dialog"><h2>Share screenshot</h2><p>No share links</p><button>Create public link</button><button>Close</button></div>',
          );
          prepare();
        } else if (label === 'Create public link') {
          document.querySelector('[role="dialog"] p').remove();
          document
            .querySelector('[role="dialog"]')
            .insertAdjacentHTML(
              'beforeend',
              '<div><input aria-label="New public link" value="https://aimatrx.com/r/harborguide"><button>Copy</button></div><div><span>Active</span><input aria-label="Public share link" value="https://aimatrx.com/r/harborguide"><button>Copy</button><button>Revoke</button></div>',
            );
          prepare();
        } else if (label === 'Revoke') {
          target.disabled = true;
          document.querySelector('[role="dialog"] span').textContent = 'Revoked';
          document.querySelector('input[aria-label="New public link"]').parentElement.remove();
        } else if (label === 'Close') document.querySelector('[role="dialog"]').remove();
      }
      return {};
    },
  };
  prepare();
  return { window, panel, hits, document };
}

for (const [label, expected] of [
  ['thumbnail', 'View screenshot'],
  ['icon', 'Open in Files'],
]) {
  test(`trusted ${label} click selects its current screenshot control only`, async () => {
    const f = fixture();
    try {
      await click(f.panel, 'screenshot-open', label);
      assert.deepEqual(f.hits, [expected]);
    } finally {
      await f.window.happyDOM.abort();
    }
  });
}

test('viewer orchestration opens, observes the same loaded image, then closes through native input', async () => {
  const f = fixture();
  try {
    await screenshotViewer(f.panel);
    assert.deepEqual(f.hits, ['View screenshot', 'Close']);
    assert.equal(f.document.querySelector('[role="dialog"]'), null);
  } finally {
    await f.window.happyDOM.abort();
  }
});

test('ambiguous screenshot cards cannot receive native input', async () => {
  const f = fixture();
  f.document.querySelector('#screens').append(f.document.querySelector('.group').cloneNode(true));
  try {
    await assert.rejects(
      click(f.panel, 'screenshot-open', 'thumbnail'),
      (error) => error.driverFailure?.code === 'pointer_target_not_unique',
    );
    assert.deepEqual(f.hits, []);
  } finally {
    await f.window.happyDOM.abort();
  }
});

// This is a harness-boundary test; service success is supplied by the browser fixture,
// so it earns no backend or public-access acceptance credit.
test('public-link orchestration copies the newly created link and revokes only that link', async () => {
  const f = fixture();
  let clipboardObserved = false;
  try {
    await screenshotPublicLink(f.panel, async (url) => {
      assert.equal(url, 'https://aimatrx.com/r/harborguide');
      assert.deepEqual(f.hits, ['View screenshot', 'Share', 'Create public link', 'Copy']);
      clipboardObserved = true;
    });
    assert.equal(clipboardObserved, true);
    assert.deepEqual(f.hits, [
      'View screenshot',
      'Share',
      'Create public link',
      'Copy',
      'Revoke',
      'Close',
    ]);
  } finally {
    await f.window.happyDOM.abort();
  }
});

test('capture runner closes and reopens the loaded viewer before Files navigation', async () => {
  const source = await readFile(
    process.env.SCREENSHOT_OLD_GALLERY_CAPTURE ??
      new URL('screenshot-capture-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf("    stage = 'thumbnail_viewer';");
  const end = source.indexOf("    stage = 'icon_open_in_files';", start);
  const run = new Function(
    'screenshotViewer',
    'panel',
    `return (async()=>{let stage; ${source.slice(start, end)} })();`,
  );
  const f = fixture();
  try {
    await run(screenshotViewer, f.panel);
    assert.deepEqual(f.hits, ['View screenshot', 'Close', 'View screenshot', 'Close']);
    assert.equal(f.document.querySelector('[role="dialog"]'), null);
  } finally {
    await f.window.happyDOM.abort();
  }
});

for (const driver of [
  'screenshot-capture-acceptance.mjs',
  'screenshot-admin-readonly-acceptance.mjs',
]) {
  test(`${driver} gallery counts qualifying paired cards despite stray or malformed controls`, async () => {
    const source = await readFile(
      process.env.SCREENSHOT_OLD_GALLERY_CAPTURE && driver === 'screenshot-capture-acceptance.mjs'
        ? process.env.SCREENSHOT_OLD_GALLERY_CAPTURE
        : process.env.SCREENSHOT_OLD_GALLERY_READONLY &&
            driver === 'screenshot-admin-readonly-acceptance.mjs'
          ? process.env.SCREENSHOT_OLD_GALLERY_READONLY
          : new URL(driver, import.meta.url),
      'utf8',
    );
    const start = source.indexOf('async function gallery(');
    const end = source.indexOf('async function selectedGallery(', start);
    const f = fixture();
    const gallery = new Function(
      'evaluate',
      'ADMIN_EMAIL',
      `${source.slice(start, end)}; return gallery;`,
    )(async (_panel, expression) => f.window.eval(expression), 'admin@admin.com');
    const card =
      '<div class="group"><button title="View screenshot"></button><button title="Open in Files"></button></div>';
    const stray = '<button title="Open in Files">Unrelated pane control</button>';
    const malformed = [
      '<div class="group"><button title="Open in Files"></button></div>',
      '<div class="group"><button title="View screenshot"></button></div>',
      '<div class="group"><button title="View screenshot"></button><button title="Open in Files"></button><button title="Open in Files"></button></div>',
    ];
    try {
      for (const count of [1, 2, 0]) {
        f.document.querySelector('#screens').innerHTML =
          card.repeat(count) + stray + malformed.join('');
        const observed = await gallery(f.panel, 'localhost/harbor');
        assert.equal(observed.cardCount, count);
        assert.equal(observed.filesButtonCount, count);
      }
      f.document.querySelector('#screens').innerHTML = `<div class="group">${card}</div>`;
      assert.equal((await gallery(f.panel, 'localhost/harbor')).cardCount, 1);
      f.document.querySelector('#screens').innerHTML = stray;
      assert.equal((await gallery(f.panel, 'localhost/harbor')).cardCount, 0);
    } finally {
      await f.window.happyDOM.abort();
    }
  });
}
