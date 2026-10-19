import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Window } from 'happy-dom';
import { REVIEWER_DEMO_URL, captureReviewerPaneScreenshot } from './store-reviewer-demo-path.mjs';

const sourceUrl = new URL('./store-reviewer-demo-path.mjs', import.meta.url);
const headline = 'A clear three-stage browser workflow';

test('reviewer screenshot clips the actual labeled Capture and counted Links controls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reviewer-control-'));
  const window = new Window();
  try {
    window.document.body.innerHTML = `
      <button role="tab" title="Scrape" aria-selected="true" aria-controls="scrape"></button>
      <div id="scrape" data-state="active">
        <button title="Capture the page exactly as it is right now">Re-capture</button>
        <button role="tab"><span>Links</span><span>17</span></button>
      </div>`;
    Object.defineProperty(window.document.documentElement, 'clientWidth', { value: 360 });
    Object.defineProperty(window.document.documentElement, 'clientHeight', { value: 373 });
    for (const [index, button] of [
      ...window.document.querySelectorAll('#scrape button'),
    ].entries()) {
      button.getBoundingClientRect = () => ({
        left: 20,
        top: 60 + index * 40,
        right: 160,
        bottom: 88 + index * 40,
      });
    }
    const panel = {
      send: async (method, options) => {
        if (method === 'Runtime.evaluate')
          return {
            result: {
              value: (await import('node:vm')).runInNewContext(options.expression, {
                document: window.document,
              }),
            },
          };
        assert.equal(method, 'Page.captureScreenshot');
        const png = Buffer.alloc(24);
        png.writeUInt32BE(options.clip.width, 16);
        png.writeUInt32BE(options.clip.height, 20);
        return { data: png.toString('base64') };
      },
    };
    for (const check of ['capture_article', 'capture_links']) {
      const file = join(directory, `${check}.png`);
      assert.equal(
        await captureReviewerPaneScreenshot({
          page: { url: () => REVIEWER_DEMO_URL },
          panel,
          file,
          check,
        }),
        file,
      );
    }
    window.document.querySelector('#scrape button[role="tab"]').firstChild.textContent = 'PRIVATE';
    await assert.rejects(
      captureReviewerPaneScreenshot({
        page: { url: () => REVIEWER_DEMO_URL },
        panel,
        file: join(directory, 'private.png'),
        check: 'capture_links',
      }),
      /reviewer_failure_screenshot_target_missing/,
    );
  } finally {
    await window.happyDOM.abort();
    await rm(directory, { recursive: true, force: true });
  }
});

test('reviewer Data check selects a fixture field before requiring guest explanation and Cancel', async () => {
  const original = await readFile(sourceUrl, 'utf8');
  const key = '__reviewerFailureBoundaryIO';
  let tab = 'Article';
  let captured = false;
  let selected = false;
  let dataPickerClicked = false;
  let explanationAfterSelection = true;
  let articleHeadingAfterCapture = true;
  const articleHeadingInTextContent = true;
  let doneFailure = null;
  const io = {
    click: async (_panel, kind, value) => {
      if (kind === 'scrape-result-tab') tab = value;
      if (value === 'Capture the page exactly as it is right now') captured = true;
      if (kind === 'data-picker-button') dataPickerClicked = true;
      if (kind === 'data-cancel-button') selected = false;
    },
    evaluate: async (_panel, expression) => {
      if (expression.includes('switchCount'))
        return { visible: false, stored: null, settingPresent: false, switchCount: 1 };
      if (expression.includes('captureButtons')) {
        const text = `${tab === 'Article' && !articleHeadingAfterCapture ? '' : headline} Capture Understand Use Matrx Extend privacy policy Article`;
        const textContent = `${tab === 'Article' && !articleHeadingInTextContent ? '' : headline} Capture Understand Use Matrx Extend privacy policy Article`;
        return {
          active: true,
          title: 'Matrx Extend Demo Page',
          empty: !captured,
          captureButtons: 1,
          selected: tab,
          contentVisible: true,
          text,
          textContent,
          headingNodes: tab === 'Article' && !articleHeadingInTextContent ? 0 : 1,
          linkCount: 17,
          error: null,
        };
      }
      if (expression.includes('auditAvailable'))
        return {
          active: true,
          title: 'Matrx Extend Demo Page',
          headings: true,
          auditReady: true,
          auditAvailable: false,
          error: false,
        };
      if (expression.includes('pickerReady'))
        return {
          active: true,
          pickerReady: !selected,
          selected: selected ? ['field_1: main article table tbody tr th[scope="row"]'] : [],
          cancelReady: selected,
          guestExplanation: selected && explanationAfterSelection,
        };
      throw new Error('unexpected reviewer observation');
    },
    openSection: async () => {},
    waitFor: async (_label, read, accept) => {
      const value = await read();
      if (!accept(value)) throw new Error('reviewer_observation_failed');
      return value;
    },
    clickPickerField: async () => {},
    clickPickerDone: async () => {
      if (doneFailure) throw new Error(doneFailure);
      selected = true;
    },
    clickPickerCancel: async () => {
      selected = false;
    },
  };
  globalThis[key] = io;
  try {
    const stub = (names) =>
      `data:text/javascript,${encodeURIComponent(names.map((name) => `export const ${name} = (...args) => globalThis.${key}.${name}(...args);`).join('\n'))}`;
    const rewritten = original.replace(/from '(\.\/[^']+)'/g, (_match, path) => {
      if (path === './settings-panel-driver.mjs')
        return `from '${stub(['click', 'evaluate', 'openSection', 'waitFor'])}'`;
      if (path === './data-guest-picker-driver.mjs')
        return `from '${stub(['clickPickerCancel', 'clickPickerDone', 'clickPickerField'])}'`;
      return `from '${new URL(path, sourceUrl).href}'`;
    });
    const { runStoreReviewerDemoPath } = await import(
      `data:text/javascript,${encodeURIComponent(rewritten)}`
    );
    const treeSha = 'a'.repeat(64);
    const receipt = {
      kind: 'native_store_zip_candidate_key_adapted',
      version: '0.2.559',
      publishState: 'pushed',
      treeSha256: treeSha,
      storeTreeSha256: 'b'.repeat(64),
      sourceSha: 'b'.repeat(40),
      storeZip: { sha256: 'c'.repeat(64) },
      artifactSelection: {
        source: 'release_receipt_store_zip',
        publisherSourceTreeSha256: 'd'.repeat(64),
        selectedZipSha256: 'c'.repeat(64),
        originalStoreTreeSha256: 'b'.repeat(64),
        runtimeTreeSha256: treeSha,
        modifiedPaths: ['manifest.json'],
      },
    };
    const args = {
      page: {
        url: () => REVIEWER_DEMO_URL,
        evaluate: async (_fn, selector) =>
          selector
            ? { count: 1, workflowRow: true, text: 'Capture' }
            : {
                url: REVIEWER_DEMO_URL,
                title: 'Matrx Extend Demo Page',
                articleText: headline,
                articleH1Matches: true,
                stages: ['Capture', 'Understand', 'Use'],
                linkHref: 'https://www.aimatrx.com/privacy-policy/extension',
                linkText: 'Matrx Extend privacy policy',
                schemaType: 'Article',
                schemaHeadline: headline,
              },
        locator: () => ({ waitFor: async () => {} }),
      },
      panel: {},
      receipt,
      runtimeTreeSha256: treeSha,
      screenshot: async () => {},
    };
    const proof = await runStoreReviewerDemoPath(args);
    assert.equal(dataPickerClicked, true, JSON.stringify(proof.checks.data_workflow_picker));
    assert.equal(
      proof.checks.data_workflow_picker.status,
      'pass',
      JSON.stringify(proof.checks.data_workflow_picker),
    );
    assert.equal(proof.checks.data_workflow_picker.workflow_row_matched, true);
    explanationAfterSelection = false;
    dataPickerClicked = false;
    captured = false;
    tab = 'Article';
    const missingExplanation = await runStoreReviewerDemoPath(args);
    assert.equal(dataPickerClicked, true);
    assert.equal(
      missingExplanation.checks.data_workflow_picker.failure_code,
      'reviewer_data_guest_explanation_missing',
      JSON.stringify(missingExplanation.checks.data_workflow_picker),
    );
    assert.equal(
      missingExplanation.checks.data_workflow_picker.failure_target,
      'data_selected_field',
    );
    explanationAfterSelection = true;
    articleHeadingAfterCapture = false;
    captured = false;
    tab = 'Article';
    const missingHeading = await runStoreReviewerDemoPath(args);
    assert.equal(missingHeading.status, 'fail');
    assert.equal(missingHeading.checks.capture_article.failure_target, 'article_result');
    assert.equal(missingHeading.checks.capture_article.safe_dom.public_heading_present, false);
    assert.equal(
      missingHeading.checks.capture_article.safe_dom.rendered_heading_text_content_present,
      true,
    );
    assert.equal(
      missingHeading.checks.capture_article.safe_dom.rendered_heading_inner_text_present,
      false,
    );
    assert.equal(missingHeading.checks.capture_article.safe_dom.rendered_heading_node_count, 1);
    assert.ok(
      missingHeading.checks.capture_article.safe_dom.rendered_text_content_length >
        missingHeading.checks.capture_article.safe_dom.rendered_inner_text_length,
    );
    assert.equal(missingHeading.checks.capture_article.safe_dom.public_stages_present, true);
    assert.equal(missingHeading.checks.capture_links.status, 'pass');
    // Mutation probe: if the textContent diagnostic accidentally reads innerText,
    // this fixture changes its verdict while the Article gate remains red.
    const mutant = rewritten.replace("(value.textContent ?? '').includes(", 'value.text.includes(');
    assert.notEqual(mutant, rewritten);
    const mutantRunner = await import(`data:text/javascript,${encodeURIComponent(mutant)}`);
    captured = false;
    tab = 'Article';
    const mutantProof = await mutantRunner.runStoreReviewerDemoPath(args);
    assert.equal(
      mutantProof.checks.capture_article.safe_dom.rendered_heading_text_content_present,
      false,
    );
    articleHeadingAfterCapture = true;
    doneFailure = 'data_guest_done_hit_target_changed';
    captured = false;
    tab = 'Article';
    const failedDone = await runStoreReviewerDemoPath(args);
    assert.equal(failedDone.checks.data_workflow_picker.failure_code, doneFailure);
    assert.equal(failedDone.checks.data_workflow_picker.failure_target, 'data_picker_done');
    assert.equal(
      failedDone.checks.data_workflow_picker.failure_diagnostic.picker_diagnostic_available,
      false,
    );
    assert.equal(
      failedDone.checks.data_workflow_picker.failure_diagnostic.field_hit_confirmed,
      false,
    );
    args.page.context = () => ({
      newCDPSession: async () => ({
        send: async (method, params) => {
          if (method === 'DOM.enable') return {};
          if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
          if (method === 'DOM.querySelector') return { nodeId: 2 };
          if (method === 'DOM.describeNode')
            return { node: { shadowRoots: [{ nodeId: 3, shadowRootType: 'closed' }] } };
          if (method === 'DOM.querySelectorAll')
            return { nodeIds: params.selector === 'button#done' ? [] : [4] };
          throw new Error('unexpected_cdp_method');
        },
        detach: async () => {},
      }),
    });
    captured = false;
    tab = 'Article';
    const countedDone = await runStoreReviewerDemoPath(args);
    assert.equal(countedDone.checks.data_workflow_picker.failure_code, doneFailure);
    assert.deepEqual(countedDone.checks.data_workflow_picker.failure_diagnostic, {
      field_hit_confirmed: false,
      picker_diagnostic_available: true,
      picker_shadow_count: 1,
      picker_done_node_count: 0,
      picker_cancel_node_count: 1,
    });
  } finally {
    delete globalThis[key];
  }
});
