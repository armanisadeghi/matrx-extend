/**
 * Build the agent-start request behind the SEO tab's "AI recommendations"
 * section.
 *
 * WHAT GETS SENT: the WHOLE `SeoAudit` object, as one `page_seo_audit` context
 * key. That is deliberate and matches the context doctrine in CLAUDE.md
 * ("menu cost, not payload cost" — a key costs one line in the model's
 * advertised-key list regardless of payload size, so one rich bundle beats
 * hand-trimmed fragments). Trimming here would also silently diverge from the
 * audit contract in `./audit.ts`, which is a declared mirror of the server's
 * `seo_audit.py` — every field in it is a real measurement someone can act on.
 *
 * The run is EPHEMERAL. `conversation_id` is still minted client-side and
 * `is_new` is still sent because aidream rejects a start request without them
 * (422); `store: false` is the only thing that makes the run leave no trace.
 * See CLAUDE.md § "Every agent-start request MUST send…".
 */

import type { AgentStartRequest } from '@/lib/api/routes/ai';
import type { SeoAudit } from '@/lib/seo/audit';

/**
 * The ask. Written for a NON-TECHNICAL subject-matter expert (see USER.md) —
 * the person reading the output is an expert at their topic, not at SEO, so
 * the agent is told to explain the "why" and give copy-paste-ready fixes
 * rather than emit a jargon checklist.
 */
export const SEO_RECOMMENDATIONS_PROMPT = [
  'You are reviewing the SEO audit of a single web page. The full audit is in',
  'the `page_seo_audit` context key — read it before answering.',
  '',
  'Write recommendations for someone who is an expert in their own field but',
  'NOT an SEO specialist. Rules:',
  '- Lead with the highest-impact problems. If the page is in good shape, say so',
  '  plainly instead of inventing work.',
  '- For each recommendation: what to change, why it matters in one sentence,',
  '  and the exact replacement text where one applies (a rewritten title tag, a',
  '  meta description, an alt attribute) so it can be pasted straight in.',
  '- Use the real numbers from the audit (title length, missing alt counts,',
  '  heading structure, word count, readability) — never guess at a value.',
  '- No preamble, no closing summary, no offer to help further.',
  '',
  'Format as short markdown sections with a bolded lead line per item.',
].join('\n');

/**
 * Assemble the ephemeral start request for one audit.
 *
 * @param audit The audit exactly as produced by `runAudit` — passed whole.
 * @param conversationId Injected so callers/tests can supply a deterministic
 *   id; production callers omit it and get a fresh `crypto.randomUUID()`.
 */
export function buildSeoRecommendationsRequest(
  audit: SeoAudit,
  conversationId: string = crypto.randomUUID(),
): Omit<AgentStartRequest, 'organization_id'> {
  return {
    user_input: SEO_RECOMMENDATIONS_PROMPT,
    // All three are REQUIRED by the server on every start request.
    conversation_id: conversationId,
    is_new: true,
    store: false,
    context: {
      page_seo_audit: audit,
      page_brief: {
        url: audit.url,
        title: audit.title.value,
        lang: audit.lang,
      },
    },
    source_app: 'matrx-extend',
    source_feature: 'seo-recommendations',
    // No `client` capability envelope on purpose: everything the model needs
    // is already in `context`, so this run needs zero client tool round-trips.
  };
}
