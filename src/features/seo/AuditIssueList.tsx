import type { AuditIssue } from '@/lib/seo/evaluators/types';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle, OctagonAlert } from 'lucide-react';

/**
 * AuditIssueList — the canonical renderer for deterministic audit issues
 * (errors + warnings from the social / headings / indexability / url-quality
 * evaluators). Presentation mirrors matrx-frontend's
 * `features/marketing/seo/audit/AuditIssueList.tsx`; the colors are spelled
 * out because this repo's theme has no `success` / `warning` tokens, only
 * `destructive`.
 *
 * `actionFor` lets a consumer hang the one-click fix off each row — the No
 * Dead Ends rule that a detected problem ships with its repair.
 */
export function AuditIssueList<T extends AuditIssue>({
  issues,
  successText,
  actionFor,
  className,
}: {
  issues: T[];
  /** Rendered when there are no issues. Omit to render nothing when clean. */
  successText?: string;
  /** Per-issue fix affordance, rendered at the end of the row. */
  actionFor?: (issue: T) => React.ReactNode;
  className?: string;
}) {
  if (!issues.length) {
    if (!successText) return null;
    return (
      <div
        className={cn(
          'flex items-start gap-2 text-xs text-emerald-600 dark:text-emerald-400',
          className,
        )}
      >
        <CheckCircle className="mt-0.5 size-3.5 shrink-0" />
        <span>{successText}</span>
      </div>
    );
  }
  return (
    <div className={cn('space-y-2', className)}>
      {issues.map((issue) => (
        <div
          key={issue.message}
          className={cn(
            'flex items-start gap-2 text-xs',
            issue.severity === 'error'
              ? 'text-red-600 dark:text-red-400'
              : 'text-amber-600 dark:text-amber-400',
          )}
        >
          {issue.severity === 'error' ? (
            <OctagonAlert className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1 break-words">{issue.message}</span>
          {actionFor?.(issue)}
        </div>
      ))}
    </div>
  );
}
