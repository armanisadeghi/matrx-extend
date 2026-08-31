/**
 * THE PROTOCOL GUARD — proof that collapsing this client's hand-rolled AI
 * version policy onto `@ai-matrx/agents/matrx` (0.6.0, C22) changed no wire
 * behaviour, and that the collapse cannot silently un-collapse.
 *
 * Before the adoption this repo carried its own `API_VERSION = 'v2'` constant
 * and a hand-maintained prose list of which `/ai/*` endpoints have a v2
 * sibling. That list is the package's `V2_COVERED_AI_PATH_TEMPLATES` — a twin,
 * and one that drifts the moment the backend's v2 surface changes. These tests
 * assert every path helper in `routes/ai.ts` still produces EXACTLY the string
 * it produced before, and that the sub-resource paths the extension must keep
 * on v1 (warm / cancel / inbox) are still left alone.
 *
 * The expected strings below are written as literals ON PURPOSE. Deriving them
 * from the same package function the code under test uses would prove nothing.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/config/backend', () => ({ getBackendUrl: async () => 'https://example.invalid' }));

import { applyOrganizationContextHeader } from '@ai-matrx/agents/matrx';
import { ORGANIZATION_CONTEXT_HEADER } from './client';
import {
  CHAT_PATH,
  agentExecutePath,
  agentTargetExecutePath,
  agentWarmPath,
  cancelPath,
  conversationInboxPath,
  mandateExecutePath,
} from './routes/ai';

describe('AI path versioning is the package policy, and the wire did not move', () => {
  it('promotes the run-start doors to /v2, byte-for-byte as before', () => {
    expect(agentExecutePath('abc-123')).toBe('/v2/ai/agent/abc-123');
    expect(mandateExecutePath('daily_brief')).toBe('/v2/ai/mandates/daily_brief');
    expect(CHAT_PATH).toBe('/v2/ai/chat');
  });

  it('still percent-encodes the interpolated segment', () => {
    expect(agentExecutePath('a/b c')).toBe('/v2/ai/agent/a%2Fb%20c');
    expect(mandateExecutePath('a/b')).toBe('/v2/ai/mandates/a%2Fb');
  });

  it('leaves every endpoint with no v2 sibling on v1', () => {
    // The package allowlist is anchored per whole path segment, which is what
    // makes these sub-resources safe. If that ever changes, the extension
    // would start POSTing to routes the backend does not expose — and this is
    // the test that fails first.
    expect(agentWarmPath('abc-123')).toBe('/ai/agents/abc-123/warm');
    expect(cancelPath('req-1')).toBe('/ai/cancel/req-1');
    expect(conversationInboxPath('conv-1')).toBe('/ai/conversations/conv-1/inbox');
  });

  it('routes a mandate reference through the mandate door and an id through the agent door', () => {
    expect(agentTargetExecutePath('mandate:daily_brief')).toBe('/v2/ai/mandates/daily_brief');
    expect(agentTargetExecutePath('abc-123')).toBe('/v2/ai/agent/abc-123');
  });
});

const ORG = '11111111-1111-4111-8111-111111111111';

describe('the organization-context header has exactly one spelling', () => {
  it('is written by the package kernel under the name the server expects', () => {
    expect(applyOrganizationContextHeader({}, ORG)).toEqual({ 'X-Organization-Id': ORG });
  });

  it('preserves headers it did not write', () => {
    expect(applyOrganizationContextHeader({ Accept: 'application/json' }, ORG)).toEqual({
      Accept: 'application/json',
      'X-Organization-Id': ORG,
    });
  });

  it('is the SAME name this client reads back when it refuses an org-less request', () => {
    // The fail-closed check in rawRequest reads the header the kernel wrote.
    // Two spellings of one header would turn that check into a fail-open.
    expect(ORGANIZATION_CONTEXT_HEADER).toBe('X-Organization-Id');
  });

  it('is FAIL-CLOSED on a malformed organization id — it refuses to bind one', () => {
    // This is why buildHeaders catches: a corrupt stored org id must not throw
    // out of rawRequest (audit P1-3) and must not reach the wire either.
    expect(() => applyOrganizationContextHeader({}, 'not-a-uuid')).toThrow();
  });
});
