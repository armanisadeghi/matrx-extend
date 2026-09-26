'use strict';

const LOCAL_APP_BOOTSTRAP_TYPE_ERROR_STAGE = 'build_local_app_bootstrap';

// The local canonical adapter is preferred because it exercises the pinned
// router and service. This fallback exists only for its observed broad-package
// bootstrap failure, after receipt reconciliation has already proven ownership.
function isKnownLocalAdapterBootTypeError(failure) {
  return (
    failure?.code === 'internal_refused' &&
    failure?.errorType === 'TypeError' &&
    failure?.stage === LOCAL_APP_BOOTSTRAP_TYPE_ERROR_STAGE
  );
}

function refuse(condition, code) {
  if (!condition) throw new Error(code);
}

function createDistributedReceiptCleanupRequest({
  apiBaseUrl,
  token,
  organizationId,
  journalRequest,
  fetchImpl,
}) {
  refuse(
    typeof apiBaseUrl === 'string' && /^https:\/\//.test(apiBaseUrl),
    'distributed_cleanup_api_refused',
  );
  refuse(typeof token === 'string' && token.length >= 20, 'distributed_cleanup_token_refused');
  refuse(
    typeof organizationId === 'string' && /^[0-9a-f-]{36}$/i.test(organizationId),
    'distributed_cleanup_organization_refused',
  );
  refuse(typeof journalRequest === 'function', 'distributed_cleanup_journal_refused');
  refuse(typeof fetchImpl === 'function', 'distributed_cleanup_fetch_refused');

  return async (id, method) => {
    refuse(typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id), 'distributed_cleanup_id_refused');
    refuse(method === 'GET' || method === 'DELETE', 'distributed_cleanup_method_refused');
    const headers = {
      Authorization: `Bearer ${token}`,
      'X-Organization-Id': organizationId,
    };
    const url = `${apiBaseUrl}/api/vault/items/${encodeURIComponent(id)}`;
    journalRequest(url, method, headers);
    const response = await fetchImpl(url, { method, headers });
    return { status: response?.status };
  };
}

async function cleanupReceiptOwnedFallback({ receiptIds, request }) {
  refuse(receiptIds instanceof Set && receiptIds.size > 0, 'distributed_cleanup_receipts_refused');
  refuse(typeof request === 'function', 'distributed_cleanup_request_refused');

  const attempts = [];
  for (const id of receiptIds) {
    refuse(typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id), 'distributed_cleanup_id_refused');
    const initial = await request(id, 'GET');
    refuse(
      initial?.status === 200 || initial?.status === 404,
      'distributed_cleanup_initial_refused',
    );
    const deleted = await request(id, 'DELETE');
    refuse(
      deleted?.status === 204 || deleted?.status === 404,
      'distributed_cleanup_delete_refused',
    );
    const final = await request(id, 'GET');
    refuse(final?.status === 404, 'distributed_cleanup_final_refused');
    attempts.push({
      id,
      initialGetStatus: initial.status,
      deleteStatus: deleted.status,
      finalGetStatus: final.status,
      terminal:
        initial.status === 404 || deleted.status === 404
          ? 'already_cleaned'
          : 'deleted_and_missing',
    });
  }
  return {
    route: 'canonical_distributed_receipt_cleanup',
    provenance: 'receipt_reconciled_exact_ids_after_known_local_adapter_boot_typeerror',
    receiptCount: receiptIds.size,
    attempts,
  };
}

module.exports = {
  cleanupReceiptOwnedFallback,
  createDistributedReceiptCleanupRequest,
  isKnownLocalAdapterBootTypeError,
  LOCAL_APP_BOOTSTRAP_TYPE_ERROR_STAGE,
};
