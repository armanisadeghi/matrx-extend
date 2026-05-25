import { isValidCron, nextCronTime, parseCron } from '@/lib/agenda/cron';
import { describe, expect, it } from 'vitest';

describe('cron parser', () => {
  it('validates field counts', () => {
    expect(isValidCron('0 9 * * *')).toBe(true);
    expect(isValidCron('0 9 * *')).toBe(false); // 4 fields
    expect(isValidCron('0 9 * * * *')).toBe(false); // 6 fields
    expect(isValidCron('')).toBe(false);
  });

  it('rejects out-of-range and malformed values', () => {
    expect(isValidCron('60 9 * * *')).toBe(false); // minute > 59
    expect(isValidCron('0 24 * * *')).toBe(false); // hour > 23
    expect(isValidCron('0 9 32 * *')).toBe(false); // dom > 31
    expect(isValidCron('0 9 * 13 *')).toBe(false); // month > 12
    expect(isValidCron('0 9 * * abc')).toBe(false);
  });

  it('parses ranges, lists, and steps', () => {
    const f = parseCron('0,30 9-17 * * 1-5');
    expect([...f.minute].sort((a, b) => a - b)).toEqual([0, 30]);
    expect([...f.hour].sort((a, b) => a - b)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...f.dow].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(parseCron('*/15 * * * *').minute.size).toBe(4); // 0,15,30,45
  });

  it('treats day-of-week 7 as Sunday', () => {
    expect(parseCron('0 0 * * 7').dow.has(0)).toBe(true);
  });

  it('computes the next daily fire time (local tz)', () => {
    // From 2026-03-01 08:00 local, "0 9 * * *" should fire same day 09:00.
    const after = new Date(2026, 2, 1, 8, 0, 0);
    const next = nextCronTime('0 9 * * *', after);
    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(9);
    expect(next!.getMinutes()).toBe(0);
    expect(next!.getDate()).toBe(1);
  });

  it('rolls to the next day when the time has passed', () => {
    const after = new Date(2026, 2, 1, 10, 0, 0); // 10:00, past 09:00
    const next = nextCronTime('0 9 * * *', after);
    expect(next!.getDate()).toBe(2);
    expect(next!.getHours()).toBe(9);
  });

  it('honors weekday restriction (Mon-Fri)', () => {
    // 2026-03-07 is a Saturday; next "0 9 * * 1-5" fire is Mon 2026-03-09.
    const sat = new Date(2026, 2, 7, 12, 0, 0);
    const next = nextCronTime('0 9 * * 1-5', sat);
    expect(next!.getDay()).toBe(1); // Monday
    expect(next!.getDate()).toBe(9);
  });

  it('returns null for an invalid expression', () => {
    expect(nextCronTime('not a cron', new Date())).toBeNull();
  });
});
