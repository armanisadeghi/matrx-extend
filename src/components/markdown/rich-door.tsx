/**
 * The extension's ONE door onto @ai-matrx/rich-content. `Markdown` and `MarkdownView` both render
 * through it, with the side-panel look the hand-rolled renderers had: compact density, github code
 * colours, one-line code header, plain GFM (no math, HTML shown as text), images load at once, and
 * the theme from the extension's own settings store.
 *
 * The `registry.xml` renderers (thinking / reasoning / reflection) become rich-content `customTags`.
 * `registry.code` / `registry.json` have no rich-content hook; no caller registers any today, and a
 * non-empty one announces itself in dev instead of being dropped silently.
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
      source={content}
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
