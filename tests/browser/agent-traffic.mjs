// THE AGENT-TRAFFIC MARKER for extension browser tests: "this request is ours, not a visitor's".
// Twin of matrx-frontend lib/agent-traffic/marker.ts and aidream matrx_ai/agent_traffic.py —
// same constant name, same values (guard: `pnpm check:agent-traffic-marker` in matrx-frontend).
// It LABELS only; nothing is refused for carrying it or lacking it. Test-side only: never import
// this from src/ (real users run that code).
export const MATRX_AGENT_TRAFFIC = {
  header: 'X-Matrx-Agent-Traffic',
  cookie: 'matrx_agent_traffic',
  fixtureSuite: 'agent-traffic',
};

/** `{ "X-Matrx-Agent-Traffic": <tool> }` — merge into any request's headers. */
export function agentTrafficHeaders(tool) {
  return { [MATRX_AGENT_TRAFFIC.header]: String(tool) };
}

/** Label every page of a browser context as ours: the first-party cookie, set for `origin`. */
export async function markBrowserAgentTraffic(context, tool, origin) {
  await context.addCookies([
    { name: MATRX_AGENT_TRAFFIC.cookie, value: String(tool), url: origin },
  ]);
}
