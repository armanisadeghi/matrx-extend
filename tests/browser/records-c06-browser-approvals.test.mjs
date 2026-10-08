import assert from 'node:assert/strict';
import test from 'node:test';
import { openRecordsC06Approvals } from './records-c06-browser-approvals.mjs';

const principalId = 'b326b48b-3e0d-4b1d-903e-a9f6b0635682';
const organizationId = '80b29f0e-1600-4837-b54d-07016fc45445';
const tableId = '3b80fd38-4db8-4cc9-8629-f8b751d5b337';
const approvalId = 'daef0892-4337-44b7-a793-829d12d94cab';

function browser({ userId = principalId, path = '/approvals' } = {}) {
  const calls = [];
  const listeners = new Map();
  let closed = false;
  const pageUrl = `https://www.aimatrx.com${path}`;
  const row = {
    waitFor: async ({ state }) => {
      calls.push(`row_${state}`);
    },
    count: async () => 1,
    getByText: (value) => ({
      count: async () => {
        calls.push(`text_${value}`);
        return 1;
      },
    }),
    getByRole: (_role, { name }) => ({
      click: async () => {
        calls.push(`row_click_${name}`);
      },
    }),
  };
  const dialog = {
    waitFor: async () => {
      calls.push('dialog_visible');
    },
    getByRole: (_role, { name }) => ({
      click: async () => {
        calls.push(`confirm_${name}`);
      },
    }),
  };
  const page = {
    on: (event, listener) => listeners.set(event, listener),
    off: (event) => listeners.delete(event),
    goto: async () => {
      calls.push('goto');
      listeners.get('request')?.({
        url: () => 'https://db.example.test/rest/v1/rpc/work_inbox',
        method: () => 'POST',
        headers: () => ({ authorization: 'Bearer private', apikey: 'public' }),
      });
    },
    url: () => pageUrl,
    evaluate: async (_fn, args) => {
      if (!args) return { userId, email: 'admin@admin.com' };
      calls.push('scoped_approval_read');
      assert.equal(args.organizationId, organizationId);
      assert.equal(args.approvalId, approvalId);
      assert.equal(new URL(args.url).pathname, '/rest/v1/rpc/work_approval_read');
      return { status: 200, data: { approval_id: approvalId, state: 'approved' } };
    },
    reload: async () => {
      calls.push('reload');
    },
    locator: (selector) => {
      assert.equal(selector, `#approval-row-store_change-${approvalId}`);
      return row;
    },
    getByRole: (_role, { name }) => {
      assert.equal(name, 'Approve 1 proposal?');
      return dialog;
    },
    waitForResponse: async (predicate) => {
      const response = {
        url: () => 'https://db.example.test/rest/v1/rpc/work_approval_decide',
        request: () => ({
          method: () => 'POST',
          postDataJSON: () => ({
            p_organization_id: organizationId,
            p_approval_id: approvalId,
            p_approve: true,
          }),
        }),
        status: () => 200,
        json: async () => ({ applied: true, record_ids: ['483f8d2c-bdc0-4b8c-85d5-5b7837e575f7'] }),
      };
      assert.equal(await predicate(response), true);
      calls.push('decision_rpc_observed');
      return response;
    },
    close: async () => {
      closed = true;
    },
  };
  return { context: { newPage: async () => page }, calls, isClosed: () => closed };
}

test('signed-in first-party page scopes approval read and confirms exact UI row through its decision RPC', async () => {
  const b = browser();
  const approvals = await openRecordsC06Approvals({
    context: b.context,
    principalId,
    expectedEmail: 'admin@admin.com',
  });
  const read = await approvals.readApproval(approvalId, organizationId);
  assert.equal(read.approval_id, approvalId);
  const result = await approvals.decideInUi({
    approvalId,
    organizationId,
    tableId,
    decision: 'Approve',
    tableName: 'Harbor Dental',
  });
  assert.deepEqual(result, { surface: '/approvals', rowMatched: true, confirmed: true });
  assert.ok(b.calls.indexOf('row_click_Approve') < b.calls.indexOf('confirm_Approve 1'));
  assert.ok(b.calls.includes('decision_rpc_observed'));
  await approvals.close();
  assert.equal(b.isClosed(), true);
});

test('wrong first-party principal refuses before any approval read or UI decision', async () => {
  const b = browser({ userId: tableId });
  await assert.rejects(
    openRecordsC06Approvals({
      context: b.context,
      principalId,
      expectedEmail: 'admin@admin.com',
    }),
    /records_c06_web_principal_mismatch/,
  );
  assert.equal(b.isClosed(), true);
  assert.equal(b.calls.includes('scoped_approval_read'), false);
});

test('login redirect refuses before any approval read or UI decision', async () => {
  const b = browser({ path: '/login' });
  await assert.rejects(
    openRecordsC06Approvals({
      context: b.context,
      principalId,
      expectedEmail: 'admin@admin.com',
    }),
    /records_c06_approvals_route_missing/,
  );
  assert.equal(b.isClosed(), true);
});
