/**
 * Drift guard for the tool-display registry.
 *
 * Background: the display layer looks up renderers by EXACT tool name
 * (`toolDisplayRegistry[entry.toolName]` in ToolTimelineRow.tsx). When a tool
 * is renamed but its registry key isn't, the call silently falls through to
 * the default collapsed row — which never renders images, tables, etc. This
 * is exactly what happened in the 2026-05-19 namespace redesign: the agent
 * started calling `computer` (action=screenshot) / `chrome_bookmarks` / … but
 * the image renderer was still keyed on the now-unused `take_screenshot`, and
 * the personal-data configs were keyed on the old bare names. Screenshots
 * stopped rendering for the user.
 *
 * These tests encode the two failure classes so the drift can't return
 * silently:
 *   1. Every registry key must be a real, current tool name (in
 *      CANONICAL_SURFACE) OR an explicitly-acknowledged legacy/internal key.
 *      A future rename that forgets to re-key (or alias) fails here.
 *   2. Every canonical screenshot/image-producing tool must actually render
 *      its image inline (Base64Image / Image component, or a CustomComponent).
 */

import { toolDisplayRegistry } from '@/features/chat/tool-display/registry';
import type { ToolDisplayEntry } from '@/features/chat/tool-display/types';
import { CANONICAL_SURFACE } from '@/lib/tools/categories';
import { describe, expect, it } from 'vitest';

/**
 * Registry keys that are intentionally NOT in CANONICAL_SURFACE. Two kinds:
 *   - legacy bare names kept so historical timeline entries (recorded before
 *     the 2026-05-19 rename) still render. Each has a canonical alias added at
 *     the bottom of registry.tsx.
 *   - internal / always-on / server-side rows the agent surface doesn't
 *     advertise via CANONICAL_SURFACE but that still appear in the timeline.
 *
 * Adding a name here is a deliberate acknowledgement — do it only when the key
 * really should render despite not being a canonical tool.
 */
const ALLOWED_NON_CANONICAL = new Set<string>([
  // legacy bare names (pre-rename) — aliased to canonical chrome_* keys
  'bookmarks',
  'history',
  'recently_closed',
  'cookies',
  'webmcp',
  'record_gif',
  'take_screenshot',
  'memory',
  // internal / discovery / server-side rows
  'load_browser_tools',
  'list_browser_tools',
  'ctx_get',
  'interaction_ask',
  'tasks',
  // google_workspace runs on the SERVER (executor `aidream`), so there is no
  // handler here and it is not in CANONICAL_SURFACE — but it is advertised on
  // the extension surfaces via the `google` bundle, so its calls do appear in
  // this timeline and need a row config. (Its sibling `google_email_send` IS
  // canonical: that one is client-only by design.)
  'google_workspace',
  // granular handlers folded into mega-tools but still appearing in older
  // timelines / direct Tools-tab runs
  'click_element',
  'get_active_tab',
]);

/** Canonical tools whose result payload IS an image and must render inline. */
const IMAGE_PRODUCING_CANONICAL = ['computer', 'screenshot_region', 'cdp_full_page_screenshot'];

function rendersImage(entry: ToolDisplayEntry | undefined): boolean {
  if (!entry) return false;
  if (entry.CustomComponent) return true;
  const keys = entry.results?.keysInfo ?? [];
  return keys.some((k) => k.component === 'Base64Image' || k.component === 'Image');
}

describe('tool-display registry drift guard', () => {
  it('every registry key is a current tool name or an acknowledged legacy/internal key', () => {
    const unknown = Object.keys(toolDisplayRegistry).filter(
      (name) => !CANONICAL_SURFACE.has(name) && !ALLOWED_NON_CANONICAL.has(name),
    );
    expect(
      unknown,
      `Registry has display configs for names that are not in CANONICAL_SURFACE and ` +
        `not whitelisted. Either the tool was renamed (re-key or alias the config) or ` +
        `the key is intentional (add it to ALLOWED_NON_CANONICAL). Offenders: ${unknown.join(', ')}`,
    ).toEqual([]);
  });

  it('image-producing canonical tools render their image inline', () => {
    for (const name of IMAGE_PRODUCING_CANONICAL) {
      expect(CANONICAL_SURFACE.has(name), `${name} is expected to be a canonical tool`).toBe(true);
      expect(
        rendersImage(toolDisplayRegistry[name]),
        `${name} must render its screenshot inline (Base64Image/Image or a ` +
          `CustomComponent) — otherwise the user only sees a file_id/dimensions blob`,
      ).toBe(true);
    }
  });

  it('every canonical tool has a display config (1:1 coverage — no bare default rows)', () => {
    const missing = [...CANONICAL_SURFACE].filter((name) => !toolDisplayRegistry[name]);
    expect(
      missing,
      `These canonical tools have NO display config and fall back to the bare ` +
        `default row. Add an entry in registry.tsx (header-only is fine). Missing: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('the canonical chrome_* renames have display configs (aliased from legacy keys)', () => {
    for (const name of ['chrome_bookmarks', 'chrome_history', 'chrome_cookies', 'chrome_webmcp']) {
      expect(toolDisplayRegistry[name], `${name} should have a display config`).toBeDefined();
    }
  });
});
