import { ToolsView } from '@/features/tools/ToolsView';
import { CHANNELS } from '@/lib/messaging/schemas';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ run: vi.fn(), broadcast: vi.fn() }));
vi.mock('@/lib/tools/registry', async () => {
  const { z } = await import('zod');
  return {
    listAllHandlers: () => [
      {
        name: 'data_patterns',
        tier: 'action',
        argsSchema: z.object({
          action: z.literal('save'),
          kind: z.literal('network_capture'),
          name: z.string(),
          domain: z.string().optional(),
          config: z.record(z.string(), z.unknown()),
        }),
        run: deps.run,
      },
    ],
  };
});
vi.mock('@/hooks/use-tool-descriptions', () => ({ useToolDescriptions: () => new Map() }));
vi.mock('@/features/tools/SmartTestsView', () => ({ SmartTestsView: () => null }));
vi.mock('@/features/tools/RecorderPane', () => ({ RecorderPane: () => null }));
vi.mock('@/components/CopyMenu', () => ({ CopyButton: () => null }));
vi.mock('@/lib/messaging/native', () => ({ broadcast: deps.broadcast }));

describe('D48 manual Tools runner observation boundary', () => {
  it('uses safe Network save arguments in the timeline and actual handler call', async () => {
    deps.run.mockResolvedValue({ ok: true, id: 'saved' });
    render(<ToolsView />);
    fireEvent.click(screen.getByRole('button', { name: /data_patterns/i }));
    const input = screen.getByPlaceholderText('{"selector": "h1"}');
    fireEvent.change(input, {
      target: {
        value: JSON.stringify({
          action: 'save',
          kind: 'network_capture',
          domain: 'calendar.invalid',
          name: 'Network: https://user:SYNTHETIC_PASSWORD@calendar.invalid/api?access_token=SYNTHETIC_TOKEN',
          config: {
            url_filter: 'https://calendar.invalid/api?date=2026-09-27&access_token=SYNTHETIC_TOKEN',
            body_match: 'ignore',
          },
        }),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() => expect(deps.run).toHaveBeenCalledTimes(1));
    const started = deps.broadcast.mock.calls.find(
      ([kind, payload]) => kind === CHANNELS.TOOL_TIMELINE_EVENT && payload.phase === 'started',
    );
    expect(started).toBeDefined();
    expect(JSON.stringify([started, deps.run.mock.calls])).not.toMatch(
      /SYNTHETIC_(TOKEN|PASSWORD)/,
    );
    expect(JSON.stringify(deps.run.mock.calls)).toContain('date=2026-09-27');
  });
});
