/**
 * A slim stream frame (`result_omitted`) never leaves a Pilot / Assistant tool row blank:
 * the row shows the preview, and opening it reads the full result by `chat.tool_call` id once.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchToolCallOutput = vi.fn();
vi.mock('@/lib/supabase/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/queries')>()),
  fetchToolCallOutput: (id: string) => fetchToolCallOutput(id),
}));

import type { ToolPartCall } from '@/state/chat';
import { ServerToolRow } from './ServerToolRow';
import { __resetLazyToolResultCache, omittedFromWire } from './lazy-tool-result';

afterEach(() => {
  cleanup();
  fetchToolCallOutput.mockReset();
  __resetLazyToolResultCache();
});

const SLIM_FRAME = {
  result: null,
  result_omitted: true,
  result_preview: '{"results": [{"title": "Result 0"',
  output_chars: 12_345,
  tool_call_id: 'tc-1',
};

function slimTool(): ToolPartCall {
  const omitted = omittedFromWire(SLIM_FRAME);
  if (!omitted) throw new Error('expected an omitted marker');
  return {
    kind: 'server',
    callId: 'call-1',
    toolName: 'lazy_probe_tool',
    phase: 'completed',
    startedAt: 1,
    endedAt: 2,
    resultOmitted: omitted,
  };
}

describe('lazy tool results in the extension chat rows', () => {
  it('reads the omitted marker off a tool_completed frame', () => {
    expect(omittedFromWire(SLIM_FRAME)).toEqual({
      toolCallId: 'tc-1',
      preview: SLIM_FRAME.result_preview,
      outputChars: 12_345,
    });
    expect(omittedFromWire({ result: { ok: true } })).toBeNull();
  });

  it('shows the preview, then loads the full result by id on click', async () => {
    fetchToolCallOutput.mockResolvedValue({ results: [{ title: 'FULL RESULT BODY' }] });
    render(<ServerToolRow tool={slimTool()} />);
    expect(fetchToolCallOutput).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Lazy Probe Tool/ }));
    expect(screen.getByText(/"title": "Result 0"/)).toBeTruthy();
    expect(fetchToolCallOutput).toHaveBeenCalledWith('tc-1');

    await waitFor(() => expect(screen.getByText(/FULL RESULT BODY/)).toBeTruthy());
    expect(fetchToolCallOutput).toHaveBeenCalledTimes(1);
  });

  it('names a failed read instead of showing nothing', async () => {
    fetchToolCallOutput.mockRejectedValue(new Error('Could not load this tool result: boom'));
    render(<ServerToolRow tool={slimTool()} />);
    fireEvent.click(screen.getByRole('button', { name: /Lazy Probe Tool/ }));
    await waitFor(() =>
      expect(screen.getByText(/Could not load this tool result: boom/)).toBeTruthy(),
    );
  });
});
