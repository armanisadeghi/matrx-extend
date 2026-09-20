import { describe, expect, it, vi } from 'vitest';

import { mayReportExternalTelemetry } from '@/lib/telemetry/external-reporting';

describe('Firefox external telemetry consent', () => {
  it.each([
    ['grant', true, true],
    ['revoked grant', false, false],
    ['explicit denial', false, false],
  ])('uses the current Firefox %s result', async (_case, permissionGranted, expected) => {
    const permissions = { contains: vi.fn().mockResolvedValue(permissionGranted) };

    await expect(mayReportExternalTelemetry('firefox', permissions)).resolves.toBe(expected);
    expect(permissions.contains).toHaveBeenCalledWith({
      data_collection: ['technicalAndInteraction'],
    });
  });

  it('fails closed when Firefox does not expose the permission API', async () => {
    await expect(mayReportExternalTelemetry('firefox', undefined)).resolves.toBe(false);
  });

  it('fails closed when Firefox cannot read the current grant', async () => {
    const permissions = {
      contains: vi.fn().mockRejectedValue(new Error('permission lookup failed')),
    };

    await expect(mayReportExternalTelemetry('firefox', permissions)).resolves.toBe(false);
  });

  it('keeps existing Chromium external reporting enabled', async () => {
    const permissions = { contains: vi.fn().mockResolvedValue(false) };

    await expect(mayReportExternalTelemetry('chrome', permissions)).resolves.toBe(true);
    expect(permissions.contains).not.toHaveBeenCalled();
  });
});
