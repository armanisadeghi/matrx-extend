import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SourceLandingBody } from '@/lib/api/routes/sources';

// Harbor Dental saves its intake guide while staff switch their active workspace.
const state = vi.hoisted(() => ({
  org: '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f',
  user: '87a6e699-3622-4869-8843-d0867456c0dd',
  switchBeforeHeaders: false,
}));
const otherOrg = '8e530f1e-a236-4bca-8131-f15327796301';
vi.mock('@/config/backend', () => ({ getBackendUrl: async () => {
  if (state.switchBeforeHeaders) state.org = '8e530f1e-a236-4bca-8131-f15327796301';
  return 'https://server.app.matrxserver.com';
} }));
vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => 'session-bearer',
  getVerifiedCurrentUser: async () => ({ id: state.user }),
}));
vi.mock('@/lib/org/active-org', () => ({ getActiveOrganizationId: async () => state.org }));
vi.mock('@/lib/debug/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() } }));
import { landSource } from '@/lib/api/routes/sources';
const body: SourceLandingBody = {
  source_kind: 'scrape_parsed_page', source_id: null,
  canonical_identity: 'https://harbordental.com/intake', name: 'Patient intake guide',
  mime_type: 'text/markdown', portions: [], original: null, structured: null,
  provenance: { origin_client: 'extension', capture_method: 'own_browser', captured_at: '2026-09-26T12:00:00Z', final_url: null, user_id: '87a6e699-3622-4869-8843-d0867456c0dd' },
  attach_to: [], keep: true, visibility: 'internal', organization_id: '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f',
};
const landed = { processed_document_id: '6b8c38dd-6d68-4824-b664-a380b7611627', source_id: 'intake-guide', reused_existing: false, kept: true, intelligence: 'queued', notices: [] };
beforeEach(() => { state.org = body.organization_id; state.switchBeforeHeaders = false; });
afterEach(() => vi.unstubAllGlobals());
it('refuses a workspace switch between landing body creation and authorization headers', async () => {
  const network = vi.fn(async () => new Response(JSON.stringify(landed), { status: 200 }));
  vi.stubGlobal('fetch', network);
  state.switchBeforeHeaders = true;
  const result = await landSource(body);
  expect(network).not.toHaveBeenCalled();
  expect(result.ok).toBe(false);
});
it('keeps dispatched body and header in the original workspace when the response arrives after a switch', async () => {
  const network = vi.fn(async (_url: unknown, init: RequestInit) => {
    const headers = new Headers(init.headers);
    expect(headers.get('X-Organization-Id')).toBe(body.organization_id);
    expect(JSON.parse(String(init.body)).organization_id).toBe(body.organization_id);
    state.org = otherOrg;
    return new Response(JSON.stringify(landed), { status: 200 });
  });
  vi.stubGlobal('fetch', network);
  expect(await landSource(body)).toEqual({ ok: true, landed });
  expect(network).toHaveBeenCalledTimes(1);
});
