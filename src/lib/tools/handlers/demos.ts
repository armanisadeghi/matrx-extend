import {
  discardRecording,
  getActiveRecording,
  startRecording,
  stopRecording,
} from '@/lib/demos/recorder';
import { replayDemo } from '@/lib/demos/replayer';
import { getDemoOrHydrate } from '@/lib/demos/cloud-sync';
import {
  listDemos,
  makeDemoId,
  saveDemo,
  deleteDemo as storageDeleteDemo,
} from '@/lib/demos/storage';
import type { Demo, DemoParameter, DemoStep } from '@/lib/demos/types';
import { getAssignedTabId } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler, ToolTier } from '@/lib/tools/types';
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
 * Body lookups go through `getDemoOrHydrate`, never `getDemo`: demo bodies sync
 * through `extend.wbx_demo`, and a body can be absent locally on a machine that
 * has the guidance `demo_ref` but hasn't hydrated yet. That path repairs from
 * the cloud first and only then reports `demo_body_unavailable` — a distinct
 * code from `demo_not_found`, so the agent can tell "this demo lives on another
 * machine and you're signed out" from "no such demo".
 *
 * 📝 Notes:
 *    .research/proposed-tools-and-features.md (item #1)
 *    .research/demo-system-design-notes.md
 */
import { z } from 'zod';

/**
 * Structured "couldn't load the body" envelope. Two distinct codes because they
 * mean different things to the agent: `demo_not_found` is a bad id;
 * `demo_body_unavailable` means the demo genuinely exists (a guidance
 * `demo_ref` or the local index points at it) but its body isn't here and
 * couldn't be pulled — sign in, or open the machine that recorded it.
 */
async function demoMissingResult(demoId: string): Promise<{
  ok: false;
  error: 'demo_not_found' | 'demo_body_unavailable';
  demo_id: string;
  reason: string;
}> {
  const [{ listAllGuidance }, summaries] = await Promise.all([
    import('@/lib/guidance/storage'),
    listDemos(),
  ]);
  const known =
    summaries.some((d) => d.id === demoId) ||
    (await listAllGuidance()).some((g) => g.demo_id === demoId);
  return known
    ? {
        ok: false,
        error: 'demo_body_unavailable',
        demo_id: demoId,
        reason:
          'This demo is referenced here but its recorded steps are not on this machine and could not be fetched. Sign in to sync demos, or re-record it on this machine.',
      }
    : {
        ok: false,
        error: 'demo_not_found',
        demo_id: demoId,
        reason: `No demo with id=${demoId}`,
      };
}

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
  argsSchema: RecordDemoArgs,
  run: async (args, ctx) => {
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
      let tabId: number | null | undefined = args.tab_id;
      if (tabId == null) {
        tabId = await getAssignedTabId(ctx);
        if (tabId == null) return { ok: false, reason: 'No active tab.' };
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
          description:
            step.element_snapshot?.accessible_name ?? `Auto-derived from step ${step.index}`,
          ...(step.is_sensitive !== undefined && { sensitive: step.is_sensitive }),
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
  argsSchema: DescribeDemoArgs,
  run: async (args) => {
    const demo = await getDemoOrHydrate(args.demo_id);
    if (!demo) return demoMissingResult(args.demo_id);
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
  argsSchema: ReplayDemoArgs,
  run: async (args) => {
    const demo = await getDemoOrHydrate(args.demo_id);
    if (!demo) return demoMissingResult(args.demo_id);
    const result = await replayDemo({
      demo,
      ...(args.tab_id !== undefined && { tabId: args.tab_id }),
      ...(args.params !== undefined && { params: args.params }),
      ...(args.dry_run !== undefined && { dry_run: args.dry_run }),
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
  argsSchema: DeleteDemoArgs,
  run: async (args) => {
    const ok = await storageDeleteDemo(args.demo_id);
    return ok
      ? { ok: true, deleted: true }
      : { ok: false, reason: `No demo with id=${args.demo_id}` };
  },
};

export const demo_handlers = [record_demo, list_demos, describe_demo, replay_demo, delete_demo];
