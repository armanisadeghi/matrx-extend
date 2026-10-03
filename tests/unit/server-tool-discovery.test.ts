import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/tools/registry', () => ({ listAllHandlers: () => [] }));
vi.mock('@/lib/tools/descriptions', () => ({
  ensureToolDescriptions: async () => new Map([['records', 'Canonical Records']]),
}));
import { discover_handlers, list_chrome_categories } from '@/lib/tools/handlers/discover';
import type { ToolContext } from '@/lib/tools/types';
const context = {} as ToolContext;

describe('server-owned discovery with no browser executor', () => {
  it('keeps Records in the category index', async () => {
    const result = (await list_chrome_categories.run({}, context)) as {
      categories: { name: string; tool_names: string[] }[];
    };
    expect(result.categories.find((category) => category.name === 'records')?.tool_names).toEqual([
      'records',
    ]);
  });
  it('returns a registered reference without fabricating a browser schema', async () => {
    const handler = discover_handlers.find((candidate) => candidate.name === 'list_records_tools');
    if (!handler) throw new Error('Records discovery tool is missing');
    const result = (await handler.run({}, context)) as { count: number; tools: unknown[] };
    expect(result.count).toBe(1);
    expect(result.tools).toEqual([
      { name: 'records', tier: 'action', description: 'Canonical Records', execution: 'server' },
    ]);
  });
});
