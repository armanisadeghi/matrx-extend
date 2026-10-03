import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// The immutable 991385d9 artifact's ToolReceiptDialog imports D from its
// sidepanel entry and calls it to verify each stored receipt. Keep this exact
// mapping bound to that artifact; never substitute a test verifier.
const VERIFIER_EXPORT = 'D';

export function startSignedRead(page) {
  const callId = randomUUID();
  const response = page.evaluate(async (id) => {
    if (location.hostname !== 'localhost') return { ok: false, code: 'origin' };
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve({ ok: false, code: 'timeout' });
      }, 20_000);
      function onMessage(event) {
        if (
          event.source !== window ||
          event.data?.__matrx_webmcp_result !== true ||
          event.data.callId !== id
        )
          return;
        clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        resolve({
          ok: event.data.ok === true,
          resultShape:
            Number.isInteger(event.data.result?.count) && Array.isArray(event.data.result?.tabs),
        });
      }
      window.addEventListener('message', onMessage);
      window.postMessage(
        { __matrx_webmcp_call: true, callId: id, toolName: 'list_open_tabs', args: {} },
        location.origin,
      );
    });
  }, callId);
  return { callId, response };
}

export async function assertSignedReadResponse(call) {
  const response = await call.response;
  assert.equal(response?.ok, true, 'audit_webmcp_read_failed');
  assert.equal(response.resultShape, true, 'audit_webmcp_read_shape_failed');
}

export function completedReceiptSource(callId) {
  return `(async () => {
    const rows = (await chrome.storage.local.get('matrx.audit.log'))['matrx.audit.log'] ?? [];
    const row = [...rows].reverse().find((item) => item.callId === ${JSON.stringify(callId)} &&
      item.outputHash !== 'pending' && typeof item.signature === 'string' && item.signature.length > 0);
    return row ? {
      callId: row.callId,
      publicKeyId: row.publicKeyId,
      origin: row.origin,
      completed: row.completedAt !== null && row.ok === true,
    } : null;
  })()`;
}

export function productVerificationSource(callId) {
  return `(async () => {
    const rows = (await chrome.storage.local.get('matrx.audit.log'))['matrx.audit.log'] ?? [];
    const row = [...rows].reverse().find((item) => item.callId === ${JSON.stringify(callId)} &&
      item.outputHash !== 'pending' && typeof item.signature === 'string' && item.signature.length > 0);
    if (!row) return { code: 'receipt_missing' };
    const entry = document.querySelector('script[type="module"]')?.src;
    if (!entry) return { code: 'entry_missing' };
    const module = await import(entry);
    if (typeof module[${JSON.stringify(VERIFIER_EXPORT)}] !== 'function')
      return { code: 'verifier_missing' };
    const verify = module[${JSON.stringify(VERIFIER_EXPORT)}];
    const original = await verify(row);
    const tampered = await verify({ ...row, toolName: row.toolName + '.tampered' });
    return {
      code: 'verified',
      callId: row.callId,
      publicKeyId: row.publicKeyId,
      origin: row.origin,
      originalValid: original?.valid === true,
      tamperedRejected: tampered?.valid === false &&
        typeof tampered.reason === 'string' &&
        tampered.reason.startsWith('signature does not match body'),
    };
  })()`;
}
