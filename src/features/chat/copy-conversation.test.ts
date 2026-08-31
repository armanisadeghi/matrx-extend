/**
 * THE COPY GATE: a render block copies out labelled `<kind name="…">` only
 * when the kernel did NOT check-and-fail its payload.
 *
 * 🚨 The fixture is NOT hand-written. `__fixtures__/server-render-blocks.json`
 * was produced by aidream's PRODUCTION block processor over answer text an
 * agent really emits, against the LIVE `content_ir` schemas — the same
 * fixture `components/kinds/render-block.test.tsx` renders from. The only
 * thing this file synthesizes is the DEGRADED state
 * (`root.kindState = "raw"`), which is exactly what the parser writes when a
 * payload fails the schema its kind declares.
 *
 * Why it matters: `kind` is PRESERVED on failure by design (content-ir KIND
 * PRESERVATION) — a broken `flashcard_set` stays a `flashcard_set`. Copying
 * that out under a `<kind name="flashcard_set">` label tells the AI on the
 * receiving end that the payload IS a valid deck. Adopting
 * @ai-matrx/content-ir 0.10.0's kindState audit, the copy path refuses `"raw"`
 * and ONLY `"raw"`.
 *
 * Proven failing before the guard landed: without the `kindState !== 'raw'`
 * condition in `formatRenderBlock`, the third case below emits
 * `<kind name="flashcard_set">` and the assertion fails.
 */

import { describe, expect, it } from 'vitest';
import { readInboundRenderBlock } from '@/lib/content-ir/inbound';
import fixture from '@/lib/content-ir/__fixtures__/server-render-blocks.json';
import {
  DEFAULT_MESSAGE_COPY_OPTIONS,
  formatAssistantBody,
} from './copy-conversation';
import type { ChatMessage } from '@/state/chat';

type FixtureBlock = {
  blockId: string;
  blockIndex: number;
  type: string;
  status: string;
  content?: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

const BLOCKS = (fixture as { blocks: Record<string, FixtureBlock> }).blocks;

/** The real server block, optionally with its envelope's `kindState` forced. */
function copyOfFlashcardSet(kindState?: string): string {
  const source = BLOCKS.flashcard_set;
  expect(source, 'the flashcard_set fixture is missing').toBeTruthy();

  let metadata = source!.metadata;
  if (kindState !== undefined) {
    const envelope = JSON.parse(
      JSON.stringify(source!.metadata!.__ir),
    ) as { root: Record<string, unknown> };
    envelope.root.kindState = kindState;
    metadata = { __ir: envelope };
  }

  const block = readInboundRenderBlock({ ...source!, metadata });
  expect(block, 'the fixture did not survive the wire gate').not.toBeNull();

  const message: ChatMessage = {
    id: 'm1',
    role: 'assistant',
    content: '',
    parts: [{ type: 'block', block: block! }],
    timestamp: 0,
  };
  return formatAssistantBody(message, DEFAULT_MESSAGE_COPY_OPTIONS);
}

describe('copying a server-built render block', () => {
  it('copies a real envelope as its zero-loss value under a kind label', () => {
    const out = copyOfFlashcardSet();
    expect(out).toContain('<kind name="flashcard_set">');
    // `__kind` is PART OF THE DATA and is never stripped on the way out.
    expect(out).toContain('__kind');
  });

  it('keeps an "unverified" kind labelled — no schema ever existed, the identity is real', () => {
    const out = copyOfFlashcardSet('unverified');
    expect(out).toContain('<kind name="flashcard_set">');
  });

  it('never labels a CHECKED-AND-FAILED payload with its kind', () => {
    const out = copyOfFlashcardSet('raw');
    expect(out).not.toContain('<kind name=');
    // It degrades to the block's own text, never to nothing and never to a
    // confident lie about what the payload is.
    expect(out).toBe((BLOCKS.flashcard_set!.content ?? '').trim());
  });
});
