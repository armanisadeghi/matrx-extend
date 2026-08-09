import { CopyButton } from '@/components/CopyMenu';
import { OpenUrl } from '@/components/OpenUrl';
import { Button } from '@/components/ui/button';
import type { SeoAudit } from '@/lib/seo/audit';
import {
  SECTION_LABELS,
  type SeoEvaluation,
  type SeoFinding,
  type SeoSection,
  missingSocialTagsSnippet,
} from '@/lib/seo/evaluators/from-audit';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/state/chat';
import { useSidepanelTabStore } from '@/state/sidepanel-tab';
import { Bot, CheckCircle } from 'lucide-react';
import { AuditIssueList } from './AuditIssueList';

/**
 * The verdict block — what the raw-facts sections below it never said: is any
 * of this GOOD or BAD, and what do I do about it.
 *
 * Every finding here is produced by the byte-parity evaluators in
 * `src/lib/seo/evaluators/` (mirrors of `matrx_scraper/audit_metrics.py`), so
 * the extension, the web app, and the crawler give the same page the same
 * verdict. This file owns presentation and the fixes ONLY — never a threshold,
 * never a message.
 *
 * Fixes offered, per the No Dead Ends doctrine:
 *   - "Fix" on every finding → stages a precise, page-scoped instruction in
 *     the chat composer and jumps to Chat, where the agent has this page's
 *     tools. The single mechanical repair path the extension actually owns.
 *   - "Copy tags" on the social section → the exact `<meta>` lines the page is
 *     missing, pre-filled from the page's own title / description / canonical.
 *   - "Open" on a canonical mismatch → a door to the URL Google will index
 *     instead, so the user can see it rather than read about it.
 * Everything else states plainly what to change; the evaluator messages are
 * written as instructions ("add og:title", "remove or fill them") for exactly
 * that reason.
 */
export function SeoVerdict({
  audit,
  evaluation,
}: {
  audit: SeoAudit;
  evaluation: SeoEvaluation;
}) {
  const setDraft = useChatStore((s) => s.setDraft);
  const draft = useChatStore((s) => s.draft);
  const setSidepanelTab = useSidepanelTabStore((s) => s.setTab);

  const sendToAgent = (body: string) => {
    const payload = [
      body,
      '',
      `Page: ${audit.title.value || '(untitled)'} — ${audit.url}`,
      '',
      'Read the page if you need to, then tell me exactly what to change: the precise markup and where it goes. If the page has an editor or CMS open that lets you make the change, make it and confirm what you did.',
    ].join('\n');
    setDraft(draft ? `${draft}\n\n${payload}` : payload);
    setSidepanelTab('chat');
  };

  const fixOne = (finding: SeoFinding) =>
    sendToAgent(
      `Fix this SEO problem on the page I'm on.\n\n${SECTION_LABELS[finding.section]} — ${finding.message}`,
    );

  const fixAll = () =>
    sendToAgent(
      [
        "Fix these SEO problems on the page I'm on, most important first.",
        '',
        ...evaluation.findings.map(
          (f) => `- [${f.severity}] ${SECTION_LABELS[f.section]} — ${f.message}`,
        ),
      ].join('\n'),
    );

  const socialSnippet = missingSocialTagsSnippet(audit, evaluation.social);

  const sections: { key: SeoSection; issues: SeoFinding[]; clean: string }[] = [
    {
      key: 'indexability',
      issues: evaluation.findings.filter((f) => f.section === 'indexability'),
      clean: 'Google can index this page.',
    },
    {
      key: 'social',
      issues: evaluation.findings.filter((f) => f.section === 'social'),
      clean: 'Shares on social will render a full card.',
    },
    {
      key: 'headings',
      issues: evaluation.findings.filter((f) => f.section === 'headings'),
      clean: 'The heading outline is well formed.',
    },
    {
      key: 'url',
      issues: evaluation.findings.filter((f) => f.section === 'url'),
      clean: 'The URL is clean and shareable.',
    },
  ];

  return (
    <div className="space-y-3 rounded-xl bg-secondary/40 p-3">
      <div className="flex items-center gap-2">
        <VerdictPill evaluation={evaluation} />
        {evaluation.findings.length > 1 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={fixAll}
            title="Stage every finding in the chat composer for the agent"
            className="ml-auto h-6 gap-1 rounded-md px-2 text-[10px] uppercase tracking-wider"
          >
            <Bot className="size-3" /> Fix all
          </Button>
        )}
      </div>

      {evaluation.findings.length === 0 ? (
        <div className="flex items-start gap-2 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            No problems found. Indexing, the social share card, the heading outline, and the URL all
            check out.
          </span>
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map((section) => (
            <div key={section.key} className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {SECTION_LABELS[section.key]}
                {section.key === 'social' && socialSnippet && (
                  <CopyButton
                    text={socialSnippet}
                    title="Copy the meta tags this page is missing"
                    size="xs"
                    className="ml-auto"
                  />
                )}
              </div>
              <AuditIssueList
                issues={section.issues}
                successText={section.clean}
                actionFor={(finding) => (
                  <div className="flex shrink-0 items-center gap-1">
                    {isCanonicalMismatch(finding, evaluation) && (
                      <OpenUrl
                        url={evaluation.indexability.canonicalUrl}
                        label="Open"
                        showIcon={false}
                        className="text-[11px]"
                      />
                    )}
                    <IconAction title="Ask the agent to fix this" onClick={() => fixOne(finding)}>
                      <Bot className="size-3" />
                    </IconAction>
                  </div>
                )}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The canonical-mismatch finding is the one issue with a URL behind it. Its
 * message is frozen by the cross-language parity fixture, so matching its
 * prefix is stable — and it is guarded by the fact that produced it, so a
 * message change can only lose the door, never point it somewhere wrong.
 */
function isCanonicalMismatch(finding: SeoFinding, evaluation: SeoEvaluation): boolean {
  return (
    finding.section === 'indexability' &&
    evaluation.indexability.canonicalMatches === false &&
    finding.message.startsWith('Canonical points elsewhere')
  );
}

function IconAction({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {children}
    </button>
  );
}

function VerdictPill({ evaluation }: { evaluation: SeoEvaluation }) {
  const { errorCount, warningCount } = evaluation;
  const blocked = evaluation.indexability.verdict === 'blocked';
  const label = blocked
    ? 'Blocked from Google'
    : errorCount > 0
      ? `${errorCount} problem${errorCount === 1 ? '' : 's'} to fix`
      : warningCount > 0
        ? `${warningCount} thing${warningCount === 1 ? '' : 's'} to improve`
        : 'Looks good';
  const tone =
    errorCount > 0
      ? 'bg-red-500/15 text-red-600 dark:text-red-400'
      : warningCount > 0
        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
        : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider',
        tone,
      )}
    >
      {label}
    </span>
  );
}
