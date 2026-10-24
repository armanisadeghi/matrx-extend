import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

const STAGES = new Set([
  'inputs',
  'native',
  'signin',
  'organization',
  'capture_seed',
  'select_seed_response',
  'save_recipe',
  'verify_persisted_recipe',
  'arm_old_document',
  'manual_prior_capture',
  'old_context_identity',
  'worker_observer',
  'saved_replay',
  'saved_approval',
  'first_saved_http',
  'first_saved_terminal',
  'second_saved_replay',
  'second_saved_approval',
  'second_saved_http',
  'second_saved_trace',
  'second_saved_terminal_before_release',
  'release_prior_saved_http',
  'second_saved_terminal_after_release',
  'current_probe_http',
  'release_old_http',
  'stale_only_terminal_refusal',
  'enable_fresh_recovery',
  'fresh_saved_replay',
  'fresh_saved_approval',
  'fresh_current_http',
  'fresh_saved_terminal',
  'current_http',
  'release_manual_origin',
  'saved_terminal_result',
  'binding_evidence',
  'admin_credentials_read',
  'admin_web_navigation',
  'admin_web_route',
  'admin_web_form_fill',
  'admin_web_submit',
  'admin_extension_settings_click',
  'admin_extension_account_open',
  'admin_extension_signin_ready',
  'admin_extension_click',
  'admin_extension_auth_completion',
  'admin_rendered_identity',
  'receipt',
  'artifact_verify',
  'browser_runtime',
  'profile_prepare',
  'browser_spawn',
  'cdp_connect',
  'endpoint_read',
  'command_line_query',
  'command_line_verify',
  'extension_worker',
  'spawn_owner',
  'local_server',
  'playwright_connect',
  'page_create',
  'local_page_navigation',
  'panel_open',
  'panel_reply',
  'panel_target',
  'panel_context',
  'panel_settle',
  'demo_navigation',
  'screenshot',
  'exercise_panel',
]);
const SOURCES = new Set(['d47', 'native', 'auth']);

function persistSnapshot(path, events) {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temp = join(directory, `.${basename(path)}.${process.pid}.${events.length}.tmp`);
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeSync(fd, `${JSON.stringify({ schema_version: 1, events })}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, path);
    const directoryFd = openSync(directory, 'r');
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(temp);
    } catch {}
    throw error;
  }
}

export function createNativeStageReceipt(path, { clock = () => performance.now() } = {}) {
  const started = clock();
  const events = [];
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeSync(fd, `${JSON.stringify({ schema_version: 1, events })}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  persistSnapshot(path, events);
  return {
    path,
    record(source, stage) {
      if (!SOURCES.has(source) || !STAGES.has(stage))
        throw new Error('native_stage_receipt_value_refused');
      events.push({ source, stage, elapsed_ms: Math.max(0, Math.round(clock() - started)) });
      persistSnapshot(path, events);
    },
  };
}
