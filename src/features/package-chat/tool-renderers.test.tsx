import { hasCustomRenderer } from '@ai-matrx/chat/tool-call-visualization/registry/registry';
import { describe, expect, it } from 'vitest';
import { registerExtensionToolRenderers, toTimelineEntry } from './tool-renderers';

describe('extension tool rows in the package chat', () => {
  it('registers sleep and chrome_batch, with and without the executor prefix', () => {
    // Red before registration: the package has no row of its own for these extension tools.
    for (const name of [
      'sleep',
      'chrome_batch',
      'matrx-extend:sleep',
      'matrx-extend:chrome_batch',
    ]) {
      expect(hasCustomRenderer(name)).toBe(false);
    }
    registerExtensionToolRenderers();
    for (const name of [
      'sleep',
      'chrome_batch',
      'matrx-extend:sleep',
      'matrx-extend:chrome_batch',
    ]) {
      expect(hasCustomRenderer(name)).toBe(true);
    }
  });

  it('maps the package lifecycle onto the extension row (phase, timing, output, error)', () => {
    const row = toTimelineEntry({
      callId: 'call_7',
      toolName: 'matrx-extend:sleep',
      displayName: 'sleep',
      status: 'error',
      arguments: { seconds: 2 },
      startedAt: '2026-10-07T20:00:00.000Z',
      completedAt: '2026-10-07T20:00:02.000Z',
      latestMessage: null,
      latestData: null,
      result: null,
      resultPreview: null,
      errorType: 'timeout',
      errorMessage: 'Tab closed while waiting',
    } as never);
    expect(row).toMatchObject({
      callId: 'call_7',
      toolName: 'sleep',
      phase: 'error',
      args: { seconds: 2 },
      message: 'Tab closed while waiting',
      endedAt: Date.parse('2026-10-07T20:00:02.000Z'),
    });
    expect(toTimelineEntry({ ...row, status: 'progress', completedAt: null } as never).phase).toBe(
      'started',
    );
  });
});
