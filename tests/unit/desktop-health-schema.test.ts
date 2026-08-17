import { describe, expect, it } from 'vitest';

import {
  DesktopHealthSchema,
  desktopHealthSnapshotKey,
  engineHealthState,
  formatDesktopConnectionLabel,
} from '@/lib/desktop/types';

describe('DesktopHealthSchema', () => {
  it('accepts legacy native RPC shape (status + version only)', () => {
    const parsed = DesktopHealthSchema.safeParse({
      status: 'ok',
      version: '1.3.105',
      user_id: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(engineHealthState(parsed.data)).toBe('ok');
    }
  });

  it('accepts matrx-local GET /health with managed-service detail', () => {
    const parsed = DesktopHealthSchema.safeParse({
      status: 'ok',
      health: 'degraded',
      service: 'matrx-local',
      version: '1.3.105',
      degraded: ['ai_engine'],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(engineHealthState(parsed.data)).toBe('degraded');
      expect(parsed.data.degraded).toEqual(['ai_engine']);
    }
  });

  it('accepts failed_services with failed list', () => {
    const parsed = DesktopHealthSchema.safeParse({
      status: 'ok',
      health: 'failed_services',
      service: 'matrx-local',
      version: '1.3.105',
      failed: ['ai_engine', 'tool_registry'],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects non-ok status (not a matrx-local engine)', () => {
    const parsed = DesktopHealthSchema.safeParse({
      status: 'degraded',
      version: '9.9.9',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('desktop health display helpers', () => {
  it('labels degraded HTTP connections distinctly from offline', () => {
    expect(
      formatDesktopConnectionLabel('http', {
        status: 'ok',
        version: '1.0.0',
        health: 'degraded',
        degraded: ['ai_engine'],
      }),
    ).toBe('Connected · degraded (http)');
  });

  it('detects health snapshot changes for probe broadcasts', () => {
    const a = desktopHealthSnapshotKey({
      status: 'ok',
      version: '1.0.0',
      health: 'ok',
    });
    const b = desktopHealthSnapshotKey({
      status: 'ok',
      version: '1.0.0',
      health: 'degraded',
      degraded: ['ai_engine'],
    });
    expect(a).not.toBe(b);
  });
});
