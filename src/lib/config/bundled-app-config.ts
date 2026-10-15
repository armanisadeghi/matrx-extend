import type { AppConfigRow } from '@ai-matrx/data/app-config';

/**
 * The build's snapshot of the `matrx-extend` app_config row: the FIRST-RUN seed used before any live read
 * or last-seen copy exists. Every read served from it is logged at warn and counted as source `snapshot`
 * (admin shows amber), so using the seed is never silent. Keep in step with the live row.
 */
export const BUNDLED_APP_CONFIG: AppConfigRow = {
  app: 'matrx-extend',
  schema_version: 1,
  min_supported_app_version: '0.2.516',
  updated_at: '2026-10-15T00:00:00.000Z',
  config: {
    aidream_server_url: 'https://server.app.matrxserver.com',
    staging_server_url: 'https://staging.server.app.matrxserver.com',
    dev_server_url: 'https://dev.server.app.matrxserver.com',
    frontend_url: 'https://aimatrx.com',
    desktop_native_host: 'com.matrx.local',
    platform_knobs_cache_ms: 60000,
    flags: {},
    notice: null,
  },
} as unknown as AppConfigRow;
