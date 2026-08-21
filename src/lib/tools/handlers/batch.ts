/**
 * `chrome_batch` — execute a sequence of read-tier tool calls in one round
 * trip.
 *
 * The agent benefits when it knows it'll need several reads back-to-back
 * (e.g. read_page → take_screenshot → list_open_tabs). Instead of N
 * separate tool turns, it calls chrome_batch once with N entries and gets
 * N results.
 *
 * SAFETY: only `read`-tier tools are allowed inside a batch in v1. That
 * keeps the permission gate simple — you can't smuggle a click + a navigate
 * past the user via a batch. Action / privileged tools require their normal
 * approval flow.
 *
 * The dispatcher already wraps this tool in its own permission gate; inside
 * we look up each handler from the registry and execute its `run` directly.
 */

import { categoryOf } from '@/lib/tools/categories';
import { lookup } from '@/lib/tools/registry';
import type { ToolContext, ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

const CallSchema = z.object({
  /** Tool name from the catalog. Must be a `read`-tier tool. */
  name: z.string().min(1),
  /** Arguments to pass; will be validated against the tool's argsSchema. */
  arguments: z.unknown().optional(),
});

const BatchArgs = z.object({
  calls: z.array(CallSchema).min(1).max(20),
  /** When true, stop on first failure. Default false (run all, collect results). */
  stop_on_error: z.boolean().optional().default(false),
});
type BatchArgs = z.infer<typeof BatchArgs>;

export const chrome_batch: ToolHandler<BatchArgs, unknown> = {
  name: 'chrome_batch',
  tier: 'read',
  argsSchema: BatchArgs,
  run: async (args, ctx: ToolContext) => {
    const results: Array<Record<string, unknown>> = [];
    for (let i = 0; i < args.calls.length; i++) {
      const call = args.calls[i];
      if (!call) continue;
      const handler = lookup(call.name);
      if (!handler) {
        results.push({ name: call.name, ok: false, error: 'unknown tool' });
        if (args.stop_on_error) break;
        continue;
      }
      if (handler.tier !== 'read') {
        results.push({
          name: call.name,
          ok: false,
          error: `batches only allow read-tier tools (this tool is ${handler.tier})`,
        });
        if (args.stop_on_error) break;
        continue;
      }
      const parsed = handler.argsSchema.safeParse(call.arguments ?? {});
      if (!parsed.success) {
        results.push({
          name: call.name,
          ok: false,
          error: `args invalid: ${JSON.stringify(parsed.error.format())}`,
        });
        if (args.stop_on_error) break;
        continue;
      }
      try {
        const out = await handler.run(parsed.data as never, {
          ...ctx,
          callId: `${ctx.callId}::batch[${i}]`,
        });
        results.push({
          name: call.name,
          category: categoryOf(call.name),
          ok: true,
          output: out,
        });
      } catch (err) {
        results.push({
          name: call.name,
          ok: false,
          error: (err as Error).message ?? String(err),
        });
        if (args.stop_on_error) break;
      }
    }
    return { count: results.length, results };
  },
};

export const batch_handlers = [chrome_batch];
