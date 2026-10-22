/**
 * The extension's ONE door onto @ai-matrx/rich-content. `Markdown` renders through it (`MarkdownView`
 * is a separate, not-yet-migrated renderer), with the side-panel look the hand-rolled renderers had: compact density, github code
 * colours, one-line code header, plain GFM (no math, HTML shown as text), images load at once, and
 * the theme from the extension's own settings store.
 *
 * The `registry.xml` renderers (thinking / reasoning / reflection) become rich-content `customTags`.
 * `registry.code` / `registry.json` have no rich-content hook; no caller registers any today, and a
 * non-empty one announces itself in dev instead of being dropped silently.
 *
 * With NO registry the old renderer showed `<thinking>` / `<think>` / `<reasoning>` as written; rich-content
 * strips them unconditionally, so the door escapes those tags to literal text first
 * (`showChainOfThoughtTagsAsText`) — the user's own bubble, a structured string and an AI
 * recommendation never lose a passage silently. A registry that handles a tag keeps it.
 */

import { cn } from '@/lib/utils';
import { RichContent } from '@ai-matrx/rich-content/levels/RichContent';
import type {
  CustomTagRendererProps,
  CustomTagRenderers,
} from '@ai-matrx/rich-content/levels/rich-content-types';
import { type ComponentType, useMemo } from 'react';
import type { MarkdownRegistry, XmlBlockRendererProps } from './registry';
import { useResolvedTheme } from './use-resolved-theme';

export interface RichMarkdownDoorProps {
  content: string;
  registry?: MarkdownRegistry | undefined;
  className?: string | undefined;
  /** True while the text is still streaming in (heals half-arrived syntax). */
  isStreaming?: boolean | undefined;
}

const adapterCache = new WeakMap<
  ComponentType<XmlBlockRendererProps>,
  ComponentType<CustomTagRendererProps>
>();

/** A registry xml renderer as a rich-content custom-tag renderer (same component, same props). */
function asCustomTag(
  Renderer: ComponentType<XmlBlockRendererProps>,
): ComponentType<CustomTagRendererProps> {
  const cached = adapterCache.get(Renderer);
  if (cached) return cached;
  function CustomTag({ tag, attrs, content, complete }: CustomTagRendererProps) {
    return <Renderer tag={tag} attrs={attrs} inner={content} complete={complete} />;
  }
  CustomTag.displayName = `CustomTag(${Renderer.displayName ?? Renderer.name ?? 'xml'})`;
  adapterCache.set(Renderer, CustomTag);
  return CustomTag;
}

/**
 * The tags rich-content strips as chain-of-thought: content-ir's thinking family plus the package's
 * `consolidated_reasoning`. `chain-of-thought-tags.test.tsx` fails if content-ir's own list
 * (`THINKING_FAMILY`, exported from `@ai-matrx/content-ir/source`) names a tag missing here.
 */
export const CHAIN_OF_THOUGHT_TAGS = [
  'thinking',
  'think',
  'reasoning',
  'consolidated_reasoning',
] as const;
const COT_TAG = new RegExp(`<(/?)(${CHAIN_OF_THOUGHT_TAGS.join('|')})\\b`, 'gi');

/** Apply `fn` to every stretch of text outside fenced code and inline code spans. */
function mapOutsideCode(source: string, fn: (piece: string) => string): string {
  let fence: string | null = null;
  return source
    .split('\n')
    .map((line) => {
      const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
      if (fence) {
        if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = null;
        return line;
      }
      if (mark) {
        fence = mark;
        return line;
      }
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, i) => (i % 2 === 1 ? part : fn(part)))
        .join('');
    })
    .join('\n');
}

/**
 * Escape chain-of-thought tags to literal text (`&lt;thinking>` draws as `<thinking>`), leaving
 * fenced code and inline code spans untouched (they already render as written).
 */
export function showChainOfThoughtTagsAsText(
  source: string,
  handled: ReadonlySet<string> = new Set(),
): string {
  COT_TAG.lastIndex = 0;
  if (!COT_TAG.test(source)) return source;
  COT_TAG.lastIndex = 0;
  const toLiteral = (whole: string, slash: string, name: string) =>
    handled.has(name.toLowerCase()) ? whole : `&lt;${slash}${name}`;
  return mapOutsideCode(source, (piece) => piece.replace(COT_TAG, toLiteral));
}

const ATTR_TAG = /<(decision|artifact)\b([^<>]*?)(\/?)>/gi;
const ATTR_VALUE = /\b(prompt|title)\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const AUDIOCITE = /<audiocite\b[^<>]*>.*?<\/audiocite\s*>/gi;

/**
 * rich-content draws `<decision prompt="...">` / `<artifact title="...">` with the attributes
 * dropped and `<audiocite>` as a block that splits its sentence. The old renderer showed both as
 * written, so nothing it showed is lost here:
 *   - the `prompt` / `title` value becomes the first line inside the tag;
 *   - an `<audiocite>` in the middle of a line is escaped to literal text (one standing alone on
 *     its line keeps the package rendering).
 */
export function keepPackageTagTextVisible(source: string): string {
  if (!/<(decision|artifact|audiocite)\b/i.test(source)) return source;
  return mapOutsideCode(source, (piece) =>
    piece
      .replace(ATTR_TAG, (whole, _name: string, attrs: string, selfClose: string) => {
        const m = ATTR_VALUE.exec(attrs);
        const value = m?.[2] ?? m?.[3];
        if (!value || selfClose) return whole;
        return `${whole}\n${value}\n`;
      })
      .replace(AUDIOCITE, (whole, offset: number, full: string) => {
        const before = full.slice(0, offset);
        const after = full.slice(offset + whole.length);
        if (before.trim() === '' && after.trim() === '') return whole;
        return whole.replace(/<(\/?)audiocite/gi, '&lt;$1audiocite');
      }),
  );
}

let warnedUnsupported = false;

export function RichMarkdownDoor({
  content,
  registry,
  className,
  isStreaming,
}: RichMarkdownDoorProps) {
  const themeMode = useResolvedTheme();
  const customTags = useMemo<CustomTagRenderers | undefined>(() => {
    const xml = registry?.xml;
    if (!xml || Object.keys(xml).length === 0) return undefined;
    const out: CustomTagRenderers = {};
    for (const [name, Renderer] of Object.entries(xml)) out[name] = asCustomTag(Renderer);
    return out;
  }, [registry?.xml]);

  const source = useMemo(
    () =>
      keepPackageTagTextVisible(
        showChainOfThoughtTagsAsText(
          content,
          new Set(Object.keys(registry?.xml ?? {}).map((n) => n.toLowerCase())),
        ),
      ),
    [content, registry?.xml],
  );

  if (
    !warnedUnsupported &&
    process.env.NODE_ENV !== 'production' &&
    (Object.keys(registry?.code ?? {}).length > 0 || Object.keys(registry?.json ?? {}).length > 0)
  ) {
    warnedUnsupported = true;
    console.warn(
      '[markdown] registry.code / registry.json renderers are not supported by rich-content; those blocks render as code.',
    );
  }

  return (
    <RichContent
      level="standard"
      source={source}
      {...(isStreaming !== undefined && { isStreaming })}
      className={cn('min-w-0 text-foreground [overflow-wrap:anywhere]', className)}
      density="compact"
      codeTheme="github"
      codeHeader="compact"
      remoteImages="always"
      imagePolicy="self"
      math={false}
      rawHtml={false}
      themeMode={themeMode}
      headingAnchors={false}
      {...(customTags && { customTags })}
    />
  );
}
