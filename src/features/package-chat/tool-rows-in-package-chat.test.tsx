/**
 * The extension's browser-tool rows in the package chat: drawn by the package's one config-driven row,
 * through the package's renderer registry, from THIS extension's row configs (the same text the
 * extension's own chat shows). An unregistered tool keeps no tuned row.
 */
import { toolDisplayRegistry } from '@/features/chat/tool-display/registry';
import { CONFIGURED_ROW_NAMES } from '@/features/chat/tool-display/row-names';
import {
  getToolChrome,
  hasCustomRenderer,
} from '@ai-matrx/chat/tool-call-visualization/registry/registry';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { registerExtensionToolRenderers } from './tool-renderers';

afterEach(cleanup);

describe("the extension's browser-tool rows in the package chat", () => {
  registerExtensionToolRenderers();

  it('registers a row for every configured tool, bare and executor-prefixed', () => {
    const plain = Object.keys(toolDisplayRegistry).filter(
      (k) => !toolDisplayRegistry[k]?.CustomComponent,
    );
    expect([...CONFIGURED_ROW_NAMES].sort()).toEqual(plain.sort());
    for (const name of CONFIGURED_ROW_NAMES) {
      expect(hasCustomRenderer(name)).toBe(true);
      expect(hasCustomRenderer(`matrx-extend:${name}`)).toBe(true);
      expect(getToolChrome(name)).toBe('row');
    }
  });
});
