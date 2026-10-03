import { ToolsView } from '@/features/tools/ToolsView';
import { CHANNELS } from '@/lib/messaging/schemas';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ localRun: vi.fn(), serverRun: vi.fn(), broadcast: vi.fn() }));
vi.mock('@/lib/tools/registry', async () => {
  const { z } = await import('zod');
  return {
    listAllHandlers: () => [
      {
        name: 'records',
        tier: 'action',
        argsSchema: z.object({ action: z.literal('guide') }),
        run: h.localRun,
      },
    ],
  };
});
vi.mock('@/lib/tools/manual-server', () => ({
  getManualServerToolDefinition: async () => ({
    parameters: {
      action: { type: 'string', enum: ['guide', 'form_propose'] },
      args: { type: 'object' },
      $variants: { form_propose: { fields: { type: 'array', required: true } } },
    },
  }),
  runManualServerTool: (...args: unknown[]) => h.serverRun(...args),
}));
vi.mock('@/hooks/use-tool-descriptions', () => ({ useToolDescriptions: () => new Map() }));
vi.mock('@/features/tools/SmartTestsView', () => ({ SmartTestsView: () => null }));
vi.mock('@/features/tools/RecorderPane', () => ({ RecorderPane: () => null }));
vi.mock('@/components/CopyMenu', () => ({ CopyButton: () => null }));
vi.mock('@/lib/messaging/native', () => ({ broadcast: h.broadcast }));

describe('manual Records in Tools', () => {
  afterEach(cleanup);
  beforeEach(() => {
    h.localRun.mockReset();
    h.serverRun.mockReset().mockResolvedValue({ success: true, output: { form_id: 'f1' } });
    h.broadcast.mockReset();
  });

  it('shows the action variants and sends a platform action through the server', async () => {
    render(<ToolsView />);
    fireEvent.click(screen.getByRole('button', { name: /records/i }));
    expect(await screen.findByText(/form_propose/)).toBeTruthy();
    const args = { action: 'form_propose', args: { fields: [{ name: 'Email' }] } };
    fireEvent.change(screen.getByPlaceholderText('{"selector": "h1"}'), {
      target: { value: JSON.stringify(args) },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() => expect(h.serverRun).toHaveBeenCalledWith('records', args));
    expect(h.localRun).not.toHaveBeenCalled();
    expect(await screen.findByText(/form_id/)).toBeTruthy();
  });

  it('marks a completed stream with a refused tool result as failed', async () => {
    h.serverRun.mockResolvedValue({ success: false, error: { message: 'Store is closed' } });
    render(<ToolsView />);
    fireEvent.click(screen.getByRole('button', { name: /records/i }));
    await screen.findByText(/form_propose/);
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() =>
      expect(h.broadcast).toHaveBeenCalledWith(
        CHANNELS.TOOL_TIMELINE_EVENT,
        expect.objectContaining({ phase: 'error' }),
      ),
    );
    expect(h.broadcast).not.toHaveBeenCalledWith(
      CHANNELS.TOOL_TIMELINE_EVENT,
      expect.objectContaining({ phase: 'completed' }),
    );
    expect(await screen.findByText(/Store is closed/)).toBeTruthy();
  });
});
