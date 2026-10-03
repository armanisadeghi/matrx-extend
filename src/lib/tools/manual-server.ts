/** The existing one-tool test door executes a registered server tool in the person's seat. */
import { apiGet, buildHeaders, getApiBaseUrl, readSessionBearer } from '@/lib/api/client';
import { requireRequestOrganizationId } from '@/lib/api/routes/auth';
import { streamFetch } from '@/lib/api/stream';
import { getAccessToken } from '@/lib/auth/flow';
import { getActiveOrganizationId } from '@/lib/org/active-org';

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
  const url = `${await getApiBaseUrl()}/tools/test/execute`;
  // The tool-test door requires a signed-in person. Its stream has the same
  // held organization choice and actor-stability rule as a chat stream.
  let headers: Record<string, string> | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await readSessionBearer();
    if (!token) throw new Error('Sign in to run this tool.');
    const organizationId = await requireRequestOrganizationId();
    const candidate = await buildHeaders(
      { Accept: 'text/event-stream' },
      { token, organizationId },
    );
    const [currentToken, currentOrganizationId] = await Promise.all([
      getAccessToken(),
      getActiveOrganizationId(),
    ]);
    if (currentToken === token && currentOrganizationId === organizationId) {
      headers = candidate;
      break;
    }
  }
  if (!headers) {
    throw new Error('Your sign-in or organization changed. Try again.');
  }
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
