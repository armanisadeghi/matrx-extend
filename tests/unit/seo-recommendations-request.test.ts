/**
 * The SEO tab's "AI recommendations" run is an EPHEMERAL agent start. Two
 * things about that request are load-bearing and invisible at compile time:
 *
 *   1. aidream rejects any start request missing `conversation_id` / `is_new` /
 *      `store` with a 422 (CLAUDE.md § "Every agent-start request MUST send…").
 *      `store: false` — not a missing id — is what makes the run leave no trace.
 *   2. The WHOLE audit ships as one context bundle. Trimming it would diverge
 *      from `lib/seo/audit.ts`, which is a declared mirror of the server's
 *      auditor, and would strip measurements the user can act on.
 */

import { runAudit } from '@/lib/seo/audit';
import {
  SEO_RECOMMENDATIONS_PROMPT,
  buildSeoRecommendationsRequest,
} from '@/lib/seo/recommendations';
import { describe, expect, it } from 'vitest';

function sampleAudit() {
  const doc = new DOMParser().parseFromString(
    `<html lang="en"><head><base href="https://example.com/p"><title>A title</title>
     <meta name="description" content="A description">
     <link rel="canonical" href="https://example.com/p"></head>
     <body><h1>Heading</h1><p>One sentence here. And a second one.</p>
     <img src="a.png"><img src="b.png" alt="b"></body></html>`,
    'text/html',
  );
  return runAudit(doc, 'https://example.com/p');
}

describe('buildSeoRecommendationsRequest', () => {
  it('sends all three fields aidream requires on a start request', () => {
    const req = buildSeoRecommendationsRequest(sampleAudit(), 'fixed-id');
    expect(req.conversation_id).toBe('fixed-id');
    expect(req.is_new).toBe(true);
    // The ONLY ephemeral signal. A missing conversation_id is a 422, not a
    // way to make a run ephemeral.
    expect(req.store).toBe(false);
  });

  it('mints a conversation id when the caller supplies none', () => {
    const a = buildSeoRecommendationsRequest(sampleAudit());
    const b = buildSeoRecommendationsRequest(sampleAudit());
    expect(a.conversation_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(a.conversation_id).not.toBe(b.conversation_id);
  });

  it('ships the WHOLE audit object under page_seo_audit, untrimmed', () => {
    const audit = sampleAudit();
    const req = buildSeoRecommendationsRequest(audit, 'fixed-id');
    const sent = (req.context as { page_seo_audit: unknown }).page_seo_audit;
    // Identity, not a reshaped subset — every key the auditor produced.
    expect(sent).toEqual(audit);
    expect(Object.keys(sent as object).sort()).toEqual(Object.keys(audit).sort());
  });

  it('carries the ask and the telemetry tags', () => {
    const req = buildSeoRecommendationsRequest(sampleAudit(), 'fixed-id');
    expect(req.user_input).toBe(SEO_RECOMMENDATIONS_PROMPT);
    expect(req.source_app).toBe('matrx-extend');
    expect(req.source_feature).toBe('seo-recommendations');
  });

  it('advertises no client capability — the run needs no browser tools', () => {
    const req = buildSeoRecommendationsRequest(sampleAudit(), 'fixed-id');
    expect(req.client).toBeUndefined();
  });
});
