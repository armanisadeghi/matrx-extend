/**
 * The Content IR scream seam, bound to this extension's debug log.
 *
 * `@ai-matrx/content-ir-react` makes every recovery path loud and refuses to
 * own where the scream lands. Binding a no-op would be choosing silence, which
 * is its own defect — these land in the Debug tab like every other subsystem.
 */

import { log } from '@/lib/debug/log';
import type { ContentIrErrorReporter } from '@ai-matrx/content-ir-react';

export const reportContentIrError: ContentIrErrorReporter = (report) => {
  // `log.error` already writes to the context console and relays into the
  // Debug tab. A second console.error here made every single registry failure
  // appear twice (the raw Error line plus `[object Object]` from the relay).
  const recovering =
    report.message.includes('retrying in') ||
    report.message.includes('compiled bootstrap still serving');
  const write = recovering ? log.warn : log.error;
  write('ui', `[content-ir] ${report.message}`, {
    relation: report.relation,
    name: report.name,
    stack: report.stack,
    raw: report.raw,
  });
};
