import assert from 'node:assert/strict';

const diagnostic = (error) => String(error?.message ?? error).slice(0, 120);
export async function enterMediaField({ panel, field, value, resourceAction, click }) {
  await resourceAction(() => click(panel, 'scrape-media-form-field', field));
  await resourceAction(() => panel.send('Input.insertText', { text: value }));
}

async function observeOpenedAndCopiedLinks({
  page,
  panel,
  urls,
  resourceAction,
  click,
  evaluate,
  kind,
}) {
  const result = { opened_url: null, clipboard_url: null, limitations: [], failures: [] };
  const newTab = page
    .context()
    .waitForEvent('page', { timeout: 5000 })
    .catch((error) => error);
  await resourceAction(() => click(panel, 'scrape-media-open', urls[0]));
  try {
    const opened = await newTab;
    if (opened instanceof Error) throw opened;
    try {
      try {
        await opened.waitForLoadState('domcontentloaded', { timeout: 5000 });
      } catch (error) {
        result.limitations.push(`open_load_unavailable:${diagnostic(error)}`);
      }
      const openedUrl = opened.url();
      assert.ok(
        typeof openedUrl === 'string' && openedUrl.length > 0 && openedUrl !== 'about:blank',
        `${kind}_open_url_unavailable`,
      );
      result.opened_url = openedUrl;
      if (result.opened_url !== urls[0])
        result.failures.push(`${kind}_open_url_mismatch:${result.opened_url.slice(0, 120)}`);
    } finally {
      await opened.close();
    }
  } catch (error) {
    result.limitations.push(`open_unavailable:${diagnostic(error)}`);
  }
  await resourceAction(() => click(panel, 'scrape-media-copy', urls[1]));
  try {
    result.clipboard_url = await evaluate(panel, 'navigator.clipboard.readText()');
    assert.equal(typeof result.clipboard_url, 'string', `${kind}_clipboard_unavailable`);
    if (result.clipboard_url !== urls[1])
      result.failures.push(`${kind}_clipboard_url_mismatch:${result.clipboard_url.slice(0, 120)}`);
  } catch (error) {
    result.limitations.push(`copy_unavailable:${diagnostic(error)}`);
  }
  return result;
}

export async function observeVideoLinks(dependencies) {
  return observeOpenedAndCopiedLinks({ ...dependencies, kind: 'video' });
}

export async function observeScrapeLinks(dependencies) {
  return observeOpenedAndCopiedLinks({ ...dependencies, kind: 'link' });
}

export function videoLinksVerdict(...observations) {
  const failures = observations.flatMap((item) => item.failures);
  const remaining = observations.flatMap((item) => item.limitations);
  return {
    status: failures.length ? 'failed' : remaining.length ? 'partial' : 'passed',
    failures,
    remaining,
  };
}
