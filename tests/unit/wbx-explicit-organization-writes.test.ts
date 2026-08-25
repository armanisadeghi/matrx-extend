import { createHighlight } from '@/lib/highlights/queries';
import {
  saveCapture,
  savePattern,
  saveScreenshot,
  saveSeoAudit,
  upsertDemoRow,
  upsertGuidanceRow,
} from '@/lib/supabase/queries';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRequestOrganizationId: vi.fn(),
  getSupabase: vi.fn(),
}));

vi.mock('@/lib/api/routes/auth', () => ({
  requireRequestOrganizationId: mocks.requireRequestOrganizationId,
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: mocks.getSupabase,
}));

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = '33333333-3333-4333-8333-333333333333';

type Writer = {
  name: string;
  run: () => Promise<unknown>;
};

const writers: Writer[] = [
  {
    name: 'capture',
    run: () => saveCapture({ url: 'https://example.com', soup: {} }),
  },
  {
    name: 'pattern',
    run: () =>
      savePattern({
        name: 'Example',
        domain: 'example.com',
        route_pattern: '/',
        list_root_selector: null,
        fields: [],
      }),
  },
  {
    name: 'SEO audit',
    run: () => saveSeoAudit({ url: 'https://example.com', signals: {} }),
  },
  {
    name: 'screenshot',
    run: () =>
      saveScreenshot({
        page_url_canonical: 'https://example.com',
        page_url_full: 'https://example.com/',
        file_id: FILE_ID,
        source: 'user',
      }),
  },
  {
    name: 'guidance',
    run: () =>
      upsertGuidanceRow({
        id: 'guidance-example',
        domain: 'example.com',
        kind: 'note',
        data: { text: 'Remember this' },
        created_at: '2026-08-24T00:00:00.000Z',
        updated_at: '2026-08-24T00:00:00.000Z',
      }),
  },
  {
    name: 'demo',
    run: () =>
      upsertDemoRow({
        id: 'demo-example',
        name: 'Example',
        description: 'Example workflow',
        start_url: 'https://example.com',
        step_count: 0,
        parameter_names: [],
        body: { steps: [] },
      }),
  },
  {
    name: 'highlight',
    run: () =>
      createHighlight({
        mode: 'text',
        url: 'https://example.com',
        domain: 'example.com',
        text: 'Explicit organization',
        anchor: {},
      }),
  },
];

function installSupabaseWriteRecorder(): unknown[] {
  const payloads: unknown[] = [];
  const chain = {
    schema: vi.fn(() => chain),
    from: vi.fn(() => chain),
    insert: vi.fn((payload: unknown) => {
      payloads.push(payload);
      return chain;
    }),
    upsert: vi.fn((payload: unknown) => {
      payloads.push(payload);
      return chain;
    }),
    select: vi.fn(() => chain),
    single: vi.fn(async () => ({ data: { id: FILE_ID }, error: null })),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: FILE_ID } } })),
    },
  };
  mocks.getSupabase.mockReturnValue(chain);
  return payloads;
}

describe('extend.wbx_* explicit organization writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  for (const writer of writers) {
    it(`refuses ${writer.name} before Supabase when request organization is missing`, async () => {
      mocks.requireRequestOrganizationId.mockRejectedValue(
        new Error('Workspace initialization failed: the request carried no organization.'),
      );

      await writer.run();

      expect(mocks.getSupabase).not.toHaveBeenCalled();
    });
  }

  it('stamps the exact request organization on all seven insert/upsert payloads', async () => {
    mocks.requireRequestOrganizationId.mockResolvedValue(ORG_ID);
    const payloads = installSupabaseWriteRecorder();

    for (const writer of writers) await writer.run();

    expect(payloads).toHaveLength(7);
    for (const payload of payloads) {
      expect(payload).toEqual(expect.objectContaining({ organization_id: ORG_ID }));
    }
  });
});
