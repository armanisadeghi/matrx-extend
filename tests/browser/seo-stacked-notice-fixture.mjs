import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { attachTargetSession } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const TITLES = ['SEO fixture notice A', 'SEO fixture notice B'];
const MESSAGES = [
  'The saved audit could not be listed. Open this page again, then try Re-audit.',
  'The saved audit could not be listed after the current page changed. Open this page again and try Re-audit. If the result is still unavailable, check this page and repeat the audit from the SEO panel.',
];

async function sample(panel) {
  return evaluate(
    panel,
    `(() => {
    const titles = ${JSON.stringify(TITLES)};
    const notices = titles.map((title) => [...document.querySelectorAll('[role="alert"]')]
      .filter((node) => node.querySelector('.font-medium')?.textContent.trim() === title));
    const buttons = notices.map((group) => group.flatMap((node) =>
      [...node.querySelectorAll('button[aria-label="Dismiss"]')]));
    const visible = (node) => {
      const rect = node?.getBoundingClientRect(), style = node && getComputedStyle(node);
      return !!rect && rect.width > 0 && rect.height > 0 && rect.left < innerWidth &&
        rect.right > 0 && rect.top < innerHeight && rect.bottom > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden';
    };
    const tab = [...document.querySelectorAll('button[role="tab"][title="SEO"]')]
      .find((node) => !node.closest('[role="tabpanel"]'));
    const pane = tab && document.getElementById(tab.getAttribute('aria-controls') ?? '');
    const targets = [...(pane?.querySelectorAll('button') ?? [])]
      .filter((node) => node.textContent.trim() === 'Re-audit');
    const target = targets.length === 1 ? targets[0] : null;
    target?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = target?.getBoundingClientRect();
    const points = rect ? [0.25, 0.5, 0.75].flatMap((fy) => [0.25, 0.5, 0.75]
      .map((fx) => ({ x: rect.left + rect.width * fx, y: rect.top + rect.height * fy }))) : [];
    const hits = points.map(({ x, y }) => document.elementFromPoint(x, y));
    return { width: innerWidth, title_counts: notices.map((group) => group.length),
      message_lengths: notices.map((group) => group[0]?.querySelector('p')?.textContent.length ?? 0),
      dismiss_counts: buttons.map((group) => group.filter(visible).length),
      notice_visible: notices.map((group) => visible(group[0])),
      target_count: targets.length, target_enabled: target ? !target.disabled : false,
      hit_point_count: hits.filter((hit) => hit === target || target?.contains(hit)).length,
      notice_hit_point_count: hits.filter((hit) => notices.some((group) =>
        group.some((node) => hit === node || node.contains(hit)))).length };
  })()`,
  );
}

function requireSample(s, expectedCounts, expectedMessageLengths) {
  let predicate = 'viewport_width';
  try {
    assert.equal(s.width, 360, 'stacked fixture requires actual native 360px');
    predicate = 'title_counts';
    assert.deepEqual(
      s.title_counts,
      expectedCounts,
      'two distinct NoticeHost cards have expected presence',
    );
    predicate = 'target_count';
    assert.equal(s.target_count, 1, 'one SEO Re-audit target');
    predicate = 'target_enabled';
    assert.equal(s.target_enabled, true, 'Re-audit remains enabled');
    predicate = 'hit_point_count';
    assert.equal(s.hit_point_count, 9, 'Re-audit owns all nine points');
    predicate = 'notice_hit_point_count';
    assert.equal(s.notice_hit_point_count, 0, 'no fixture notice owns a Re-audit point');
    for (let i = 0; i < 2; i++)
      if (expectedCounts[i]) {
        predicate = `notice_visible_${i}`;
        assert.equal(s.notice_visible[i], true, `fixture notice ${i} is visible`);
        predicate = `dismiss_count_${i}`;
        assert.equal(s.dismiss_counts[i], 1, `fixture notice ${i} has a visible Dismiss`);
        predicate = `message_length_${i}`;
        assert.equal(
          s.message_lengths[i],
          expectedMessageLengths[i],
          `fixture notice ${i} keeps its full message`,
        );
      }
  } catch (error) {
    if (error?.code === 'ERR_ASSERTION') {
      // Only fixed predicate names and measured primitives reach the report sanitizer.
      const metrics = {
        viewport_width: [360, s.width],
        title_counts: [expectedCounts, s.title_counts],
        target_count: [1, s.target_count],
        target_enabled: [true, s.target_enabled],
        hit_point_count: [9, s.hit_point_count],
        notice_hit_point_count: [0, s.notice_hit_point_count],
      };
      for (let i = 0; i < 2; i++) {
        metrics[`notice_visible_${i}`] = [true, s.notice_visible?.[i]];
        metrics[`dismiss_count_${i}`] = [1, s.dismiss_counts?.[i]];
        metrics[`message_length_${i}`] = [expectedMessageLengths[i], s.message_lengths?.[i]];
      }
      const [expected, observed] = metrics[predicate];
      error.stackedGeometry = { failed_predicate: predicate, expected, observed, native_sample: s };
    }
    throw error;
  }
}

export async function runStackedSeoNotices({
  panel,
  browserSession,
  panelTarget,
  currentTitle,
  expectedMessageLengths,
  seoContent,
  runReaudit,
  onDiagnostic = () => {},
  io = { click, evaluate, waitFor, sample },
}) {
  let stage = 'message_contract';
  let worker;
  let primaryFailed = false;
  let primaryError;
  let result;
  let diagnostic;
  let failureCode = null;
  let geometryFailure = null;
  const ids = TITLES.map(() => randomUUID());
  const injectedTitles = new Set();
  try {
    assert.deepEqual(
      MESSAGES.map((message) => message.length),
      expectedMessageLengths,
      'fixture messages match the independent length contract',
    );
    stage = 'native_width';
    const extensionId = new URL(panelTarget.url).hostname;
    assert.equal(
      await io.evaluate(panel, 'innerWidth'),
      360,
      'native panel starts at 360px without emulation',
    );
    stage = 'worker_discovery';
    const targets = (await browserSession.send('Target.getTargets')).targetInfos.filter(
      (target) =>
        target.type === 'service_worker' &&
        target.url.startsWith(`chrome-extension://${extensionId}/`),
    );
    assert.equal(targets.length, 1, 'fixture requires one owned extension worker');
    stage = 'worker_attach';
    worker = await attachTargetSession(browserSession, targets[0].targetId);
    stage = 'before_injection';
    const before = await io.sample(panel);
    assert.deepEqual(before.title_counts, [0, 0], 'fixture titles are absent before injection');
    stage = 'notice_injection';
    for (let i = 0; i < 2; i++) {
      const payload = {
        id: ids[i],
        ts: Date.now(),
        tone: 'error',
        title: TITLES[i],
        message: MESSAGES[i],
      };
      injectedTitles.add(TITLES[i]);
      const response = await worker.send('Runtime.evaluate', {
        expression: `chrome.runtime.sendMessage(${JSON.stringify({ __matrx: true, kind: 'db:failure-notice', payload })})`,
        awaitPromise: true,
        returnByValue: true,
      });
      assert.equal(
        response.exceptionDetails,
        undefined,
        'owned worker relayed notice to NoticeHost',
      );
      assert.equal(response.result?.value?.ok, true, 'NoticeHost acknowledged injected notice');
    }
    stage = 'stacked_visible';
    const stacked = await io.waitFor(
      'stacked_notice_visible',
      () => io.sample(panel),
      (s) => s.title_counts?.[0] === 1 && s.title_counts?.[1] === 1,
      10000,
      (s) => ({ counts: s?.title_counts, dismiss: s?.dismiss_counts }),
    );
    stage = 'stacked_geometry';
    requireSample(stacked, [1, 1], expectedMessageLengths);
    stage = 'reaudit';
    await runReaudit();
    stage = 'reaudit_settled';
    const settled = await io.waitFor(
      'stacked_notice_current_page_settled',
      async () => ({
        sample: await io.sample(panel),
        audit: await seoContent(panel),
      }),
      (s) =>
        s.audit?.scopeValid &&
        s.audit.title === currentTitle &&
        s.audit.reAudit &&
        !s.audit.auditButtonDisabled &&
        !s.audit.error,
      30000,
      (s) => ({
        counts: s?.sample?.title_counts,
        scope: s?.audit?.scopeValid,
        currentTitleMatched: s?.audit?.title === currentTitle,
        reAudit: s?.audit?.reAudit,
      }),
    );
    stage = 'settled_geometry';
    requireSample(settled.sample, [1, 1], expectedMessageLengths);
    stage = 'independent_dismiss';
    const dismissed = [];
    for (let i = 0; i < 2; i++) {
      await io.click(panel, 'seo-owned-notice-dismiss', TITLES[i]);
      const state = await io.waitFor(
        `fixture_notice_${i}_dismissed`,
        () => io.sample(panel),
        (s) => s.title_counts?.[i] === 0,
        10000,
        (s) => ({ counts: s?.title_counts, dismiss: s?.dismiss_counts }),
      );
      requireSample(state, i === 0 ? [0, 1] : [0, 0], expectedMessageLengths);
      dismissed.push(state);
    }
    result = {
      viewport_width: 360,
      viewport_source: 'native',
      notice_count: 2,
      long_message_length: expectedMessageLengths[1],
      distinct_notice_titles: 2,
      visible_dismiss_counts: stacked.dismiss_counts,
      target_hit_points: stacked.hit_point_count,
      notice_hit_points: stacked.notice_hit_point_count,
      current_title_matched: true,
      independently_dismissed: dismissed.map((s) => s.title_counts),
      cleared_count: 0,
    };
  } catch (error) {
    primaryFailed = true;
    // Error text, stacks, URLs and arbitrary error properties never enter the receipt.
    failureCode =
      error?.code === 'ERR_ASSERTION'
        ? 'stacked_notice_assertion_failed'
        : 'stacked_notice_operation_failed';
    if (['stacked_geometry', 'settled_geometry', 'independent_dismiss'].includes(stage))
      geometryFailure = error?.stackedGeometry ?? null;
    primaryError = error;
  } finally {
    let cleanupFailed = false;
    const clearedTitles = new Set();
    for (const title of injectedTitles) {
      try {
        const state = await io.sample(panel);
        const index = TITLES.indexOf(title);
        const remaining = state.title_counts?.[index];
        if (remaining === 0) {
          clearedTitles.add(title);
          continue;
        }
        if (remaining !== 1 || state.dismiss_counts?.[index] !== 1) {
          cleanupFailed = true;
          continue;
        }
        await io.click(panel, 'seo-owned-notice-dismiss', title);
        const cleared = await io.waitFor(
          'owned_notice_cleanup_cleared',
          () => io.sample(panel),
          (s) => s.title_counts?.[index] === 0,
          10000,
          (s) => ({ remaining: s?.title_counts?.[index] }),
        );
        if (cleared.title_counts?.[index] !== 0) cleanupFailed = true;
        else clearedTitles.add(title);
      } catch {
        cleanupFailed = true;
      }
    }
    if (worker) {
      try {
        const final = await io.sample(panel);
        for (const title of injectedTitles) {
          if (final.title_counts?.[TITLES.indexOf(title)] === 0) clearedTitles.add(title);
          else {
            clearedTitles.delete(title);
            cleanupFailed = true;
          }
        }
      } catch {
        clearedTitles.clear();
        cleanupFailed = true;
      }
      try {
        await worker.detach();
      } catch {
        cleanupFailed = true;
      }
    }
    diagnostic = {
      failure_code: failureCode,
      stage,
      ...(geometryFailure && { geometry: geometryFailure }),
      cleanup: {
        status: cleanupFailed ? 'failed' : injectedTitles.size ? 'cleared' : 'not_needed',
        attempted_count: injectedTitles.size,
        cleared_count: clearedTitles.size,
        failed_count: injectedTitles.size - clearedTitles.size,
        failure_code: cleanupFailed ? 'stacked_notice_cleanup_failed' : null,
      },
    };
  }
  try {
    await onDiagnostic(diagnostic);
  } catch (error) {
    if (!primaryFailed) throw error;
  }
  if (primaryFailed) throw primaryError;
  assert.equal(
    diagnostic.cleanup.status === 'failed',
    false,
    'owned notice fixture cleanup completed',
  );
  return result;
}
