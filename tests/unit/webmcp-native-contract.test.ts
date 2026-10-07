import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tools/descriptions', () => ({
  ensureToolDescriptions: vi.fn(async () => new Map([['fixture_read', 'Fixture read']])),
}));
vi.mock('@/lib/tools/registry', () => ({
  listAllHandlers: () => [
    {
      name: 'fixture_read',
      tier: 'read',
      admin_only: false,
      argsSchema: { _def: { typeName: 'ZodObject' } },
    },
  ],
}));
vi.mock('zod-to-json-schema', () => ({ zodToJsonSchema: () => ({ type: 'object' }) }));

const context = { assignedTabId: 42 } as never;
const savedDocument = globalThis.document;
const savedChrome = (globalThis as { chrome?: unknown }).chrome;

function installPage(modelContext: object) {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { modelContext },
  });
  (globalThis as { chrome?: unknown }).chrome = {
    tabs: {
      get: async (id: number) => ({ id }),
      query: async () => [{ id: 42 }],
    },
    scripting: {
      executeScript: async ({
        func,
        args = [],
      }: { func: (...args: never[]) => unknown; args?: unknown[] }) => [
        { result: await func(...(args as never[])) },
      ],
    },
  };
}

afterEach(() => {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: savedDocument });
  (globalThis as { chrome?: unknown }).chrome = savedChrome;
});

describe('WebMCP documented imperative API boundary', () => {
  it('awaits document.modelContext.getTools for availability and listing', async () => {
    const tools = [
      { name: 'fixture_read', description: 'Fixture read', inputSchema: { type: 'object' } },
    ];
    const getTools = vi.fn(async () => tools);
    installPage({ getTools });
    const { webmcp_check_availability, webmcp_list_page_tools } = await import(
      '@/lib/tools/handlers/webmcp'
    );
    expect(await webmcp_check_availability.run({}, context)).toEqual({
      available: true,
      tool_count: 1,
    });
    expect(await webmcp_list_page_tools.run({}, context)).toEqual({
      ok: true,
      count: 1,
      tools: [
        { name: 'fixture_read', description: 'Fixture read', input_schema: { type: 'object' } },
      ],
    });
    expect(getTools).toHaveBeenCalledTimes(2);
  });

  it('passes a discovered RegisteredTool and object input to executeTool', async () => {
    const tool = { name: 'fixture_read', origin: 'https://fixture.test' };
    const executeTool = vi.fn(async () => ({ marker: 'executed' }));
    installPage({ getTools: async () => [tool], executeTool });
    const { webmcp_call_page_tool } = await import('@/lib/tools/handlers/webmcp');
    expect(
      await webmcp_call_page_tool.run(
        { name: 'fixture_read', arguments: { marker: 'input' } },
        context,
      ),
    ).toEqual({
      ok: true,
      result: { marker: 'executed' },
    });
    expect(executeTool).toHaveBeenCalledWith(tool, { marker: 'input' });
    expect(await webmcp_call_page_tool.run({ name: 'missing', arguments: {} }, context)).toEqual({
      ok: false,
      reason: 'tool "missing" not found on page',
    });
    expect(
      await webmcp_call_page_tool.run({ name: 'fixture_read', arguments: 'bad' }, context),
    ).toEqual({
      ok: false,
      reason: 'WebMCP arguments must be an object',
    });
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it('reports native unavailability and discovery or execution rejection without a false success', async () => {
    const { webmcp_check_availability, webmcp_list_page_tools, webmcp_call_page_tool } =
      await import('@/lib/tools/handlers/webmcp');
    installPage({});
    expect(await webmcp_check_availability.run({}, context)).toEqual({
      available: false,
      tool_count: 0,
    });
    expect(await webmcp_list_page_tools.run({}, context)).toEqual({
      ok: false,
      reason: 'WebMCP unavailable',
    });
    expect(
      await webmcp_call_page_tool.run({ name: 'fixture_read', arguments: {} }, context),
    ).toEqual({
      ok: false,
      reason: 'WebMCP unavailable',
    });

    installPage({
      getTools: async () => {
        throw new Error('discovery refused');
      },
      executeTool: async () => null,
    });
    expect(await webmcp_check_availability.run({}, context)).toEqual({
      ok: false,
      reason: 'discovery refused',
    });
    expect(await webmcp_list_page_tools.run({}, context)).toEqual({
      ok: false,
      reason: 'discovery refused',
    });
    expect(
      await webmcp_call_page_tool.run({ name: 'fixture_read', arguments: {} }, context),
    ).toEqual({
      ok: false,
      reason: 'discovery refused',
    });

    installPage({
      getTools: async () => [{ name: 'fixture_read' }],
      executeTool: async () => {
        throw new Error('execution refused');
      },
    });
    expect(
      await webmcp_call_page_tool.run({ name: 'fixture_read', arguments: {} }, context),
    ).toEqual({
      ok: false,
      reason: 'execution refused',
    });
  });

  it('awaits native registerTool with execute callback and AbortSignal lifecycle', async () => {
    const registrations: Array<{ name: string; execute?: (args: unknown) => Promise<unknown> }> =
      [];
    const registerTool = vi.fn(
      async (tool: (typeof registrations)[number], options: { signal: AbortSignal }) => {
        expect(options.signal).toBeInstanceOf(AbortSignal);
        registrations.push(tool);
      },
    );
    installPage({ registerTool });
    const { registerToolsOnActiveTab } = await import('@/lib/webmcp/register');
    expect(await registerToolsOnActiveTab({ tabId: 42 })).toEqual({ ok: true, count: 1 });
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registrations[0]?.name).toBe('matrx.fixture_read');
    expect(registrations[0]?.execute).toEqual(expect.any(Function));
    const previousSignal = registerTool.mock.calls[0]?.[1].signal;
    expect(await registerToolsOnActiveTab({ tabId: 42 })).toEqual({ ok: true, count: 1 });
    expect(previousSignal?.aborted).toBe(true);
    expect(registerTool.mock.calls[1]?.[1].signal.aborted).toBe(false);
  });

  it('reports rejected registration instead of counting an unawaited promise', async () => {
    installPage({
      registerTool: vi.fn(async () => {
        throw new Error('registration refused');
      }),
    });
    const { registerToolsOnActiveTab } = await import('@/lib/webmcp/register');
    expect(await registerToolsOnActiveTab({ tabId: 42 })).toEqual({
      ok: false,
      count: 0,
      reason: 'WebMCP registration failed',
    });
  });
});
