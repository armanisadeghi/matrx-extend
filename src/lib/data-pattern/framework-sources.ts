import { unflatten } from 'devalue';
import { type FrameworkDumpSource, frameworkDumpInPage } from './framework-dump';
import type { JsonKeyPath } from './json-key-path';
import type { ExtractedRow } from './types';

export type FrameworkSource = FrameworkDumpSource & { error?: string };

/** Decode after the page-to-extension boundary, where package imports are available. */
export function decodeFrameworkSources(sources: FrameworkDumpSource[]): FrameworkSource[] {
  return sources.map(({ source, data }) => {
    if (source !== '__NUXT_DATA__' || !Array.isArray(data)) return { source, data };
    try {
      // Nuxt's built-in payload reducers wrap Vue refs/reactive state. We need
      // the contained data for inspection, not Vue proxies in the extension.
      // Unknown site-defined revivers still fail explicitly in unflatten.
      const emptyRef = (value: unknown): unknown => {
        if (value === '_') return undefined;
        if (value === '0n') return BigInt(0);
        if (typeof value !== 'string') return value;
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      };
      const decoded: unknown = unflatten(data, {
        Reactive: (value: unknown) => value,
        ShallowReactive: (value: unknown) => value,
        Ref: (value: unknown) => value,
        ShallowRef: (value: unknown) => value,
        EmptyRef: emptyRef,
        EmptyShallowRef: emptyRef,
        NuxtError: (value: unknown) => value,
      });
      // devalue also revives Set, Map, Date and other JS values. Project them
      // into inspectable plain data; reject cycles or unfamiliar classes.
      const ancestors = new WeakSet<object>();
      const toNavigable = (value: unknown): unknown => {
        if (typeof value === 'bigint') return value.toString();
        if (value === null || typeof value !== 'object') return value;
        if (ancestors.has(value)) throw new Error('cyclic references');
        ancestors.add(value);
        let projected: unknown;
        if (Array.isArray(value)) projected = value.map(toNavigable);
        else if (value instanceof Set) projected = Array.from(value, toNavigable);
        else if (value instanceof Map)
          projected = Array.from(value, ([key, entry]) => ({
            key: toNavigable(key),
            value: toNavigable(entry),
          }));
        else if (value instanceof Date) projected = value.toISOString();
        else if (value instanceof RegExp || value instanceof URL) projected = value.toString();
        else if (value instanceof Error) projected = { name: value.name, message: value.message };
        else if (ArrayBuffer.isView(value) && !(value instanceof DataView))
          projected = Array.from(value as Uint8Array);
        else if (
          Object.getPrototypeOf(value) === Object.prototype ||
          Object.getPrototypeOf(value) === null
        ) {
          projected = Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, toNavigable(entry)]),
          );
        } else throw new Error(`unsupported ${Object.prototype.toString.call(value)} value`);
        ancestors.delete(value);
        return projected;
      };
      return { source, data: toNavigable(decoded) };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        source,
        data: undefined,
        error: `Nuxt page data could not be decoded: ${detail}. Try another Showcase source or AI Extract.`,
      };
    }
  });
}

export async function readFrameworkSources(
  tabId: number,
  requestedSource?: string,
): Promise<FrameworkSource[]> {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: frameworkDumpInPage,
  });
  if (!Array.isArray(result?.[0]?.result)) {
    throw new Error('The page did not return framework data. Reload the page and try again.');
  }
  const rawSources = result[0].result as FrameworkDumpSource[];
  if (requestedSource !== undefined) {
    const selected = rawSources.find((candidate) => candidate.source === requestedSource);
    if (!selected) {
      throw new Error(
        `Framework source "${requestedSource}" is no longer on this page. Open Framework, choose an available source, and save the pattern again.`,
      );
    }
    return decodeFrameworkSources([selected]);
  }
  return decodeFrameworkSources(rawSources);
}

export function rowsFromFrameworkSources(
  sources: FrameworkSource[],
  config: { source?: string | undefined; key_path: JsonKeyPath },
): ExtractedRow[] {
  const picked =
    config.source != null
      ? sources.find((candidate) => candidate.source === config.source)
      : (sources.find((candidate) => !candidate.error) ?? sources[0]);
  if (!picked) {
    if (config.source != null) {
      throw new Error(
        `Framework source "${config.source}" is no longer on this page. Open Framework, choose an available source, and save the pattern again.`,
      );
    }
    return [];
  }
  if (picked.error) throw new Error(picked.error);
  const keyParts =
    typeof config.key_path === 'string'
      ? config.key_path
        ? config.key_path.split('.')
        : []
      : (config.key_path ?? []);
  let target: unknown = picked.data;
  for (const part of keyParts) {
    if (target == null || typeof target !== 'object' || !Object.hasOwn(target, part)) {
      if (picked.source === '__NUXT_DATA__') {
        throw new Error(
          'This Nuxt key path no longer names page data. Open Framework, choose a field in the decoded tree, and save the pattern again.',
        );
      }
      return [];
    }
    target = (target as Record<string, unknown>)[part];
  }
  if (Array.isArray(target)) return target as ExtractedRow[];
  if (target && typeof target === 'object') return [target as ExtractedRow];
  if (target != null) return [{ value: target }];
  return [];
}

export async function runFrameworkPattern(
  tabId: number,
  config: { source?: string | undefined; key_path: JsonKeyPath },
): Promise<ExtractedRow[]> {
  const sources = await readFrameworkSources(tabId, config.source);
  return rowsFromFrameworkSources(sources, config);
}
