import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
const adminState = vi.hoisted(() => ({ isAdmin: false }));
vi.mock('@/lib/auth/is-admin', () => ({
  readIsAdminFromStorage: async () => adminState.isAdmin,
}));
vi.mock('@/lib/tools/registry', () => ({
  listAllHandlers: () => [
    { name: 'webmcp_check_availability', tier: 'read', admin_only: true, argsSchema: z.object({}) },
    { name: 'webmcp_list_page_tools', tier: 'read', admin_only: true, argsSchema: z.object({}) },
    { name: 'webmcp_call_page_tool', tier: 'action', admin_only: true, argsSchema: z.object({}) },
    { name: 'chrome_webmcp', tier: 'action', admin_only: true, argsSchema: z.object({}) },
  ],
}));
vi.mock('@/lib/tools/descriptions', () => ({
  ensureToolDescriptions: async () =>
    new Map([
      ['records', 'Canonical Records'],
      ['webmcp_check_availability', 'Check WebMCP'],
      ['webmcp_list_page_tools', 'List page tools'],
      ['webmcp_call_page_tool', 'Call page tool'],
      ['chrome_webmcp', 'WebMCP router'],
    ]),
}));
vi.mock('zod-to-json-schema', () => ({ zodToJsonSchema: () => ({ type: 'object' }) }));
import { discover_handlers, list_chrome_categories } from '@/lib/tools/handlers/discover';
import type { ToolContext } from '@/lib/tools/types';
const context = {} as ToolContext;

beforeEach(() => {
  adminState.isAdmin = false;
});

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

  it('lists concrete admin WebMCP entries only when canonical admin state allows them', async () => {
    const listWebmcp = discover_handlers.find(
      (candidate) => candidate.name === 'list_webmcp_tools',
    );
    if (!listWebmcp) throw new Error('WebMCP category discovery tool is missing');

    const guestCategories = (await list_chrome_categories.run({}, context)) as {
      categories: { name: string; tool_names: string[] }[];
    };
    expect(guestCategories.categories.some((category) => category.name === 'webmcp')).toBe(false);
    const guestList = (await listWebmcp.run({}, context)) as { count: number; tools: unknown[] };
    expect(guestList).toEqual({
      category: 'webmcp',
      count: 0,
      tools: [],
      hint: 'Category exists but has no tools available to you (admin restriction or empty).',
    });

    adminState.isAdmin = true;
    const adminCategories = (await list_chrome_categories.run({}, context)) as {
      categories: { name: string; tool_names: string[] }[];
    };
    expect(
      adminCategories.categories.find((category) => category.name === 'webmcp')?.tool_names,
    ).toEqual([
      'webmcp_check_availability',
      'webmcp_list_page_tools',
      'webmcp_call_page_tool',
      'chrome_webmcp',
    ]);
    const adminList = (await listWebmcp.run({}, context)) as {
      count: number;
      tools: { name: string }[];
    };
    expect(adminList.count).toBe(4);
    expect(adminList.tools.map((tool) => tool.name)).toEqual([
      'webmcp_check_availability',
      'webmcp_list_page_tools',
      'webmcp_call_page_tool',
      'chrome_webmcp',
    ]);
  });
});
