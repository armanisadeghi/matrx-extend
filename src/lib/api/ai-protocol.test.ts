/**
 * THE PATH GUARD — every path helper in `routes/ai.ts` produces the plain
 * `/ai/...` string, and the organization-context header has one spelling.
 *
 * Expected strings are literals ON PURPOSE: deriving them from the code under
 * test would prove nothing.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/config/backend', () => ({ getBackendUrl: async () => 'https://example.invalid' }));

import { storedMandateKey } from '@/lib/mandates';
import { applyOrganizationContextHeader } from '@ai-matrx/api';
import { ORGANIZATION_CONTEXT_HEADER } from './client';
import {
  CHAT_PATH,
  agentExecutePath,
  agentTargetExecutePath,
  mandateExecutePath,
} from './routes/ai';

describe('AI path helpers emit the plain /ai form', () => {
  it('emits the run-start doors', () => {
    expect(agentExecutePath('abc-123')).toBe('/ai/agent/abc-123');
    expect(mandateExecutePath(storedMandateKey('daily_brief'))).toBe('/ai/mandates/daily_brief');
    expect(CHAT_PATH).toBe('/ai/chat');
  });

  it('still percent-encodes the interpolated segment', () => {
    expect(agentExecutePath('a/b c')).toBe('/ai/agent/a%2Fb%20c');
    expect(mandateExecutePath(storedMandateKey('a/b'))).toBe('/ai/mandates/a%2Fb');
  });

  it('routes a mandate reference through the mandate door and an id through the agent door', () => {
    expect(agentTargetExecutePath('mandate:daily_brief')).toBe('/ai/mandates/daily_brief');
    expect(agentTargetExecutePath('abc-123')).toBe('/ai/agent/abc-123');
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
