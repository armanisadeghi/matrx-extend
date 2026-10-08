/** Browser-side person approval adapter for one owned Records C06 request. */
import assert from 'node:assert/strict';
import { firstPartyWebIdentity } from './member-native-auth-proof.mjs';

const ORIGIN = 'https://www.aimatrx.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function openRecordsC06Approvals({ context, principalId, expectedEmail }) {
  assert.match(principalId, UUID, 'records_c06_principal_invalid');
  const web = await context.newPage();
  let readDoor = null;
  let resolveReadDoor;
  const readDoorReady = new Promise((resolve) => {
    resolveReadDoor = resolve;
  });
  const onRequest = (request) => {
    let url;
    try {
      url = new URL(request.url());
    } catch {
      return;
    }
    if (
      !['/rest/v1/rpc/work_approval_read', '/rest/v1/rpc/work_inbox'].includes(url.pathname) ||
      request.method() !== 'POST'
    )
      return;
    const headers = request.headers();
    if (typeof headers.authorization !== 'string' || typeof headers.apikey !== 'string') return;
    url.pathname = '/rest/v1/rpc/work_approval_read';
    readDoor = {
      url: url.href,
      headers: {
        authorization: headers.authorization,
        apikey: headers.apikey,
        'content-type': 'application/json',
        'content-profile': 'custom',
      },
    };
    resolveReadDoor();
  };
  web.on('request', onRequest);
  try {
    await web.goto(`${ORIGIN}/approvals`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    assert.equal(new URL(web.url()).pathname, '/approvals', 'records_c06_approvals_route_missing');
    const identity = await firstPartyWebIdentity(web);
    assert.equal(identity?.userId, principalId, 'records_c06_web_principal_mismatch');
    assert.equal(
      identity.email?.toLowerCase(),
      expectedEmail.toLowerCase(),
      'records_c06_web_email_mismatch',
    );
    let readDoorTimer;
    try {
      await Promise.race([
        readDoorReady,
        new Promise((_, reject) => {
          readDoorTimer = setTimeout(
            () => reject(new Error('records_c06_authenticated_read_door_unobserved')),
            30_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(readDoorTimer);
    }
    return {
      web,
      async readApproval(approvalId, organizationId) {
        assert.match(approvalId, UUID, 'records_c06_approval_id_invalid');
        assert.match(organizationId, UUID, 'records_c06_org_id_invalid');
        assert.ok(readDoor, 'records_c06_authenticated_read_door_unobserved');
        // The browser app's own authenticated read supplies the scoped URL and
        // headers. Credentials stay private and never enter the test receipt.
        const result = await web.evaluate(
          async ({ url, headers, approvalId: id, organizationId: org }) => {
            const response = await fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify({ p_organization_id: org, p_approval_id: id }),
            });
            return { status: response.status, data: response.ok ? await response.json() : null };
          },
          { ...readDoor, approvalId, organizationId },
        );
        assert.equal(result.status, 200, 'records_c06_approval_read_failed');
        assert.ok(
          result.data && typeof result.data === 'object',
          'records_c06_approval_read_empty',
        );
        return result.data;
      },
      async decideInUi({ approvalId, organizationId, tableId, decision, tableName }) {
        assert.match(approvalId, UUID, 'records_c06_approval_id_invalid');
        assert.match(organizationId, UUID, 'records_c06_org_id_invalid');
        assert.match(tableId, UUID, 'records_c06_table_id_invalid');
        assert.ok(['Approve', 'Decline'].includes(decision), 'records_c06_decision_invalid');
        await web.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
        assert.equal(
          new URL(web.url()).pathname,
          '/approvals',
          'records_c06_approvals_route_missing',
        );
        const row = web.locator(`#approval-row-store_change-${approvalId}`);
        await row.waitFor({ state: 'visible', timeout: 30_000 });
        assert.equal(await row.count(), 1, 'records_c06_approval_row_not_unique');
        assert.equal(
          await row.getByText('Agent change', { exact: true }).count(),
          1,
          'records_c06_agent_badge_missing',
        );
        assert.equal(
          await row.getByText(`Add 1 record to ${tableName}`, { exact: true }).count(),
          1,
          'records_c06_owned_table_headline_missing',
        );
        await row.getByRole('button', { name: decision, exact: true }).click();
        const dialog = web.getByRole('dialog', { name: `${decision} 1 proposal?` });
        await dialog.waitFor({ state: 'visible', timeout: 10_000 });
        const responsePromise = web.waitForResponse(
          async (response) => {
            const request = response.request();
            const url = new URL(response.url());
            if (request.method() !== 'POST' || url.pathname !== '/rest/v1/rpc/work_approval_decide')
              return false;
            let body;
            try {
              body = request.postDataJSON();
            } catch {
              return false;
            }
            return (
              body?.p_organization_id === organizationId &&
              body?.p_approval_id === approvalId &&
              body?.p_approve === (decision === 'Approve')
            );
          },
          { timeout: 45_000 },
        );
        await dialog.getByRole('button', { name: `${decision} 1`, exact: true }).click();
        const response = await responsePromise;
        assert.equal(response.status(), 200, 'records_c06_ui_decision_http_failed');
        const decisionResult = await response.json();
        if (decision === 'Approve') {
          assert.equal(decisionResult.applied, true, 'records_c06_ui_not_applied');
          assert.equal(decisionResult.record_ids?.length, 1, 'records_c06_ui_row_id_missing');
          assert.match(decisionResult.record_ids[0], UUID, 'records_c06_ui_row_id_invalid');
        } else {
          assert.equal(decisionResult.state, 'declined', 'records_c06_ui_not_declined');
          assert.equal(decisionResult.applied, false, 'records_c06_decline_false_applied');
        }
        await row.waitFor({ state: 'detached', timeout: 30_000 });
        return { surface: '/approvals', rowMatched: true, confirmed: true };
      },
      async close() {
        web.off('request', onRequest);
        await web.close();
      },
    };
  } catch (error) {
    web.off('request', onRequest);
    await web.close();
    throw error;
  }
}
