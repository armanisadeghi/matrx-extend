/**
 * Regression: `records` used scalar Zod schemas with `.default(null)`. Zod
 * validates defaults, so a registered call that omitted any nullable field
 * failed before the handler could reach the record-store door.
 */

import { buildToolCatalog } from '@/lib/tools/catalog';
import { lookup } from '@/lib/tools/registry';
import type { ToolContext } from '@/lib/tools/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store, openRecordStore } = vi.hoisted(() => ({
  store: {
    tableList: vi.fn(),
    recordWrite: vi.fn(),
  },
  openRecordStore: vi.fn(),
}));

vi.mock('@/lib/records/store', () => ({ openRecordStore }));

function context(): ToolContext {
  return {
    conversationId: 'conv-harbor-dental-intake',
    runId: 'run-harbor-dental-intake',
    callId: 'call-harbor-dental-intake',
    agentName: 'Harbor Dental intake assistant',
    permissionMode: 'act',
    assignedTabId: null,
  };
}

function registeredRecords() {
  const handler = lookup('records');
  if (!handler) throw new Error('records must be registered before this boundary can run');
  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
  openRecordStore.mockResolvedValue({ open: true, client: store });
  store.tableList.mockResolvedValue({
    ok: true,
    data: [
      {
        id: 'tbl-harbor-dental-patients',
        slug: 'new-patient-intakes',
        name: 'Harbor Dental new-patient intake',
        type: 'record',
        agent_writable: true,
      },
    ],
  });
  store.recordWrite.mockResolvedValue({ ok: true, data: 'rec-harbor-dental-maya-chen' });
});

describe('registered records schema null defaults', () => {
  it('keeps the DB scalar-null-default catalog contract while validating null at runtime', () => {
    const recordsCatalog = buildToolCatalog().find((entry) => entry.name === 'records');
    const properties = (recordsCatalog?.input_schema as { properties?: Record<string, unknown> })
      .properties;
    if (!properties) throw new Error('records catalog must expose its argument properties');

    expect(properties.table_id).toMatchObject({ type: 'string', default: null });
    expect(properties.availability).toMatchObject({ type: 'object', default: null });
    expect(properties.notify).toMatchObject({ type: 'object', default: true });
  });

  it('runs a registered read when optional DB-null fields are omitted', async () => {
    const handler = registeredRecords();
    const parsed = handler.argsSchema.parse({ action: 'table_list' }) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      action: 'table_list',
      availability: null,
      record_id: null,
      table_id: null,
      values: null,
      notify: true,
    });

    await expect(handler.run(parsed, context())).resolves.toEqual({
      ok: true,
      action: 'table_list',
      tables: [
        {
          id: 'tbl-harbor-dental-patients',
          slug: 'new-patient-intakes',
          name: 'Harbor Dental new-patient intake',
          type: 'record',
          agent_writable: true,
        },
      ],
      count: 1,
    });
  });

  it('runs a registered write with omitted DB-null defaults and its submitted values', async () => {
    const handler = registeredRecords();
    const parsed = handler.argsSchema.parse({
      action: 'record_write',
      table_id: 'tbl-harbor-dental-patients',
      values: { patient_name: 'Maya Chen', intake_status: 'awaiting-insurance' },
    }) as Record<string, unknown>;

    expect(parsed.record_id).toBeNull();
    expect(parsed.expected_version).toBeNull();
    await expect(handler.run(parsed, context())).resolves.toEqual({
      ok: true,
      action: 'record_write',
      record_id: 'rec-harbor-dental-maya-chen',
      wrote: 'create',
    });
    expect(store.recordWrite).toHaveBeenCalledWith({
      table_id: 'tbl-harbor-dental-patients',
      data: { patient_name: 'Maya Chen', intake_status: 'awaiting-insurance' },
    });
  });

  it('returns the registered unavailable-action result after omitted fields default to null', async () => {
    const handler = registeredRecords();
    const parsed = handler.argsSchema.parse({ action: 'form_propose', table_id: null }) as Record<
      string,
      unknown
    >;

    expect(parsed.table_id).toBeNull();
    expect(parsed.availability).toBeNull();
    await expect(handler.run(parsed, context())).resolves.toMatchObject({
      ok: false,
      action: 'form_propose',
      code: 'records_action_unavailable_in_chrome_extension',
    });
    expect(openRecordStore).not.toHaveBeenCalled();
  });
});
