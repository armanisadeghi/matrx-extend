/**
 * Agent-callable tools for the demo system.
 *
 * Tools:
 *   - `record_demo({action, ...})`  — start, stop+save, or discard a recording.
 *   - `list_demos`                  — returns demo summaries.
 *   - `describe_demo({demo_id})`    — returns full step list for one demo.
 *   - `replay_demo({demo_id, ...})` — runs the demo against a tab.
 *   - `delete_demo({demo_id})`      — removes a saved demo.
 *
 * Tier:
 *   - record/list/describe/delete = action (or read for list/describe).
 *   - replay_demo = privileged. It re-executes arbitrary user actions
 *     (clicks, types, submits, navigations) automatically; this can
 *     trigger purchases, sends, deletes. Always confirm.
 *
 * 📝 Notes:
 *    .research/proposed-tools-and-features.md (item #1)
 *    .research/demo-system-design-notes.md
 */
import { z } from 'zod';
import { deleteDemo as storageDeleteDemo, getDemo, listDemos, makeDemoId, saveDemo } from '@/lib/demos/storage';
import { discardRecording, getActiveRecording, startRecording, stopRecording } from '@/lib/demos/recorder';
import { replayDemo } from '@/lib/demos/replayer';
import type { Demo, DemoParameter, DemoStep } from '@/lib/demos/types';
import type { ToolHandler, ToolTier } from '@/lib/tools/types';

// ─── record_demo ───────────────────────────────────────────────────────────
const ParameterDefSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.string().optional(),
  sensitive: z.boolean().optional(),
});

const RecordDemoArgs = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    /** Tab to record on. Defaults to active tab. */
    tab_id: z.number().int().optional(),
  }),
  z.object({
    action: z.literal('stop'),
    /** Required when stopping: human-readable name. */
    name: z.string().min(1).max(100),
    description: z.string().max(500).default(''),
    /** Declared parameter slots. Steps with `param_placeholder` set must reference one of these. */
    parameters: z.array(ParameterDefSchema).default([]),
  }),
  z.object({ action: z.literal('discard') }),
  z.object({ action: z.literal('status') }),
]);
type RecordDemoArgs = z.infer<typeof RecordDemoArgs>;

const RECORD_DEMO_READ_ACTIONS = new Set(['status']);

export const record_demo: ToolHandler<RecordDemoArgs, unknown> = {
  name: 'record_demo',
  tier: 'action',
  tierFor: (args): ToolTier => (RECORD_DEMO_READ_ACTIONS.has(args.action) ? 'read' : 'action'),
  description:
    "Record a user demonstration that can later be replayed by the agent. Actions: 'start' (begin recording on a tab; clicks, typed text, submits, navigations, and scrolls are captured automatically as the user demonstrates), 'stop' (save the recording with a name + parameter declarations; sensitive fields like passwords are auto-parameterised), 'discard' (throw away the in-flight recording without saving), 'status' (read; report whether a recording is active and how many steps have been captured). Coach the user: ask them to walk through the workflow, then call stop when they say they're done. Saved demos are replayed via `replay_demo`.",
  argsSchema: RecordDemoArgs,
  run: async (args) => {
    if (args.action === 'status') {
      const state = getActiveRecording();
      if (!state) return { ok: true, recording: false };
      return {
        ok: true,
        recording: true,
        recording_id: state.recordingId,
        tab_id: state.tabId,
        start_url: state.startUrl,
        steps_captured: state.steps.length,
        elapsed_ms: Date.now() - state.startedAt,
      };
    }

    if (args.action === 'start') {
      let tabId = args.tab_id;
      if (tabId == null) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, reason: 'No active tab.' };
        tabId = tab.id;
      }
      const r = await startRecording(tabId);
      return r.ok
        ? { ok: true, recording_id: r.recording_id, tab_id: tabId }
        : { ok: false, reason: r.reason };
    }

    if (args.action === 'discard') {
      await discardRecording();
      return { ok: true, discarded: true };
    }

    // stop
    const stopped = await stopRecording();
    if (!stopped.ok || !stopped.state) return { ok: false, reason: stopped.reason };
    const state = stopped.state;

    // Build the parameter set: every sensitive step's auto-derived
    // placeholder must be reachable from `args.parameters`. If the caller
    // didn't declare them, derive defaults so save still succeeds.
    const declared: DemoParameter[] = args.parameters as DemoParameter[];
    const declaredNames = new Set(declared.map((p) => p.name));
    const auto: DemoParameter[] = [];
    for (const step of state.steps) {
      if (step.param_placeholder && !declaredNames.has(step.param_placeholder)) {
        auto.push({
          name: step.param_placeholder,
          description: step.element_snapshot?.accessible_name ?? `Auto-derived from step ${step.index}`,
          sensitive: step.is_sensitive,
        });
        declaredNames.add(step.param_placeholder);
      }
    }
    const parameters = [...declared, ...auto];

    const demo: Demo = {
      id: makeDemoId(),
      name: args.name,
      description: args.description ?? '',
      start_url: state.startUrl,
      step_count: state.steps.length,
      parameter_names: parameters.map((p) => p.name),
      created_at: state.startedAt,
      updated_at: Date.now(),
      steps: state.steps as DemoStep[],
      parameters,
    };

    await saveDemo(demo);
    return {
      ok: true,
      demo_id: demo.id,
      step_count: demo.steps.length,
      parameter_names: demo.parameter_names,
      saved: true,
    };
  },
};

// ─── list_demos ────────────────────────────────────────────────────────────
const ListDemosArgs = z.object({}).default({});
type ListDemosArgs = z.infer<typeof ListDemosArgs>;

export const list_demos: ToolHandler<ListDemosArgs, unknown> = {
  name: 'list_demos',
  tier: 'read',
  description:
    'List every saved demo as { id, name, description, start_url, step_count, parameter_names, created_at, updated_at }. Use to find a demo to replay or describe.',
  argsSchema: ListDemosArgs,
  run: async () => {
    const demos = await listDemos();
    return { ok: true, demos };
  },
};

// ─── describe_demo ─────────────────────────────────────────────────────────
const DescribeDemoArgs = z.object({ demo_id: z.string().min(1) });
type DescribeDemoArgs = z.infer<typeof DescribeDemoArgs>;

export const describe_demo: ToolHandler<DescribeDemoArgs, unknown> = {
  name: 'describe_demo',
  tier: 'read',
  description:
    'Return the full step list for a saved demo. Each step has { kind, url, selector_chain, element_snapshot, input_text, param_placeholder, is_sensitive }. Use before replay to verify what the demo will do.',
  argsSchema: DescribeDemoArgs,
  run: async (args) => {
    const demo = await getDemo(args.demo_id);
    if (!demo) return { ok: false, reason: `No demo with id=${args.demo_id}` };
    // Strip any non-sensitive `input_text` to readable previews; keep
    // sensitive ones empty (they should always be parameterised at replay).
    const safeSteps = demo.steps.map((s) => ({
      ...s,
      input_text: s.is_sensitive ? '' : s.input_text,
    }));
    return { ok: true, demo: { ...demo, steps: safeSteps } };
  },
};

// ─── replay_demo ───────────────────────────────────────────────────────────
const ReplayDemoArgs = z.object({
  demo_id: z.string().min(1),
  /** Override target tab (defaults to active). */
  tab_id: z.number().int().optional(),
  /** Substitution map for parameterised steps. */
  params: z.record(z.string(), z.string()).optional(),
  /** When true, resolve selectors but skip side-effecting actions. */
  dry_run: z.boolean().optional(),
});
type ReplayDemoArgs = z.infer<typeof ReplayDemoArgs>;

export const replay_demo: ToolHandler<ReplayDemoArgs, unknown> = {
  name: 'replay_demo',
  tier: 'privileged',
  description:
    "Replay a saved demo against a tab. Always requires confirmation — the demo can click, type, submit, and navigate. Pass `dry_run: true` to test selector resolution without taking action. Pass `params` to substitute placeholders (sensitive fields like passwords MUST be supplied this way; the agent should ask the user via `ask_user_secret` first). Returns per-step results with `resolved_via` showing which selector strategy hit.",
  argsSchema: ReplayDemoArgs,
  run: async (args) => {
    const demo = await getDemo(args.demo_id);
    if (!demo) return { ok: false, reason: `No demo with id=${args.demo_id}` };
    const result = await replayDemo({
      demo,
      tabId: args.tab_id,
      params: args.params,
      dry_run: args.dry_run,
    });
    return result;
  },
};

// ─── delete_demo ───────────────────────────────────────────────────────────
const DeleteDemoArgs = z.object({ demo_id: z.string().min(1) });
type DeleteDemoArgs = z.infer<typeof DeleteDemoArgs>;

export const delete_demo: ToolHandler<DeleteDemoArgs, unknown> = {
  name: 'delete_demo',
  tier: 'action',
  description: 'Delete a saved demo by id. Cannot be undone.',
  argsSchema: DeleteDemoArgs,
  run: async (args) => {
    const ok = await storageDeleteDemo(args.demo_id);
    return ok ? { ok: true, deleted: true } : { ok: false, reason: `No demo with id=${args.demo_id}` };
  },
};

export const demo_handlers = [record_demo, list_demos, describe_demo, replay_demo, delete_demo];
