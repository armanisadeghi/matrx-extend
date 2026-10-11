import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Window } from 'happy-dom';
import { writeSeoGuestProgress } from '../../scripts/hosted-seo-route.mjs';
import { safeSeoClickEvidence } from './guest-seo-click-diagnostic.mjs';
import {
  captureReauditWaitFailure,
  reauditSettledOnCurrentPage,
  reauditTransitionWitness,
  safeReauditState,
  startSeoReauditTrace,
} from './seo-reaudit-transition-diagnostic.mjs';
import { waitFor } from './settings-panel-driver.mjs';

// SUT owns pre-click DOM observation, bounded transition history, timeout
// classification and receipt sanitization; only the CDP transport is replaced.
// Use case: guest audits the current page while a saved-history refusal persists.
async function scenario(action) {
  const window = new Window();
  const report = {};
  const panel = {
    async send(method, args) {
      assert.equal(method, 'Runtime.evaluate');
      return { result: { value: JSON.parse(JSON.stringify(window.eval(args.expression))) } };
    },
  };
  window.document.body.innerHTML = `<button role="tab" title="SEO" aria-selected="true"
    aria-controls="seo-pane"></button><div id="seo-pane" role="tabpanel" data-state="active">
    <button>Re-audit</button><div>private account text</div></div>`;
  const button = window.document.querySelector('#seo-pane button');
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  try {
    const trace = await startSeoReauditTrace(panel, report);
    await action({ button, report, trace, flush, window });
    await trace.stop();
    assert.equal(
      window.__matrxSeoReauditTrace,
      undefined,
      'observer is removed after final capture',
    );
    const stopped = JSON.stringify(report);
    button.disabled = !button.disabled;
    await flush();
    assert.equal(JSON.stringify(report), stopped, 'stopped observer cannot append samples');
    return report.reaudit_transition_diagnostic;
  } finally {
    window.happyDOM.abort();
  }
}

test('observer retains busy then idle before the first post-release poll', async () => {
  const trace = await scenario(async ({ button, trace, flush }) => {
    button.disabled = true;
    await flush();
    button.disabled = false;
    await flush();
    await trace.sample('after_release');
  });
  assert.deepEqual(
    trace.samples.map((value) => [value.stage, value.reAudit]),
    [
      ['before_click', true],
      ['dom_transition', false],
      ['dom_transition', true],
      ['after_release', true],
      ['finished', true],
    ],
  );
  assert.equal(trace.sample_count, 5);
  assert.equal(trace.dropped_samples, 0);
  assert.equal(trace.failure, undefined);
  assert.ok(trace.samples.every((value) => Number.isSafeInteger(value.elapsed_ms)));
  assert.doesNotMatch(JSON.stringify(trace), /private account text/);
});

test('unchanged DOM and real wait timeout preserve fixed predicate and final booleans without page text', async () => {
  const trace = await scenario(async ({ report, trace }) => {
    await trace.sample('after_release');
    const last = { scopeValid: true, reAudit: true, error: false, title: 'private account text' };
    await assert.rejects(async () => {
      try {
        await waitFor(
          'manual_reaudit_running_wait',
          async () => last,
          (value) => value.scopeValid && value.reAudit === false,
          0,
        );
      } catch (error) {
        report.reaudit_transition_diagnostic.failure = captureReauditWaitFailure(
          error,
          'manual_reaudit_running_wait',
          last,
        );
        throw error;
      }
    }, /manual_reaudit_running_wait_not_observed/);
  });
  assert.deepEqual(
    trace.samples.map((value) => value.reAudit),
    [true, true, true],
  );
  assert.equal(trace.failure.code, 'wait_timeout');
  assert.equal(trace.failure.operation, 'manual_reaudit_running_wait');
  assert.deepEqual(trace.failure.last_state, {
    scopeValid: true,
    auditButtonPresent: null,
    auditButtonDisabled: null,
    auditSpinner: null,
    reAudit: true,
    error: false,
  });
  assert.doesNotMatch(JSON.stringify(trace), /private account text|title/);
});

test('transition buffer retains baseline and latest state and announces dropped samples', async () => {
  const trace = await scenario(async ({ button, trace, flush }) => {
    for (let index = 0; index < 80; index++) {
      button.disabled = index % 2 === 0;
      await flush();
    }
    await trace.sample('after_release');
  });
  assert.equal(trace.samples.length, 64);
  assert.equal(trace.sample_count, 83);
  assert.equal(trace.dropped_samples, 19);
  assert.equal(trace.samples[0].stage, 'before_click');
  assert.equal(trace.samples[1].reAudit, false);
  assert.equal(trace.samples[2].reAudit, true);
  assert.equal(trace.samples[31].reAudit, false);
  assert.equal(trace.samples.at(-1).stage, 'finished');
  assert.equal(trace.samples.at(-1).reAudit, true);
});

test('receipt revalidates hostile fields and transport failure remains observation unavailable', async () => {
  const report = {};
  const trace = await startSeoReauditTrace(
    {
      send: async () => {
        throw new Error('private account text');
      },
    },
    report,
  );
  await trace.stop();
  assert.equal(report.reaudit_transition_diagnostic.observer_available, false);
  const receipt = safeSeoClickEvidence({
    reaudit_transition_diagnostic: {
      observer_available: 'private account text',
      sample_count: -1,
      dropped_samples: 0,
      samples: [
        {
          stage: 'private account text',
          elapsed_ms: Number.POSITIVE_INFINITY,
          reAudit: 'private account text',
          title: 'private account text',
        },
      ],
      failure: {
        code: 'private account text',
        operation: 'private account text',
        last_state: { error: true, title: 'private account text' },
      },
    },
  }).reaudit_transition_diagnostic;
  assert.equal(receipt.observer_available, null);
  assert.equal(receipt.samples[0].stage, null);
  assert.equal(receipt.samples[0].elapsed_ms, null);
  assert.equal(receipt.failure.code, 'wait_failed');
  assert.equal(receipt.failure.operation, null);
  assert.equal(receipt.failure.last_state.error, true);
  assert.doesNotMatch(JSON.stringify(receipt), /private account text|title/);
  assert.deepEqual(safeReauditState(null), {
    scopeValid: null,
    auditButtonPresent: null,
    auditButtonDisabled: null,
    auditSpinner: null,
    reAudit: null,
    error: null,
  });
});

test('actual manual click remains inside pre-click observer lifetime and unconditional final capture', () => {
  const source = readFileSync(new URL('./seo-guest-acceptance.mjs', import.meta.url), 'utf8');
  const start = source.indexOf(
    'const reauditTrace = await startSeoReauditTrace(panel, report, checkpoint);',
  );
  const end = source.indexOf("target('T02', 'manual_button_returns_to_current_page'", start);
  assert.ok(start > 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /try \{[\s\S]*await clickSeoReaudit\(panel, report, click, checkpoint\)/);
  assert.match(
    block,
    /'manual_reaudit_running_wait',[\s\S]*reauditTransitionWitness[\s\S]*state\.runningObserved/,
  );
  assert.match(
    block,
    /captureReauditWaitFailure\([\s\S]*finally \{\s*await reauditTrace\.stop\(\);/,
  );
});

test('delivered button event is distinguished from protocol release with no DOM action', async () => {
  const trace = await scenario(async ({ button, trace }) => {
    button.click();
    await trace.sample('after_release');
  });
  assert.deepEqual(
    trace.samples.map((value) => [value.stage, value.click_trusted]),
    [
      ['before_click', null],
      ['click_event', false],
      ['after_release', null],
      ['finished', null],
    ],
  );
  assert.ok(trace.samples.every((sample) => sample.reAudit === true));
});

test('watchdog progress writer durably retains timeout trace as unverified without inventing targets', async () => {
  const diagnostic = await scenario(async ({ report }) => {
    report.reaudit_transition_diagnostic.failure = captureReauditWaitFailure(
      new Error('manual_reaudit_running_wait_not_observed:private account text'),
      'manual_reaudit_running_wait',
      { reAudit: true, error: false },
    );
  });
  const directory = mkdtempSync(join(tmpdir(), 'seo-transition-'));
  try {
    const path = join(directory, 'receipt.json');
    writeSeoGuestProgress(path, { targets: [], reaudit_transition_diagnostic: diagnostic }, false);
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(receipt.reaudit_transition_diagnostic, diagnostic);
    assert.equal(receipt.status, 'unverified');
    assert.deepEqual(receipt.targets, []);
    assert.doesNotMatch(JSON.stringify(receipt), /private account text/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// The event transport is external to this SUT. Happy DOM cannot create a native
// CDP trusted event, so supply only its trust bit; DOM commits, observer delivery,
// ordering and acceptance decisions remain the real driver implementation.
async function rapidTransition({ button, trace, flush, window }, trusted = true) {
  const event = new window.MouseEvent('click', { bubbles: true });
  Object.defineProperty(event, 'isTrusted', { value: trusted });
  button.dispatchEvent(event);
  button.disabled = true;
  button.innerHTML = 'Re-audit<svg class="animate-spin"></svg>';
  await flush();
  button.disabled = false;
  button.textContent = 'Re-audit';
  await flush();
  await trace.sample('after_release');
}
const currentPageState = {
  scopeValid: true,
  auditButtonPresent: true,
  auditButtonDisabled: false,
  auditSpinner: false,
  reAudit: true,
  error: false,
  title: 'IANA-managed Reserved Domains',
};

test('rapid trusted recapture passes observed transition oracle while old polling misses running', async () => {
  const trace = await scenario(async (context) => {
    await rapidTransition(context);
    await assert.rejects(
      waitFor(
        'old_poll_running',
        async () => currentPageState,
        (state) => state.scopeValid && state.reAudit === false,
        0,
      ),
      /old_poll_running_not_observed/,
    );
  });
  assert.deepEqual(reauditTransitionWitness(trace, 10000, 30000), {
    runningObserved: true,
    settledObserved: true,
  });
  assert.equal(
    reauditSettledOnCurrentPage(trace, currentPageState, 'IANA-managed Reserved Domains', true),
    true,
  );
  for (const [state, title, pageMatches] of [
    [{ ...currentPageState, error: true }, currentPageState.title, true],
    [{ ...currentPageState, auditButtonDisabled: true }, currentPageState.title, true],
    [{ ...currentPageState, auditSpinner: true }, currentPageState.title, true],
    [{ ...currentPageState, scopeValid: false }, currentPageState.title, true],
    [currentPageState, 'Example Domain', true],
    [currentPageState, currentPageState.title, false],
  ])
    assert.equal(reauditSettledOnCurrentPage(trace, state, title, pageMatches), false);
});

test('untrusted rapid recapture cannot earn acceptance from the same observer history', async () => {
  const trace = await scenario((context) => rapidTransition(context, false));
  assert.deepEqual(reauditTransitionWitness(trace, 10000, 30000), {
    runningObserved: false,
    settledObserved: false,
  });
  assert.equal(
    reauditSettledOnCurrentPage(trace, currentPageState, currentPageState.title, true),
    false,
  );
});

test('missing, reordered, late and unavailable transitions refuse acceptance', async () => {
  const trace = await scenario(rapidTransition);
  const copy = () => structuredClone(trace);
  const mutations = [
    (value) => {
      value.observer_available = false;
    },
    (value) => {
      value.samples = value.samples.filter((sample) => sample.stage !== 'click_event');
    },
    (value) => {
      value.samples = value.samples.filter((sample) => !sample.auditSpinner);
    },
    (value) => {
      value.samples = value.samples.filter((sample) => sample.stage !== 'before_click');
    },
    (value) => {
      value.samples.find((sample) => sample.stage === 'click_event').click_trusted = false;
    },
    (value) => {
      value.samples.reverse();
    },
    (value) => {
      for (const sample of value.samples)
        if (sample.stage !== 'before_click' && sample.stage !== 'click_event')
          sample.elapsed_ms += 10001;
    },
    (value) => {
      let busy = false;
      for (const sample of value.samples) {
        if (busy) sample.elapsed_ms += 30001;
        if (sample.auditSpinner) busy = true;
      }
    },
  ];
  for (const mutate of mutations) {
    const value = copy();
    mutate(value);
    assert.equal(
      reauditSettledOnCurrentPage(value, currentPageState, currentPageState.title, true),
      false,
    );
  }
});

test('bounded retained history still accepts a witnessed cycle after many identical polls', async () => {
  const trace = await scenario(async (context) => {
    await rapidTransition(context);
    for (let index = 0; index < 80; index++) await context.trace.sample('settle_wait');
  });
  assert.equal(trace.samples.length, 64);
  assert.ok(trace.dropped_samples > 0);
  assert.equal(
    reauditSettledOnCurrentPage(trace, currentPageState, currentPageState.title, true),
    true,
  );
  const missingRunning = {
    ...trace,
    samples: trace.samples.filter((sample) => !sample.auditSpinner),
  };
  assert.equal(
    reauditSettledOnCurrentPage(missingRunning, currentPageState, currentPageState.title, true),
    false,
  );
});
