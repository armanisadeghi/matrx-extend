/**
 * THE typed config registry — every stored config this build can read. The release manifest
 * (`scripts/generate-config-manifest.ts`) is generated from THIS file plus the call sites, so what the
 * build declares cannot drift from the code. System of record:
 * common-docs/systems/platform/app-config/attestation/FEATURE.md.
 */
import { defineKnobFeature, knob } from '@ai-matrx/data/knobs';

export const APP_SLUG = 'matrx-extend';

/** Every `public.app_config` key (top-level) this extension reads. Add the key here AND call `appConfig('<key>')`. */
export const APP_CONFIG_KEYS = [
  'aidream_server_url',
  'staging_server_url',
  'dev_server_url',
  'frontend_url',
  'desktop_native_host',
  'platform_knobs_cache_ms',
  'flags',
  'notice',
  'min_supported_app_version',
] as const;
export type AppConfigKey = (typeof APP_CONFIG_KEYS)[number];

const any = (raw: unknown) => raw;

/** Every feature knob this extension reads (by explicit call site or via the platform snapshot). */
export const KNOB_FEATURES = [
  defineKnobFeature('vault.browser_login', { list_item_cap: knob('list_item_cap', any) }),
  defineKnobFeature('vault.generator', {
    max_password_length: knob('max_password_length', any),
    max_passphrase_words: knob('max_passphrase_words', any),
  }),
  defineKnobFeature('platform.app_instances', {
    non_computer_platforms: knob('non_computer_platforms', any),
  }),
  defineKnobFeature('platform.config_attestation', {
    flush_interval_minutes: knob('flush_interval_minutes', any),
  }),
  // Shared features the @ai-matrx/chat package reads through the extension's knobs port
  // (src/features/package-chat/knobs.ts). Census: grep of the package's literal {feature, key} refs.
  // NOT declared: `history.nest_child_sessions` — its feature has no dot, which the register vocabulary
  // (defineKnobFeature) refuses; it stays a counted `missing` until the package renames it.
  defineKnobFeature('surfaces.conversations', { all_page_size: knob('all_page_size', any) }),
  defineKnobFeature('agents.tool_cards', {
    inline_visibility: knob('inline_visibility', any),
    diff_start_open: knob('diff_start_open', any),
    diff_default_view: knob('diff_default_view', any),
  }),
  defineKnobFeature('agents.reply_actions', { enabled: knob('enabled', any) }),
  defineKnobFeature('agents.chat_composer', {
    remember_last_mode: knob('remember_last_mode', any),
    quick_actions: knob('quick_actions', any),
    floating_panel_size: knob('floating_panel_size', any),
    default_mode: knob('default_mode', any),
    compact_input_max_height_pct: knob('compact_input_max_height_pct', any),
  }),
] as const;

/** Features read by the chat package (no extension call site of their own): the reader is the knobs port. */
export const PACKAGE_CHAT_FEATURES: ReadonlySet<string> = new Set([
  'surfaces.conversations',
  'agents.tool_cards',
  'agents.reply_actions',
  'agents.chat_composer',
]);

export const REGISTERED_KNOBS: ReadonlySet<string> = new Set(
  KNOB_FEATURES.flatMap((f) => Object.values(f.defs).map((d) => `${f.feature}.${d.key}`)),
);
