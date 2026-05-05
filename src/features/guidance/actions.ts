/**
 * UI-facing trigger functions for the Guidance tab. Each one orchestrates
 * a capture flow:
 *
 *   captureScreenshotAsGuidance(...)  — take_screenshot → upload → save item
 *   startGifRecordingAsGuidance(...)  — record_gif start + banner
 *   stopGifRecordingAsGuidance(...)   — record_gif stop+export → upload → save
 *   startDemoRecording(...)           — recorder.startRecording + banner
 *   stopDemoRecordingAndSave(...)     — recorder.stopRecording → saveDemo + attach guidance ref
 *
 * All of these run inside the sidepanel (renderer). They import from the
 * extension-internal modules directly — same JS context as the SW for
 * read/write operations against `chrome.storage.local`. For the
 * screenshot path we go through the existing `take_screenshot` handler
 * to preserve the profile system and centralized canvas pipeline.
 */

import { uploadFile } from '@/lib/api/routes/files';
import {
  attachDemoAsGuidance,
  deleteGuidanceItem,
  makeGuidanceId,
  saveGuidanceItem,
} from '@/lib/guidance/storage';
import type {
  GuidanceGif,
  GuidanceNote,
  GuidanceScreenshot,
} from '@/lib/guidance/types';
import {
  hideRecordingBanner,
  showRecordingBanner,
} from '@/lib/guidance/in-page-banner';
import {
  discardRecording,
  getActiveRecording,
  startRecording,
  stopRecording,
} from '@/lib/demos/recorder';
import { saveDemo, makeDemoId } from '@/lib/demos/storage';
import type { Demo, DemoParameter, DemoStep } from '@/lib/demos/types';
import { record_gif } from '@/lib/tools/handlers/record';
import { take_screenshot } from '@/lib/tools/handlers/read';
import { log } from '@/lib/debug/log';

interface ToolCtxStub {
  callId: string;
  conversationId: null;
  runId: string;
  agentName: null;
  permissionMode: 'act';
}

const UI_CTX: ToolCtxStub = {
  callId: '',
  conversationId: null,
  runId: 'guidance-ui',
  agentName: null,
  permissionMode: 'act',
};

function domainFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

// ────────────────────────────────────────────────────────────────────────
// Notes
// ────────────────────────────────────────────────────────────────────────

export async function saveNoteAsGuidance(args: {
  domain: string;
  text: string;
  caption?: string;
  origin_url?: string;
}): Promise<GuidanceNote> {
  const now = Date.now();
  const item: GuidanceNote = {
    id: makeGuidanceId(),
    kind: 'note',
    domain: args.domain,
    text: args.text,
    caption: args.caption,
    origin_url: args.origin_url,
    created_at: now,
    updated_at: now,
  };
  await saveGuidanceItem(item);
  return item;
}

// ────────────────────────────────────────────────────────────────────────
// Screenshot
// ────────────────────────────────────────────────────────────────────────

export async function captureScreenshotAsGuidance(opts?: {
  caption?: string;
  domain?: string;
}): Promise<GuidanceScreenshot> {
  const tab = await activeTab();
  if (!tab?.id) throw new Error('No active tab to capture');
  const domain = opts?.domain ?? domainFromUrl(tab.url ?? null);
  if (!domain) throw new Error('Could not derive domain from active tab');

  // Use the canonical 'auto' profile — the take_screenshot handler runs
  // captureVisibleTab + offscreen-canvas resize + JPEG encoding.
  const r = (await take_screenshot.run(
    { profile: 'auto' } as never,
    UI_CTX as never,
  )) as unknown as Record<string, unknown>;
  if (r.ok !== true || typeof r.image_base64 !== 'string') {
    throw new Error(`Screenshot capture failed: ${(r as { reason?: string }).reason ?? 'unknown'}`);
  }

  const mime = (r.media_type as string) ?? 'image/jpeg';
  const ext = mime.includes('png') ? 'png' : 'jpg';
  const filename = `guidance-${Date.now()}.${ext}`;
  const bytes = Uint8Array.from(atob(r.image_base64 as string), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mime });
  const upload = await uploadFile(blob, filename, {
    path: `browser-agent/guidance/screenshots/${filename}`,
    metadata: { domain, kind: 'guidance_screenshot', origin_url: tab.url },
  });

  const now = Date.now();
  const item: GuidanceScreenshot = {
    id: makeGuidanceId(),
    kind: 'screenshot',
    domain,
    file_id: upload.file_id,
    url: upload.url ?? upload.cdn_url ?? null,
    width: r.width as number | undefined,
    height: r.height as number | undefined,
    caption: opts?.caption,
    origin_url: tab.url ?? undefined,
    created_at: now,
    updated_at: now,
  };
  await saveGuidanceItem(item);
  return item;
}

// ────────────────────────────────────────────────────────────────────────
// GIF — wraps record_gif tool
// ────────────────────────────────────────────────────────────────────────

export interface GifRecordingHandle {
  tabId: number;
  startedAt: number;
}

export async function startGifRecordingAsGuidance(): Promise<GifRecordingHandle> {
  const tab = await activeTab();
  if (!tab?.id) throw new Error('No active tab to record');
  const tabIdStr = String(tab.id);

  const startResult = (await record_gif.run(
    { action: 'start_recording', tabId: tabIdStr } as never,
    UI_CTX as never,
  )) as { ok: boolean; reason?: string };
  if (!startResult.ok) {
    throw new Error(startResult.reason ?? 'GIF recording failed to start');
  }

  await showRecordingBanner(tab.id, 'gif');
  log.info('sw', `guidance gif recording started tab=${tab.id}`);
  return { tabId: tab.id, startedAt: Date.now() };
}

export async function stopGifRecordingAsGuidance(args: {
  tabId: number;
  caption?: string;
}): Promise<GuidanceGif> {
  const tabIdStr = String(args.tabId);
  // 1. Stop frames.
  const stop = (await record_gif.run(
    { action: 'stop_recording', tabId: tabIdStr } as never,
    UI_CTX as never,
  )) as { ok: boolean; reason?: string; frame_count?: number; duration_ms?: number };
  if (!stop.ok) {
    await hideRecordingBanner(args.tabId);
    throw new Error(stop.reason ?? 'GIF stop failed');
  }
  // 2. Export → uploads to cld_files. download:true would also dump to disk.
  const exp = (await record_gif.run(
    { action: 'export', tabId: tabIdStr, download: false } as never,
    UI_CTX as never,
  )) as {
    ok: boolean;
    reason?: string;
    file_id?: string;
    file_url?: string | null;
    duration_ms?: number;
  };
  await hideRecordingBanner(args.tabId);
  if (!exp.ok || !exp.file_id) {
    throw new Error(exp.reason ?? 'GIF export failed');
  }

  const tab = await chrome.tabs.get(args.tabId).catch(() => null);
  const domain = domainFromUrl(tab?.url ?? null);
  if (!domain) throw new Error('Could not derive domain from recording tab');

  const now = Date.now();
  const item: GuidanceGif = {
    id: makeGuidanceId(),
    kind: 'gif',
    domain,
    file_id: exp.file_id,
    url: exp.file_url ?? null,
    duration_ms: exp.duration_ms ?? stop.duration_ms,
    frame_count: stop.frame_count,
    caption: args.caption,
    origin_url: tab?.url ?? undefined,
    created_at: now,
    updated_at: now,
  };
  await saveGuidanceItem(item);
  return item;
}

export async function discardGifRecording(tabId: number): Promise<void> {
  await record_gif.run(
    { action: 'clear', tabId: String(tabId) } as never,
    UI_CTX as never,
  );
  await hideRecordingBanner(tabId);
}

// ────────────────────────────────────────────────────────────────────────
// Demo — wraps src/lib/demos/recorder + storage
// ────────────────────────────────────────────────────────────────────────

export interface DemoRecordingHandle {
  recordingId: string;
  tabId: number;
  startedAt: number;
}

export async function startDemoRecordingAsGuidance(): Promise<DemoRecordingHandle> {
  const tab = await activeTab();
  if (!tab?.id) throw new Error('No active tab to record');

  const r = await startRecording(tab.id);
  if (!r.ok || !r.recording_id) throw new Error(r.reason ?? 'Failed to start demo recording');

  await showRecordingBanner(tab.id, 'demo', 0);
  log.info('sw', `guidance demo recording started tab=${tab.id} id=${r.recording_id}`);
  return { recordingId: r.recording_id, tabId: tab.id, startedAt: Date.now() };
}

export interface DemoSaveInput {
  name: string;
  description?: string;
  parameters?: DemoParameter[];
}

export async function stopDemoRecordingAndSave(input: DemoSaveInput): Promise<{
  demo: Demo;
  guidance_id: string | null;
}> {
  const stopped = await stopRecording();
  if (!stopped.ok || !stopped.state) {
    throw new Error(stopped.reason ?? 'No recording to stop');
  }
  const state = stopped.state;
  await hideRecordingBanner(state.tabId);

  // Same param-derivation logic as the record_demo handler so users see
  // identical behavior whether they save via the agent or via the UI.
  const declared: DemoParameter[] = input.parameters ?? [];
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

  const now = Date.now();
  const demo: Demo = {
    id: makeDemoId(),
    name: input.name,
    description: input.description ?? '',
    start_url: state.startUrl,
    step_count: state.steps.length,
    parameter_names: parameters.map((p) => p.name),
    created_at: state.startedAt,
    updated_at: now,
    steps: state.steps as DemoStep[],
    parameters,
  };
  await saveDemo(demo);

  // Attach a domain-scoped guidance ref so the demo appears in the
  // Guidance tab + auto-surfaces as context on the next visit.
  const domain = domainFromUrl(state.startUrl);
  let guidanceId: string | null = null;
  if (domain) {
    const ref = await attachDemoAsGuidance({
      demo_id: demo.id,
      domain,
      origin_url: state.startUrl,
      name: demo.name,
      step_count: demo.step_count,
      parameter_names: demo.parameter_names,
    });
    guidanceId = ref.id;
  }
  return { demo, guidance_id: guidanceId };
}

export async function discardDemoRecording(): Promise<void> {
  const state = getActiveRecording();
  if (!state) return;
  await discardRecording();
  await hideRecordingBanner(state.tabId);
}

// ────────────────────────────────────────────────────────────────────────
// Generic delete — used by the row's delete button. For demo_ref items we
// also drop the underlying demo (otherwise the user would have to delete
// it twice).
// ────────────────────────────────────────────────────────────────────────

export async function deleteGuidance(id: string): Promise<void> {
  await deleteGuidanceItem(id);
}
