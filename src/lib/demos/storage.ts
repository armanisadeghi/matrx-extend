/**
 * chrome.storage.local persistence for saved demos.
 *
 * Layout:
 *   matrx.demos.list  → DemoSummary[]    (lightweight index)
 *   matrx.demos.{id}  → Demo             (full step list)
 *
 * Splitting like this means `list_demos` is cheap (one read of a small
 * JSON blob) while big demos with hundreds of steps don't bloat every
 * read.
 *
 * 📝 Notes:
 *    .research/demo-system-design-notes.md
 */
import type { Demo, DemoSummary } from '@/lib/demos/types';

const LIST_KEY = 'matrx.demos.list';
const DEMO_KEY_PREFIX = 'matrx.demos.';

function demoKey(id: string): string {
  return `${DEMO_KEY_PREFIX}${id}`;
}

export async function listDemos(): Promise<DemoSummary[]> {
  const r = await chrome.storage.local.get([LIST_KEY]);
  const list = r[LIST_KEY];
  if (!Array.isArray(list)) return [];
  return list as DemoSummary[];
}

export async function getDemo(id: string): Promise<Demo | null> {
  const k = demoKey(id);
  const r = await chrome.storage.local.get([k]);
  const demo = r[k];
  return demo ? (demo as Demo) : null;
}

export async function saveDemo(demo: Demo): Promise<void> {
  const summary: DemoSummary = {
    id: demo.id,
    name: demo.name,
    description: demo.description,
    start_url: demo.start_url,
    step_count: demo.steps.length,
    parameter_names: demo.parameters.map((p) => p.name),
    created_at: demo.created_at,
    updated_at: demo.updated_at,
  };
  const list = await listDemos();
  const existingIdx = list.findIndex((d) => d.id === demo.id);
  if (existingIdx >= 0) list[existingIdx] = summary;
  else list.push(summary);
  await chrome.storage.local.set({
    [LIST_KEY]: list,
    [demoKey(demo.id)]: demo,
  });
}

export async function deleteDemo(id: string): Promise<boolean> {
  const list = await listDemos();
  const next = list.filter((d) => d.id !== id);
  if (next.length === list.length) return false;
  await chrome.storage.local.set({ [LIST_KEY]: next });
  await chrome.storage.local.remove([demoKey(id)]);
  return true;
}

/** Convenience: generate a unique-enough id without depending on crypto.randomUUID polyfill quirks. */
export function makeDemoId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `demo_${crypto.randomUUID()}`;
  }
  return `demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
