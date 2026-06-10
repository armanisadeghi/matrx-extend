import { log } from '@/lib/debug/log';
import { send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type { FetchAndParseRequest, FetchAndParseResult } from '@/lib/scrape/fetch-and-parse';
import { ensureOffscreen } from '@/lib/stream/offscreen-proxy';
import type { ToolHandler } from '@/lib/tools/types';
/**
 * `fetch_url_as_markdown` — fetch any HTTP URL, parse the HTML, return
 * the same scrape-pipeline output shape the user-facing **Scrape** tab
 * already produces.
 *
 * Cross-working: the actual fetch + parse runs in the offscreen
 * document (SW lacks DOMParser) and reuses
 * `src/lib/scrape/pipeline.ts` — defuddle / readability / turndown /
 * collectors / SEO audit. Same code path as the manual Scrape tab,
 * so improvements flow both ways.
 *
 * 📝 Notes:
 *    .research/proposed-tools-and-features.md (item #10)
 *    .research/tools-roadmap.md
 *
 * 🧪 Tests: docs/feature-tests.md → "fetch_url_as_markdown"
 */
import { z } from 'zod';

const FetchUrlAsMarkdownArgs = z.object({
  url: z.string().url(),
  /**
   * Send the user's cookies (so paywalled / logged-in pages return the
   * same content the user sees in their browser). Default false.
   */
  use_session: z.boolean().optional().default(false),
  /** Follow redirects. Default true. */
  follow_redirects: z.boolean().optional().default(true),
  /** Custom User-Agent. Defaults to the browser's. */
  user_agent: z.string().optional(),
  /** Cap returned markdown length. Default 200_000. */
  max_chars: z.number().int().positive().max(2_000_000).optional().default(200_000),
  /**
   * Include `links` / `images` / `videos` / `seo` in the response.
   * Default false to keep payloads small.
   */
  include_extras: z.boolean().optional().default(false),
});
type FetchUrlAsMarkdownArgs = z.infer<typeof FetchUrlAsMarkdownArgs>;

export const fetch_url_as_markdown: ToolHandler<FetchUrlAsMarkdownArgs, FetchAndParseResult> = {
  name: 'fetch_url_as_markdown',
  tier: 'read',
  argsSchema: FetchUrlAsMarkdownArgs,
  run: async (args) => {
    log.info('sw', `fetch_url_as_markdown: ${args.url} (session=${args.use_session})`);
    try {
      await ensureOffscreen();
    } catch (err) {
      return { ok: false, reason: `offscreen ensure failed: ${(err as Error).message}` };
    }
    const req: FetchAndParseRequest & { include_extras?: boolean } = {
      url: args.url,
      use_session: args.use_session,
      follow_redirects: args.follow_redirects,
      user_agent: args.user_agent,
      max_chars: args.max_chars,
      include_extras: args.include_extras,
    };
    try {
      return await send<typeof req, FetchAndParseResult>(CHANNELS.OFFSCREEN_FETCH_PAGE, req);
    } catch (err) {
      return { ok: false, reason: `offscreen RPC failed: ${(err as Error).message}` };
    }
  },
};

export const fetch_handlers = [fetch_url_as_markdown];
