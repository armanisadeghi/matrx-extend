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
 * Evaluation is in the host's LOCAL timezone (what a user means by
 * "0 9 * * *" → 9am their time). The optional `tz` field on a cron trigger is
 * not yet honored — see computeFirstDue's caller; treat tz as a future
 * enhancement, not a silent no-op of the whole trigger.
 *
 * No external dependency (a full library would be overkill and the catalog
 * script must stay tsx-loadable — no top-level chrome.* / import.meta.env).
 */

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
    const step = stepPart ? parseInt(stepPart, 10) : 1;
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
      lo = parseInt(dash[0] ?? '', 10);
      hi = parseInt(dash[1] ?? '', 10);
    } else {
      lo = parseInt(rangePart, 10);
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
 * the expression is invalid or no match is found within a one-year horizon
 * (e.g. an impossible date like Feb 31). Returns a Date with seconds zeroed.
 */
export function nextCronTime(expression: string, after: Date = new Date()): Date | null {
  let fields: CronFields;
  try {
    fields = parseCron(expression);
  } catch {
    return null;
  }
  // Start at the next whole minute after `after`.
  const cursor = new Date(after.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  // Cap the search at ~366 days of minutes so a never-matching expression
  // can't spin forever.
  const maxIterations = 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    if (matches(fields, cursor)) return new Date(cursor.getTime());
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
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
