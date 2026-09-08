/**
 * THE SEAM between this extension and THE ONE agent picker.
 *
 * The `agx_get_list_full` row shape is no longer validated here — the read, the
 * schema and the row normalizer live in `@ai-matrx/agents/catalog` (its own
 * 295-case parity matrix owns that contract, and duplicating it here would be a
 * second source of truth that drifts). What this file guards is the ONE thing
 * still split across the boundary: the id the package hands back on `onSelect`
 * must be exactly the id this extension's send path knows how to route.
 */

import { describe, expect, it } from 'vitest';

import { agentTargetExecutePath, mandateExecutePath } from '@/lib/api/routes/ai';
import {
  DEFAULT_CHAT_MANDATE_KEY,
  DEFAULT_CHAT_MANDATE_REF,
  STRUCTURED_EXTRACTOR_MANDATE_KEY,
  STRUCTURED_EXTRACTOR_MANDATE_REF,
  mandateKeyFromAgentRef,
} from '@/lib/mandates';
import { isMandateAgentId, mandateAgentId } from '@ai-matrx/agents/catalog';

describe('package picker id shape ⇄ extension send path', () => {
  it('the package mints the exact default-row ref this repo already speaks', () => {
    // If these ever diverge, every default-row selection would be sent to the
    // agent-id route as a literal `mandate:*` string and 404 at the server.
    expect(mandateAgentId(DEFAULT_CHAT_MANDATE_KEY)).toBe(DEFAULT_CHAT_MANDATE_REF);
    expect(mandateAgentId(STRUCTURED_EXTRACTOR_MANDATE_KEY)).toBe(STRUCTURED_EXTRACTOR_MANDATE_REF);
  });

  it('this repo and the package agree on what a mandate id looks like', () => {
    expect(isMandateAgentId(DEFAULT_CHAT_MANDATE_REF)).toBe(true);
    expect(mandateKeyFromAgentRef(DEFAULT_CHAT_MANDATE_REF)).toBe(DEFAULT_CHAT_MANDATE_KEY);

    const agentUuid = '1f365d07-cad3-4ef7-81fc-57a6c60767e7';
    expect(isMandateAgentId(agentUuid)).toBe(false);
    expect(mandateKeyFromAgentRef(agentUuid)).toBeNull();
  });

  it('routes each id shape to the right execute path', () => {
    expect(agentTargetExecutePath(mandateAgentId(DEFAULT_CHAT_MANDATE_KEY))).toBe(
      mandateExecutePath(DEFAULT_CHAT_MANDATE_KEY),
    );
    expect(mandateExecutePath(DEFAULT_CHAT_MANDATE_KEY)).toBe(
      '/v2/ai/mandates/extend.browser_chat',
    );

    const agentUuid = '1f365d07-cad3-4ef7-81fc-57a6c60767e7';
    expect(agentTargetExecutePath(agentUuid)).toContain(agentUuid);
    expect(agentTargetExecutePath(agentUuid)).not.toContain('mandates');
  });
});
