/**
 * Per-domain memory tools.
 *
 * `remember_for_domain` — agent calls this whenever it learns something
 * worth remembering about a domain ("PO submit button is the third
 * primary"; "DOB format is MM/DD/YYYY"). The note shows up in
 * `domain_memo` context on every future visit to that domain.
 *
 * Persistence: chrome.storage.local. Survives across runs and conversations.
 * Per-extension-install (would sync across devices if we used storage.sync,
 * but the size cap there is 100KB — we use local for headroom).
 */

import { rememberForDomain } from '@/lib/chat/context/domain-memo';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

const RememberArgs = z
  .object({
    /**
     * The domain this memo applies to. Use the bare hostname
     * ("github.com", "atlassian.net"). Memos on a parent domain
     * automatically apply to subdomains — e.g., a memo for
     * "atlassian.net" appears on "foo.atlassian.net".
     */
    domain: z.string().min(3).max(253),
    /**
     * Free-form note to remember about the domain. Past lessons,
     * site-specific quirks, "what worked here last time" notes.
     * Capped at 500 chars per note. Notes accumulate; older ones
     * fall off after 50.
     */
    note: z.string().min(1).max(500).optional(),
    /**
     * Structured key/value hints. Use for things you'll want to look
     * up by name later — date format, primary CTA selector, default
     * username — vs prose-style notes.
     */
    hints: z.record(z.string(), z.string().max(500)).optional(),
  })
  .refine((d) => d.note !== undefined || (d.hints && Object.keys(d.hints).length > 0), {
    message: 'must provide note or at least one hint',
  });
type RememberArgs = z.infer<typeof RememberArgs>;

export const remember_for_domain: ToolHandler<RememberArgs, unknown> = {
  name: 'remember_for_domain',
  tier: 'action',
  argsSchema: RememberArgs,
  run: async (args) => {
    const memo = await rememberForDomain({
      domain: args.domain,
      note: args.note,
      hints: args.hints,
    });
    return { ok: true, memo };
  },
};

export const memory_handlers = [remember_for_domain];
