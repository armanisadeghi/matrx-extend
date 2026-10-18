import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { prepareGuestAnswerScreenshot } from './guest-answer-screenshot.mjs';
import { evaluate } from './settings-panel-driver.mjs';

export function safeAnswerScreenshotDiagnostic(error) {
  const source = error instanceof Error ? error.guestAnswerScreenshotDiagnostic : null;
  if (!source || typeof source !== 'object') return null;
  const flag = (value) => value === true;
  const number = (value) =>
    typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100_000
      ? Math.round(value * 100) / 100
      : null;
  const rect = (value) =>
    value && typeof value === 'object'
      ? {
          left: number(value.left),
          right: number(value.right),
          top: number(value.top),
          bottom: number(value.bottom),
        }
      : null;
  const checks = source.checks ?? {};
  const safeChecks = {
    article_intersects_viewport: flag(checks.articleIntersectsViewport),
    code_in_answer_text: flag(checks.codeInAnswerText),
    heading_in_answer_text: flag(checks.headingInAnswerText),
    focused_text_found: flag(checks.focusedTextFound),
    focused_text_in_viewport: flag(checks.focusedTextInViewport),
    focused_text_unclipped: flag(checks.focusedTextUnclipped),
  };
  return {
    checks: safeChecks,
    failed_checks: Object.entries(safeChecks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
    viewport: {
      width: number(source.viewport?.width),
      height: number(source.viewport?.height),
    },
    article: rect(source.article),
    line: rect(source.line),
    clipped_by: source.clippedBy
      ? { depth: number(source.clippedBy.depth), rect: rect(source.clippedBy.rect) }
      : null,
    scroll_ancestors: Array.isArray(source.scrollAncestors)
      ? source.scrollAncestors.slice(0, 8).map((item) => ({
          depth: number(item.depth),
          top: number(item.top),
          height: number(item.height),
        }))
      : [],
  };
}

export function recordGuestAnswerScreenshotFailure(report, error) {
  report.answer_screenshot_diagnostic = safeAnswerScreenshotDiagnostic(error);
}

export async function writeGuestAcceptanceReport(output, report) {
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

export async function captureGuestAnswer(panel, path, expectedAnswer = null) {
  if (expectedAnswer) {
    const proof = await evaluate(
      panel,
      `(${prepareGuestAnswerScreenshot.toString()})(${JSON.stringify(expectedAnswer)})`,
    );
    try {
      assert.equal(proof.eligible, true, `answer screenshot ineligible: ${proof.reason}`);
    } catch (error) {
      error.guestAnswerScreenshotDiagnostic = proof.diagnostic;
      throw error;
    }
  }
  const { data } = await panel.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path, Buffer.from(data, 'base64'), { mode: 0o600 });
  return path;
}
