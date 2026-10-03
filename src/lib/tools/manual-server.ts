/** The existing one-tool test door executes a registered server tool in the person's seat. */
import { apiGet, buildHeaders, getApiBaseUrl } from '@/lib/api/client';
import { streamFetch } from '@/lib/api/stream';

export interface ServerToolDefinition {
  parameters: Record<string, unknown>;
}

export async function getManualServerToolDefinition(name: string): Promise<ServerToolDefinition> {
  const response = await apiGet<{ tools: (ServerToolDefinition & { name: string })[] }>(
    '/tools/test/list',
  );
  if (!response.ok) throw new Error(response.error);
  const tool = response.data.tools.find((candidate) => candidate.name === name);
  if (!tool?.parameters) throw new Error(`${name} is unavailable on the server.`);
  return tool;
}

export async function runManualServerTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const headers = await buildHeaders();
  const url = `${await getApiBaseUrl()}/tools/test/execute`;
  let completion: Record<string, unknown> | undefined;
  let failure: string | undefined;
  await streamFetch({
    url,
    headers,
    body: { tool_name: name, arguments: args },
    onEvent: (event) => {
      if (event.type === 'error') failure = event.message;
      if (event.type === 'event' && event.eventName === 'completion') {
        if (event.data.operation === 'tool_execution') completion = event.data;
      }
    },
  });
  if (failure) throw new Error(failure);
  const result = completion?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`Server did not return a tool result for ${name}.`);
  }
  const full = (result as Record<string, unknown>).full_result;
  if (!full || typeof full !== 'object' || Array.isArray(full)) {
    throw new Error(`Server returned an invalid tool result for ${name}.`);
  }
  return full;
}
