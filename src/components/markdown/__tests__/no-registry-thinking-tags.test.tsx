/**
 * With NO registry the old renderer showed `<thinking>` / `<reasoning>` as written; rich-content
 * strips them, which silently deleted a passage from the user's own bubble, a structured string and
 * an AI recommendation. The door escapes them to literal text when no registry handles them.
 * Callers: PilotView user bubble (`<Markdown content density="compact" />`), StructuredValue string
 * (same props), AiRecommendations (`className="text-xs"`).
 */
import { chatMarkdownRegistry } from '@/features/chat/markdown-registry';
import * as contentIr from '@ai-matrx/content-ir/source';
import { describe, expect, test } from 'vitest';
import { Markdown } from '../Markdown';
import {
  CHAIN_OF_THOUGHT_TAGS,
  keepPackageTagTextVisible,
  showChainOfThoughtTagsAsText,
} from '../rich-door';
import { renderShape } from './parity-shape';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = '<thinking>secret plan</thinking>\nVisible answer';
const LITERAL = '<thinking>secretplan</thinking>Visibleanswer';

describe('chain-of-thought tags with no registry stay as written', () => {
  test('user bubble shape (PilotView)', { timeout: 120_000 }, async () => {
    expect((await renderShape(<Markdown content={SRC} density="compact" />)).text).toBe(LITERAL);
  });
  test('structured string shape (StructuredValue)', { timeout: 120_000 }, async () => {
    const s = await renderShape(
      <Markdown content={'<reasoning>why</reasoning> then the result'} density="compact" />,
    );
    expect(s.text).toBe('<reasoning>why</reasoning>thentheresult');
  });
  test('recommendations shape (AiRecommendations)', { timeout: 120_000 }, async () => {
    const s = await renderShape(<Markdown content={SRC} density="compact" className="text-xs" />);
    expect(s.text).toBe(LITERAL);
  });
  test(
    'a registry that handles the tag still draws it (not literal)',
    { timeout: 120_000 },
    async () => {
      const s = await renderShape(<Markdown content={SRC} registry={chatMarkdownRegistry} />);
      expect(s.text).not.toContain('<thinking>');
      expect(s.text).toContain('Visibleanswer');
    },
  );
});

describe('showChainOfThoughtTagsAsText', () => {
  test('escapes outside code, leaves fences and inline code alone', () => {
    const src = 'a <thinking>x</thinking>\n```\n<thinking>y</thinking>\n```\n`<reasoning>` b';
    expect(showChainOfThoughtTagsAsText(src)).toBe(
      'a &lt;thinking>x&lt;/thinking>\n```\n<thinking>y</thinking>\n```\n`<reasoning>` b',
    );
  });
  test('leaves a tag the registry handles', () => {
    expect(showChainOfThoughtTagsAsText('<thinking>x</thinking>', new Set(['thinking']))).toBe(
      '<thinking>x</thinking>',
    );
  });
  test('plain text is returned untouched', () => {
    expect(showChainOfThoughtTagsAsText('hello <b>x</b>')).toBe('hello <b>x</b>');
  });
});

describe('the escape list cannot drift from content-ir', () => {
  test("every tag in content-ir's thinking family is escaped here", () => {
    const family = (contentIr as { THINKING_FAMILY?: readonly string[] }).THINKING_FAMILY;
    // Exported since the content-ir release after 0.24.38; until installed, the list below is the floor.
    for (const tag of family ?? ['thinking', 'think', 'reasoning']) {
      expect(CHAIN_OF_THOUGHT_TAGS as readonly string[]).toContain(tag);
      expect(showChainOfThoughtTagsAsText(`<${tag}>x</${tag}>`)).toBe(`&lt;${tag}>x&lt;/${tag}>`);
    }
  });
});

describe('package tags keep what the old renderer showed', () => {
  test('decision prompt and artifact title stay visible', { timeout: 120_000 }, async () => {
    const d = await renderShape(
      <Markdown content={'<decision id="d1" prompt="Pick a plan">\nA or B\n</decision>'} />,
    );
    expect(d.text).toContain('Pickaplan');
    expect(d.text).toContain('AorB');
    const a = await renderShape(
      <Markdown content={'<artifact title="Launch Doc" type="doc">\nbody text\n</artifact>'} />,
    );
    expect(a.text).toContain('LaunchDoc');
    expect(a.text).toContain('bodytext');
  });
  test(
    'a mid-sentence audiocite reads as one sentence, as written',
    { timeout: 120_000 },
    async () => {
      const s = await renderShape(
        <Markdown content={'See <audiocite start="1" end="2">this moment</audiocite> now'} />,
      );
      expect(s.text).toBe('See<audiocitestart="1"end="2">thismoment</audiocite>now');
      expect(s.code).toEqual([]);
    },
  );
  test('unit: transforms', () => {
    expect(keepPackageTagTextVisible('<decision prompt="P">\nx\n</decision>')).toBe(
      '<decision prompt="P">\nP\n\nx\n</decision>',
    );
    const alone = '<audiocite start="1">hi</audiocite>';
    expect(keepPackageTagTextVisible(alone)).toBe(alone);
    expect(keepPackageTagTextVisible('a <audiocite>hi</audiocite> b')).toBe(
      'a &lt;audiocite>hi&lt;/audiocite> b',
    );
    expect(keepPackageTagTextVisible('`<decision prompt="P">`')).toBe('`<decision prompt="P">`');
  });
});
