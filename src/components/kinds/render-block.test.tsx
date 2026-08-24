/**
 * THE END-TO-END PROOF that this client renders server-built kinds.
 *
 * 🚨 The fixture is NOT hand-written. `__fixtures__/server-render-blocks.json`
 * was produced by running aidream's PRODUCTION block processor over answer
 * text an agent really emits, against the LIVE `content_ir` schemas. If these
 * tests passed on a hand-built envelope they would prove nothing — that is
 * exactly how the render-block channel stayed dead for months.
 *
 * What is exercised here: the kernel's inbound envelope gate, the SHARED kind
 * route from `@ai-matrx/content-ir-react`, this client's resolver, and the
 * real components. Only the DB is stubbed — the registries are fed the same
 * rows `content_ir.kind_component` holds for `platform='chrome-extension'`.
 */

import { afterEach, describe, expect, it, beforeAll } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readInboundRenderBlock } from '@/lib/content-ir/inbound';
import { componentRegistry, kindRegistry } from '@/lib/content-ir/registry';
import { RenderBlockView } from './RenderBlockView';
import fixture from '@/lib/content-ir/__fixtures__/server-render-blocks.json';

type FixtureBlock = { blockId: string; blockIndex: number; type: string; status: string;
  content?: string; data?: Record<string, unknown>; metadata?: Record<string, unknown> };
const BLOCKS = (fixture as { blocks: Record<string, FixtureBlock> }).blocks;

/**
 * The LIVE rows, verbatim (migration
 * 2026_08_23_kind_component_chrome_extension.sql). Feeding the resolver
 * exactly what the DB holds is what makes this a test of the wiring rather
 * than of a mock.
 */
const ROWS = [
  { kind: 'flashcard_set', componentKey: 'flashcard_set_panel' },
  { kind: 'quiz_set', componentKey: 'quiz_set_panel' },
  { kind: 'research_report', componentKey: 'not_mapped_in_this_client' },
].map((row) => ({
  ...row,
  platform: 'chrome-extension',
  role: 'output' as const,
  source: 'bundled',
  config: {},
  isActive: true,
  componentSource: null,
  propsTransform: null,
  pinnedKindVersion: null,
  updatedAt: null,
  createdBy: null,
}));

beforeAll(() => {
  componentRegistry.replaceDbRows(ROWS);
  // The kind source answers "is this registered" — the split between a KNOWN
  // shape (generic floor) and an unknown slug (untouched).
  for (const kind of ['flashcard_set', 'quiz_set', 'research_report']) {
    (kindRegistry as unknown as { known: Map<string, unknown> }).known.set(kind, {
      kind, schema: null, schemaSource: 'content_ir', tier: 'warm',
    });
  }
});

// RTL auto-cleanup needs vitest globals, which this repo does not enable —
// without this, `screen` queries the previous test's DOM too.
afterEach(cleanup);

function renderFixture(name: keyof typeof BLOCKS) {
  const block = readInboundRenderBlock(BLOCKS[name]);
  expect(block, `fixture "${String(name)}" did not survive the wire gate`).not.toBeNull();
  return render(<RenderBlockView block={block!} />);
}

describe('server-built render blocks reach real components', () => {
  it('keeps the envelope through the wire gate', () => {
    const block = readInboundRenderBlock(BLOCKS.flashcard_set);
    expect(block?.metadata?.__ir).toBeTruthy();
  });

  it('renders a flashcard_set as a deck, not as text', () => {
    renderFixture('flashcard_set');
    expect(screen.getByText('What pigment absorbs light?')).toBeTruthy();
    // The answer is HIDDEN until the card is turned — a flashcard whose back
    // is already visible has stopped being a flashcard.
    expect(screen.queryByText('Chlorophyll.')).toBeNull();
    expect(screen.getAllByText('Show answer').length).toBeGreaterThan(0);
  });

  it('renders a quiz_set as answerable choices with the answer withheld', () => {
    renderFixture('quiz_set');
    expect(screen.getByText(/Which pigment absorbs light\?/)).toBeTruthy();
    expect(screen.getByText('Carotene')).toBeTruthy();
    // The explanation only appears after the user commits to an answer.
    expect(screen.queryByText(/absorbs blue and red/i)).toBeNull();
  });

  it('sends a KNOWN kind with no component here to the honest floor', () => {
    // Same real envelope, relabelled to a kind this client maps no component
    // for — the R6 disposition: readable data plus a muted "no custom view"
    // note, never an error and never a blank block.
    const source = BLOCKS.flashcard_set;
    expect(source, 'the flashcard_set fixture is missing').toBeTruthy();
    const envelope = JSON.parse(JSON.stringify(source!.metadata!.__ir)) as {
      root: { kind: string };
    };
    envelope.root.kind = 'research_report';
    const block = readInboundRenderBlock({ ...source!, metadata: { __ir: envelope } });
    expect(block).not.toBeNull();
    render(<RenderBlockView block={block!} />);
    expect(screen.getByText(/no custom view/i)).toBeTruthy();
    // The data is still there — nothing vanished.
    expect(screen.getByText(/What pigment absorbs light\?/)).toBeTruthy();
  });
});
