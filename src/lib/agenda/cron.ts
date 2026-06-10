/**
 * Minimal standard cron parser + next-fire calculator.
 *
 * Supports the classic 5-field crontab syntax:
 *
 *     ┌──────── minute        (0-59)
 *     │ ┌────── hour          (0-23)
 *     │ │ ┌──── day-of-month  (1-31)
 *     │ │ │ ┌── month         (1-12)
 *     │ │ │ │ ┌ day-of-week   (0-6, 0 = Sunday; 7 also accepted as Sunday)
 *     * * * * *
 *
 * Per-field syntax: `*`, a number, a list `a,b,c`, a range `a-b`, and steps
 * `*&#47;n` or `a-b&#47;n`. Day-of-month / day-of-week follow the standard cron OR
 * rule: when BOTH are restricted (neither is `*`), a timestamp matches if it
 * satisfies EITHER field; when only one is restricted, only that one applies.
 *
 * Since 2026-06-10 (audit P2-14), NEXT-FIRE COMPUTATION delegates to
 * `cron-parser` (already a dependency, previously only used by the dormant
 * scheduler-client): correct DST handling (a job in the spring-forward gap
 * fires right after the jump instead of silently skipping the day; the
 * fall-back repeated hour fires once) and a real IANA `tz` option — the
 * trigger config's `tz` field was previously a silent no-op. Default stays
 * the device's local timezone (what a user means by "0 9 * * *").
 *
 * The hand-rolled field parser below is retained for VALIDATION + the
 * matches() unit surface (cron-parser accepts some 6-field/extension forms
 * we deliberately don't, so validation stays strict 5-field).
 */
import { CronExpressionParser } from 'cron-parser';

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseField(raw: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    const slash = part.split('/');
    const rangePart = slash[0] ?? '';
    const stepPart = slash[1];
    const step = stepPart ? Number.parseInt(stepPart, 10) : 1;
    if (!Number.isFinite(step) || step < 1) {
      throw new Error(`invalid step in cron field: "${part}"`);
    }
    let lo: number;
    let hi: number;
    if (rangePart === '*' || rangePart === '') {
      lo = min;
      hi = max;
    } else if (rangePart.includes('-')) {
      const dash = rangePart.split('-');
      lo = Number.parseInt(dash[0] ?? '', 10);
      hi = Number.parseInt(dash[1] ?? '', 10);
    } else {
      lo = Number.parseInt(rangePart, 10);
      hi = lo;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      throw new Error(`invalid cron field: "${part}"`);
    }
    for (let v = lo; v <= hi; v += step) {
      // Normalize day-of-week 7 → 0 (both mean Sunday).
      const nv = max === 6 && v === 7 ? 0 : v;
      if (nv < min || nv > max) {
        throw new Error(`cron value ${v} out of range [${min},${max}]`);
      }
      out.add(nv);
    }
  }
  return out;
}

export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron expression must have 5 fields, got ${parts.length}: "${expression}"`);
  }
  const [min, hr, dom, mon, dow] = parts as [string, string, string, string, string];
  return {
    minute: parseField(min, 0, 59),
    hour: parseField(hr, 0, 23),
    dom: parseField(dom, 1, 31),
    month: parseField(mon, 1, 12),
    dow: parseField(dow, 0, 6),
    domRestricted: dom.trim() !== '*',
    dowRestricted: dow.trim() !== '*',
  };
}

function matches(fields: CronFields, d: Date): boolean {
  if (!fields.minute.has(d.getMinutes())) return false;
  if (!fields.hour.has(d.getHours())) return false;
  if (!fields.month.has(d.getMonth() + 1)) return false;

  const domOk = fields.dom.has(d.getDate());
  const dowOk = fields.dow.has(d.getDay());
  // Standard cron OR-rule for day fields.
  if (fields.domRestricted && fields.dowRestricted) return domOk || dowOk;
  if (fields.domRestricted) return domOk;
  if (fields.dowRestricted) return dowOk;
  return true;
}

/**
 * The next time (strictly after `after`) that `expression` fires, or null if
 * the expression is invalid or no match exists (e.g. an impossible date like
 * Feb 31 — cron-parser throws when iteration exhausts). `tz` is an IANA zone
 * name; omitted = the device's local timezone.
 */
export function nextCronTime(
  expression: string,
  after: Date = new Date(),
  tz?: string,
): Date | null {
  // Keep our strict 5-field validation in front — cron-parser accepts
  // second-field and other extensions we deliberately reject in the UI.
  try {
    parseCron(expression);
  } catch {
    return null;
  }
  try {
    const iter = CronExpressionParser.parse(expression, {
      currentDate: after,
      ...(tz ? { tz } : {}),
    });
    return iter.next().toDate();
  } catch {
    return null;
  }
}

/** True if `expression` parses as a valid 5-field cron string. */
export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}
