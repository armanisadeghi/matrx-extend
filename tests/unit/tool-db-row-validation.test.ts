// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isDbSurfaceDefaultsRow, isDbToolRow } from '../../scripts/_tool-db-row-validation';

const tool = {
  id: 'b1f7624d-8ec0-465d-b5dd-1f0ba47c8859',
  name: 'capture_page',
  description: 'Capture the current page.',
  parameters: {},
  tier: 'read',
  admin_only: false,
  is_active: true,
  category: 'capture',
  source_kind: 'native',
};

describe('private catalog response validation', () => {
  it('accepts complete no-argument and typed-argument definitions', () => {
    expect(isDbToolRow(tool)).toBe(true);
    expect(isDbToolRow({
      ...tool,
      parameters: { url: { type: 'string', required: true } },
    })).toBe(true);
  });

  it('rejects missing or malformed fields that would otherwise compare clean', () => {
    expect(isDbToolRow({ ...tool, parameters: null })).toBe(false);
    expect(isDbToolRow({ ...tool, parameters: { url: { required: 'yes' } } })).toBe(false);
    expect(isDbToolRow({ ...tool, tier: { value: 'read' } })).toBe(false);
    expect(isDbToolRow({ ...tool, is_active: 'true' })).toBe(false);
  });

  it('requires each surface inclusion and exclusion list to be a string array or null', () => {
    const surface = {
      surface_name: 'chrome-extension/assistant',
      always_include_tools: ['capture_page'],
      always_include_bundles: null,
      never_include_tools: [],
    };
    expect(isDbSurfaceDefaultsRow(surface)).toBe(true);
    expect(isDbSurfaceDefaultsRow({ ...surface, always_include_tools: { 0: 'capture_page' } })).toBe(false);
    expect(isDbSurfaceDefaultsRow({ ...surface, never_include_tools: [3] })).toBe(false);
  });
});
