/**
 * Lazy fetch of an agent's execution payload (variable_definitions,
 * context_slots, model_id, settings, tools, custom_tools).
 *
 * Fetched ONLY when the user picks an agent. Cached per agentId in component
 * state — re-fetches if the user switches agents.
 *
 * The list query (agx_get_list_full) deliberately omits these heavy/secret
 * fields, so this is the second step.
 */

import { type AgxAgentExecution, fetchAgentExecution } from '@/lib/supabase/queries';
import { useEffect, useState } from 'react';

export interface AgentVariableDef {
  name: string;
  defaultValue?: string;
  label?: string;
  description?: string;
  required?: boolean;
  type?: string;
}

interface State {
  loading: boolean;
  execution: AgxAgentExecution | null;
  error: string | null;
}

const INITIAL: State = { loading: false, execution: null, error: null };

export function useAgentExecution(agentId: string | null): State & {
  variableDefs: AgentVariableDef[];
} {
  const [state, setState] = useState<State>(INITIAL);

  useEffect(() => {
    if (!agentId) {
      setState(INITIAL);
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    void (async () => {
      try {
        const exec = await fetchAgentExecution(agentId);
        if (cancelled) return;
        setState({ loading: false, execution: exec, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({ loading: false, execution: null, error: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  return { ...state, variableDefs: extractVariableDefs(state.execution) };
}

/**
 * Normalize variable_definitions from JSONB. Real-world shapes seen:
 *   - Array of { name, defaultValue?, label?, ... }    ← matrx-frontend canonical
 *   - Object keyed by name { tone: { defaultValue: "..." }, ... }   ← legacy
 *
 * We accept both, normalize to the array form.
 */
function extractVariableDefs(exec: AgxAgentExecution | null): AgentVariableDef[] {
  if (!exec || exec.variable_definitions == null) return [];
  const v = exec.variable_definitions;
  if (Array.isArray(v)) {
    return v
      .filter(
        (d): d is Record<string, unknown> =>
          d != null && typeof d === 'object' && typeof (d as { name?: unknown }).name === 'string',
      )
      .map((d) => ({
        name: String(d.name),
        defaultValue: typeof d.defaultValue === 'string' ? d.defaultValue : undefined,
        label: typeof d.label === 'string' ? d.label : undefined,
        description: typeof d.description === 'string' ? d.description : undefined,
        required: typeof d.required === 'boolean' ? d.required : undefined,
        type: typeof d.type === 'string' ? d.type : undefined,
      }));
  }
  if (typeof v === 'object' && v !== null) {
    return Object.entries(v as Record<string, unknown>).map(([name, val]) => {
      const d = (val ?? {}) as Record<string, unknown>;
      return {
        name,
        defaultValue: typeof d.defaultValue === 'string' ? d.defaultValue : undefined,
        label: typeof d.label === 'string' ? d.label : undefined,
        description: typeof d.description === 'string' ? d.description : undefined,
        required: typeof d.required === 'boolean' ? d.required : undefined,
        type: typeof d.type === 'string' ? d.type : undefined,
      };
    });
  }
  return [];
}
