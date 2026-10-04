import assert from 'node:assert/strict';

export function diagnosticCpuRate(value) {
  if (value === undefined || value === '') return null;
  const rate = Number(value);
  assert.ok(Number.isFinite(rate) && rate > 1 && rate <= 20, 'scrape_diagnostic_cpu_rate_invalid');
  return rate;
}

export async function withOwnedPageCpuThrottle(page, expectedUrl, rate, run) {
  const url = new URL(expectedUrl);
  assert.equal(url.protocol, 'http:', 'scrape_diagnostic_owned_protocol_required');
  assert.ok(
    ['localhost', '127.0.0.1'].includes(url.hostname),
    'scrape_diagnostic_owned_host_required',
  );
  assert.equal(url.pathname, '/intake', 'scrape_diagnostic_intake_required');
  assert.equal(page.url(), expectedUrl, 'scrape_diagnostic_foreign_page_refused');
  assert.ok(diagnosticCpuRate(rate) !== null, 'scrape_diagnostic_cpu_rate_required');

  // newCDPSession(page) attaches only to this Playwright page target.
  const session = await page.context().newCDPSession(page);
  const cleanup = { rate_restored: false, session_detached: false };
  let primaryError;
  let throttleAttempted = false;
  let target;
  let result;
  try {
    const { targetInfo } = await session.send('Target.getTargetInfo');
    assert.equal(targetInfo?.type, 'page', 'scrape_diagnostic_page_target_required');
    assert.equal(targetInfo?.url, expectedUrl, 'scrape_diagnostic_target_url_mismatch');
    assert.ok(targetInfo?.targetId, 'scrape_diagnostic_target_id_required');
    target = { id: targetInfo.targetId, type: targetInfo.type, url: targetInfo.url };
    throttleAttempted = true;
    await session.send('Emulation.setCPUThrottlingRate', { rate });
    result = await run({ target, cleanup });
  } catch (error) {
    primaryError = error;
  } finally {
    if (throttleAttempted) {
      try {
        // Restore even if throttling or extraction failed.
        await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        cleanup.rate_restored = true;
      } catch (error) {
        cleanup.restore_error = String(error?.message ?? error);
      }
    }
    try {
      await session.detach();
      cleanup.session_detached = true;
    } catch (error) {
      cleanup.detach_error = String(error?.message ?? error);
    }
  }
  if (primaryError) {
    primaryError.cleanup = cleanup;
    throw primaryError;
  }
  if (cleanup.restore_error || cleanup.detach_error) {
    const error = new Error(`scrape_diagnostic_cleanup_failed:${JSON.stringify(cleanup)}`);
    error.cleanup = cleanup;
    throw error;
  }
  return { target, result, cleanup };
}
