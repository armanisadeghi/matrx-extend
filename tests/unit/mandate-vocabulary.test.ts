/**
 * `@ai-matrx/agents` 0.10.0's Consumer action: this extension stops NAMING
 * mandates. Every key it uses comes from the package's generated vocabulary,
 * so a rename or a retirement on the server fails type-check here instead of
 * 404ing in a user's browser.
 *
 * These assertions are the mechanical half of that. They go RED the moment
 * someone re-types a key literal that the platform does not declare — the exact
 * defect the mirror file used to allow.
 */

import { aiExtractMode } from '@/lib/data-pattern/modes/ai-extract';
import {
  DEFAULT_CHAT_MANDATE_KEY,
  DEFAULT_CHAT_MANDATE_REF,
  PATTERN_FROM_DATA_MANDATE_KEY,
  STRUCTURED_EXTRACTOR_MANDATE_KEY,
  STRUCTURED_EXTRACTOR_MANDATE_REF,
  isMandateAgentRef,
  mandateKeyFromAgentRef,
} from '@/lib/mandates';
import { MANDATE_KEYS, isMandateKey } from '@ai-matrx/agents/mandates';
import { describe, expect, it } from 'vitest';

describe('mandate vocabulary', () => {
  it('every key this extension ships is one the platform declares', () => {
    for (const key of [
      DEFAULT_CHAT_MANDATE_KEY,
      STRUCTURED_EXTRACTOR_MANDATE_KEY,
      PATTERN_FROM_DATA_MANDATE_KEY,
    ]) {
      expect(isMandateKey(key)).toBe(true);
    }
  });

  it('sources them from the package, not from a local literal', () => {
    expect(DEFAULT_CHAT_MANDATE_KEY).toBe(MANDATE_KEYS.extend__browser_chat);
    expect(STRUCTURED_EXTRACTOR_MANDATE_KEY).toBe(MANDATE_KEYS.extend__structured_extractor);
    expect(PATTERN_FROM_DATA_MANDATE_KEY).toBe(MANDATE_KEYS.extend__pattern_from_data);
  });

  it('the AI-extract mode default names a declared mandate too', () => {
    const config = aiExtractMode.defaultConfig();
    expect(config.mandate_key).toBe(MANDATE_KEYS.extend__structured_extractor);
    expect(isMandateKey(config.mandate_key)).toBe(true);
  });

  it('refs carry the key and resolve back to it', () => {
    expect(DEFAULT_CHAT_MANDATE_REF).toBe(`mandate:${DEFAULT_CHAT_MANDATE_KEY}`);
    expect(STRUCTURED_EXTRACTOR_MANDATE_REF).toBe(`mandate:${STRUCTURED_EXTRACTOR_MANDATE_KEY}`);
    expect(mandateKeyFromAgentRef(DEFAULT_CHAT_MANDATE_REF)).toBe(DEFAULT_CHAT_MANDATE_KEY);
  });

  it('parses a ref the SERVER may know and this build may not — routing is not a vocabulary check', () => {
    // A mandate declared after this version shipped must still go through the
    // mandate door. Narrowing this to the generated union would send it to the
    // agent-id route and fail naming the wrong thing.
    expect(isMandateAgentRef('mandate:declared.after.this.build')).toBe(true);
    expect(mandateKeyFromAgentRef('mandate:declared.after.this.build')).toBe(
      'declared.after.this.build',
    );
    expect(mandateKeyFromAgentRef('mandate:')).toBeNull();
    expect(mandateKeyFromAgentRef('some-agent-uuid')).toBeNull();
    expect(mandateKeyFromAgentRef(null)).toBeNull();
  });
});
