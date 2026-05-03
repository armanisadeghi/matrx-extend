/**
 * Renderer registry for the markdown system.
 *
 * Three layers, all optional:
 *   - `xml`  → keyed by tag name. Receives parsed attrs + inner text.
 *   - `code` → keyed by fence language (e.g. 'mermaid', 'sql'). Receives raw code.
 *   - `json` → keyed by the first key of the JSON payload inside a ```json block.
 *              Receives the parsed value.
 *
 * Keys are matched case-insensitively. Use `mergeRegistries` to layer a
 * surface-specific registry (e.g. chat) over a global default.
 */

import type { ComponentType } from 'react';

export interface XmlBlockRendererProps {
  tag: string;
  attrs: Record<string, string>;
  /** Raw inner text between opening and closing tags. Render as markdown if needed. */
  inner: string;
  /** False while the closing tag has not yet arrived in a streaming response. */
  complete: boolean;
}

export interface CodeBlockRendererProps {
  lang: string;
  code: string;
  complete: boolean;
}

export interface JsonBlockRendererProps {
  firstKey: string;
  data: unknown;
  /** Original raw JSON string. Useful for falling back if `data` cannot be parsed. */
  raw: string;
  complete: boolean;
}

export interface MarkdownRegistry {
  xml?: Record<string, ComponentType<XmlBlockRendererProps>>;
  code?: Record<string, ComponentType<CodeBlockRendererProps>>;
  json?: Record<string, ComponentType<JsonBlockRendererProps>>;
}

export function lookupXml(
  registry: MarkdownRegistry | undefined,
  tag: string,
): ComponentType<XmlBlockRendererProps> | null {
  if (!registry?.xml) return null;
  return registry.xml[tag] ?? registry.xml[tag.toLowerCase()] ?? null;
}

export function lookupCode(
  registry: MarkdownRegistry | undefined,
  lang: string,
): ComponentType<CodeBlockRendererProps> | null {
  if (!registry?.code) return null;
  return registry.code[lang] ?? registry.code[lang.toLowerCase()] ?? null;
}

export function lookupJson(
  registry: MarkdownRegistry | undefined,
  firstKey: string,
): ComponentType<JsonBlockRendererProps> | null {
  if (!registry?.json) return null;
  return registry.json[firstKey] ?? registry.json[firstKey.toLowerCase()] ?? null;
}

export function mergeRegistries(...registries: (MarkdownRegistry | undefined)[]): MarkdownRegistry {
  const out: MarkdownRegistry = { xml: {}, code: {}, json: {} };
  for (const r of registries) {
    if (!r) continue;
    if (r.xml) Object.assign(out.xml as object, r.xml);
    if (r.code) Object.assign(out.code as object, r.code);
    if (r.json) Object.assign(out.json as object, r.json);
  }
  return out;
}
