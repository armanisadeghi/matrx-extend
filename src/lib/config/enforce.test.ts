import { describe, expect, it } from 'vitest';
import { versionLess } from './enforce';

describe('min_supported_app_version comparison', () => {
  it('orders versions numerically', () => {
    expect(versionLess('0.2.516', '0.2.600')).toBe(true);
    expect(versionLess('0.2.516', '0.2.516')).toBe(false);
    expect(versionLess('0.10.0', '0.9.9')).toBe(false);
  });
});
