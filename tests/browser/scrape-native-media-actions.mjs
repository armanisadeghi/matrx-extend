import assert from 'node:assert/strict';
import { withClipboardReadPermission } from './clipboard-observation.mjs';
import { activeTabPanelExpression, waitFor } from './settings-panel-driver.mjs';

const diagnostic = (error) => String(error?.message ?? error).slice(0, 120);
export async function waitForMediaCopyTarget(panel, url, evaluate, selectedTab, timeoutMs = 10000) {
  return waitFor(
    'scrape_media_copy_target_ready',
    () =>
      evaluate(
        panel,
        `(() => {
      // copy_target_readiness: opening a row may briefly remount the selected Scrape tab.
      const expectedTab = ${JSON.stringify(selectedTab)};
      const pane = ${activeTabPanelExpression('Scrape')};
      const tab = pane?.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]');
      const content = tab ? document.getElementById(tab.getAttribute('aria-controls') ?? '') : null;
      const rows = [...(content?.querySelectorAll('a') ?? [])]
        .filter((anchor) => anchor.href === ${JSON.stringify(url)});
      const targets = rows.flatMap((anchor) =>
        [...(anchor.parentElement?.querySelectorAll('button[title^="Copy "], button:not([title])[data-matrx-title^="Copy "]') ?? [])]);
      return { selected: tab?.textContent?.trim() === expectedTab, rowCount: rows.length,
        targetCount: targets.length };
    })()`,
      ),
    (state) => state?.selected === true && state.rowCount === 1 && state.targetCount === 1,
    timeoutMs,
  );
}
export async function enterMediaField({
  panel,
  field,
  value,
  resourceAction,
  click,
  observeAction,
}) {
  const run = observeAction ?? ((_kind, _target, action) => action());
  await run('scrape-media-form-field', field, () =>
    resourceAction(() => click(panel, 'scrape-media-form-field', field)),
  );
  await run('scrape-media-field-insert', field, () =>
    resourceAction(() => panel.send('Input.insertText', { text: value })),
  );
}

async function observeOpenedAndCopiedLinks({
  page,
  panel,
  urls,
  resourceAction,
  click,
  evaluate,
  browserSession,
  panelUrl,
  kind,
  observeAction,
}) {
  const run = observeAction ?? ((_kind, _target, action) => action());
  const result = {
    opened_url: null,
    copy_feedback: null,
    clipboard_equal: null,
    clipboard_read: null,
    clipboard_observation: {},
    limitations: [],
    failures: [],
  };
  const newTab = page
    .context()
    .waitForEvent('page', { timeout: 5000 })
    .catch((error) => error);
  await run('scrape-media-open', urls[0], () =>
    resourceAction(() => click(panel, 'scrape-media-open', urls[0])),
  );
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
  result.copy_feedback = await run('scrape-media-copy', urls[1], async () => {
    await waitForMediaCopyTarget(panel, urls[1], evaluate, kind === 'video' ? 'Video' : 'Links');
    await resourceAction(() => click(panel, 'scrape-media-copy', urls[1]));
    return observeCopyFeedback(panel, urls[1], evaluate);
  });
  if (result.copy_feedback === 'failed') {
    result.failures.push(`${kind}_copy_write_failed`);
    return result;
  }
  if (result.copy_feedback !== 'copied') {
    result.limitations.push(`${kind}_copy_feedback_${result.copy_feedback}`);
    return result;
  }
  const read = () => readClipboardEquality(panel, urls[1]);
  let observed;
  try {
    observed = await read();
    result.clipboard_read = observed;
    if (observed.code === 'NotAllowedError' && observed.focused && observed.visible) {
      observed = await withClipboardReadPermission({
        browserSession,
        panel,
        panelUrl,
        read,
        evidence: result.clipboard_observation,
      });
      result.clipboard_read_after_grant = observed;
    }
  } catch {
    if (result.clipboard_observation.clipboardObservationPermissionRestored === false)
      throw new Error('clipboard_observation_permission_restore_unconfirmed');
    result.limitations.push(`${kind}_clipboard_observation_unavailable`);
    return result;
  }
  if (observed.ok === true) {
    result.clipboard_equal = observed.same;
    if (!observed.same) result.failures.push(`${kind}_clipboard_url_mismatch`);
  } else result.limitations.push(`${kind}_clipboard_read_${observed.code}`);
  return result;
}

export async function observeCopyFeedback(panel, url, evaluate) {
  const expression = `(() => {
    const pane = ${activeTabPanelExpression('Scrape')};
    const tab = pane?.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]');
    const content = tab ? document.getElementById(tab.getAttribute('aria-controls') ?? '') : null;
    const matches = [...(content?.querySelectorAll('a') ?? [])]
      .filter(a => a.href === ${JSON.stringify(url)})
      .flatMap(a => [...(a.parentElement?.querySelectorAll('button[title^="Copy "], button:not([title])[data-matrx-title^="Copy "]') ?? [])]);
    if (matches.length !== 1) return 'unobserved';
    if (matches[0].querySelector('svg.text-emerald-500')) return 'copied';
    if (matches[0].querySelector('svg.text-red-500')) return 'failed';
    return 'pending';
  })()`;
  const deadline = Date.now() + 1000;
  do {
    try {
      const feedback = await evaluate(panel, expression);
      if (feedback === 'copied' || feedback === 'failed' || feedback === 'unobserved')
        return feedback;
    } catch {
      return 'unobserved';
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  return 'pending';
}

export async function readClipboardEquality(panel, expected) {
  const response = await panel.send('Runtime.evaluate', {
    expression: `(async () => {
      const focused = document.hasFocus(), visible = document.visibilityState === 'visible';
      try {
        if (!navigator.clipboard?.readText) return {ok:false,code:'api_unavailable',focused,visible};
        return {ok:true,same:(await navigator.clipboard.readText()) === ${JSON.stringify(expected)},focused,visible};
      } catch (error) {
        const names = ['NotAllowedError','SecurityError','NotFoundError','AbortError'];
        return {ok:false,code:names.includes(error?.name) ? error.name : 'other_rejection',focused,visible};
      }
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const value = response.result?.value;
  if (response.exceptionDetails || !value || typeof value !== 'object')
    return { ok: false, code: 'runtime_exception', focused: false, visible: false };
  if (value.ok === true && typeof value.same === 'boolean')
    return {
      ok: true,
      same: value.same,
      focused: value.focused === true,
      visible: value.visible === true,
    };
  const codes = new Set([
    'NotAllowedError',
    'SecurityError',
    'NotFoundError',
    'AbortError',
    'api_unavailable',
    'other_rejection',
  ]);
  return {
    ok: false,
    code: codes.has(value.code) ? value.code : 'other_rejection',
    focused: value.focused === true,
    visible: value.visible === true,
  };
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
