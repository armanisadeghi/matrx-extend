/**
 * Service-worker side of config attestation (OBSERVED): registers this install's own `app_instances`
 * row, builds the read recorder, and flushes sealed buckets to `platform.config_reads_report` on an
 * alarm whose period is the platform knob `flush_interval_minutes`. Every failure is a counted warning.
 */
import { createConfigReadRecorder, type ConfigReadRecorder } from '@ai-matrx/data/config-attestation';
import { ensureRequestOrganizationId } from '@/hooks/use-request-organization';
import { log } from '@/lib/debug/log';
import { getSupabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/state/auth';
import pkg from '../../../package.json';
import { APP_SLUG } from './registry';
import {
  attachRecorder,
  buildSha,
  countConfigEvent,
  listenForForwardedReads,
  recordKnobRead,
} from './index';
import { resolveKnob } from './knob-resolve';

const SPOOL_KEY = 'matrx.config.readSpool';
const INSTANCE_KEY = 'matrx.config.instanceId';
const ALARM = 'matrx-config-flush';
const PLATFORM = 'chrome-extension';

let device: { deviceId: string; organizationId: string } | null = null;
let recorder: (ConfigReadRecorder & { flush(): Promise<void> }) | null = null;
let spoolRef: object | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function sidecarLog(level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown>): void {
  if (level === 'info') log.info('config', event, data);
  else countConfigEvent(event, data, level);
}

/** Find or create this install's own row; its id is the report's device_id. */
async function ensureDevice(): Promise<typeof device> {
  const auth = useAuthStore.getState();
  const userId = auth.status === 'signed-in' ? auth.user?.id : null;
  if (!userId) {
    countConfigEvent('config.reads_not_reported_signed_out');
    return null;
  }
  const organizationId = await ensureRequestOrganizationId();
  if (!organizationId) {
    countConfigEvent('config.reads_not_reported_no_organization');
    return null;
  }
  if (device && device.organizationId === organizationId) return device;
  const stored = await chrome.storage.local.get(INSTANCE_KEY);
  let instanceId = stored[INSTANCE_KEY] as string | undefined;
  if (!instanceId) {
    instanceId = crypto.randomUUID();
    await chrome.storage.local.set({ [INSTANCE_KEY]: instanceId });
  }
  const db = getSupabase();
  const found = await db
    .from('app_instances')
    .select('id')
    .eq('user_id', userId)
    .eq('instance_id', instanceId)
    .eq('platform', PLATFORM)
    .maybeSingle();
  if (found.error) {
    countConfigEvent('config.device_lookup_failed', { error: found.error.message });
    return null;
  }
  let id = (found.data as { id: string } | null)?.id;
  if (!id) {
    const inserted = await db
      .from('app_instances')
      .insert({
        user_id: userId,
        created_by: userId,
        instance_id: instanceId,
        instance_name: 'Chrome extension',
        platform: PLATFORM,
        organization_id: organizationId,
        is_active: true,
      } as never)
      .select('id')
      .single();
    if (inserted.error) {
      countConfigEvent('config.device_register_failed', { error: inserted.error.message });
      return null;
    }
    id = (inserted.data as { id: string }).id;
  }
  device = { deviceId: id, organizationId };
  return device;
}

async function persistSpool(): Promise<void> {
  if (spoolRef) await chrome.storage.local.set({ [SPOOL_KEY]: JSON.parse(JSON.stringify(spoolRef)) });
}
function persistSoon(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistSpool();
  }, 5000);
}

async function scheduleNext(): Promise<void> {
  const org = device?.organizationId ?? (await ensureRequestOrganizationId());
  const userId = useAuthStore.getState().user?.id;
  let minutes: number | null = null;
  if (org && userId) {
    const r = await resolveKnob({ feature: 'platform.config_attestation', key: 'flush_interval_minutes', organizationId: org, userId });
    if (!r.error && typeof r.data === 'number' && r.data > 0) minutes = r.data;
    else countConfigEvent('config.flush_interval_unavailable', { error: r.error?.message ?? 'not a positive number' }, 'error');
  }
  // internal-bound: an unreadable interval knob (counted above) is retried every minute, never silent.
  await chrome.alarms.create(ALARM, { delayInMinutes: minutes ?? 1 });
}

export async function flushConfigReads(): Promise<void> {
  if (!recorder) return;
  await ensureDevice().catch((e) => countConfigEvent('config.device_failed', { error: String(e).slice(0, 200) }));
  await recorder.flush();
  await persistSpool();
}

/** Service worker boot: build the recorder from the persisted spool and arm the flush alarm. */
export async function startConfigReporting(): Promise<void> {
  listenForForwardedReads();
  const sha = buildSha();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    countConfigEvent('config.reporting_disabled_no_build_sha', { sha }, 'error');
    return;
  }
  const stored = await chrome.storage.local.get(SPOOL_KEY);
  const loaded = stored[SPOOL_KEY] as { version?: number; build_sha?: string } | undefined;
  spoolRef =
    loaded && loaded.version === 1 && loaded.build_sha === sha
      ? loaded
      : { version: 1, build_sha: sha, open: { bucket_start: new Date().toISOString(), reads: {}, missing: {} }, pending: [] };
  const rec = createConfigReadRecorder({
    app: APP_SLUG,
    appVersion: pkg.version,
    buildSha: sha,
    device: () => device,
    client: getSupabase() as never,
    flushMinutes: () => 1,
    automation: import.meta.env.WXT_E2E === '1',
    log: sidecarLog,
    spool: { load: () => spoolRef, save: () => undefined },
  });
  recorder = rec;
  const counting: ConfigReadRecorder = {
    read: (r) => { rec.read(r); persistSoon(); },
    applied: (r) => rec.applied(r),
    missing: (r) => { rec.missing(r); persistSoon(); },
  };
  attachRecorder(counting);
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM) return;
    void flushConfigReads().finally(() => void scheduleNext());
  });
  chrome.runtime.onSuspend.addListener(() => void persistSpool());
  void scheduleNext();
}

export { recordKnobRead };
