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
  defineKnobFeature('platform.config_attestation', {
    flush_interval_minutes: knob('flush_interval_minutes', any),
  }),
] as const;

export const REGISTERED_KNOBS: ReadonlySet<string> = new Set(
  KNOB_FEATURES.flatMap((f) => Object.values(f.defs).map((d) => `${f.feature}.${d.key}`)),
);
