/**
 * The SEO tab's "AI recommendations" section.
 *
 * Until 2026-08-09 this section rendered the literal string "Wire this up to
 * /ai/agent/execute with an SEO prompt" — a developer TODO shipped to a
 * non-technical user as a promised feature that did nothing. It is now a real
 * agent run: the WHOLE `SeoAudit` goes up as one `page_seo_audit` context key
 * (see lib/seo/recommendations.ts for why nothing is trimmed), the answer
 * streams back into this panel, and every failure mode is visible with a way
 * out.
 *
 * Reused rather than rebuilt: `useAgentTextRun` (the ephemeral-run primitive),
 * `Markdown` (the chat renderer), `CopyButton`, the settings store's
 * `defaultAgentId` (this repo's current, hardcoded-fallback answer to "which
 * agent" — see below), and the agent list query. Newly built: the primitive
 * itself + the request builder.
 *
 * 🚨 KNOWN GAP — `defaultAgentId` is a client Zustand setting over a bundled
 * UUID, not the platform's canonical agent selection. Canonically this panel
 * would name a `slot_key` and let the DB resolve it (system default → org
 * binding → user binding → run-scope). matrx-extend has zero Mandate coverage;
 * conversion is tracked as rows E1/E2 in
 * common-docs/systems/mandates/ROLLOUT.md (system of record: that dir's
 * FEATURE.md).
 *
 * Door Law: the agent that wrote the recommendations is named AND opens — the
 * footer links to its canonical `/agents/{id}` route in a new tab, so reading
 * "which agent said this?" never costs the user their audit.
 *
 * Freshness: the parent keys this component by url + fetched_at, so a
 * navigation or a Re-audit remounts it. Recommendations for the previous
 * snapshot can never sit next to this snapshot's numbers.
 */

import { CopyButton } from '@/components/CopyMenu';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { ENV } from '@/config/env';
import { useAgentTextRun } from '@/hooks/use-agent-text-run';
import { DEFAULT_AGENDA_AGENT_ID } from '@/lib/agenda/constants';
import type { SeoAudit } from '@/lib/seo/audit';
import { buildSeoRecommendationsRequest } from '@/lib/seo/recommendations';
import { fetchAgentList } from '@/lib/supabase/queries';
import { useSettingsStore } from '@/state/settings';
import { ExternalLink, Loader2, RotateCw, Sparkles, Square } from 'lucide-react';
import { useEffect, useState } from 'react';

export function AiRecommendations({ audit }: { audit: SeoAudit }) {
  // NEVER hardcode an agent UUID at a call site. Today that means reading the
  // settings store, with DEFAULT_AGENDA_AGENT_ID as the bundled fallback if
  // it's cleared. 🚨 Both are a client-side stopgap for a Mandate that
  // this repo does not resolve yet (ROLLOUT.md rows E1/E2).
  const defaultAgentId = useSettingsStore((s) => s.defaultAgentId);
  const agentId = defaultAgentId ?? DEFAULT_AGENDA_AGENT_ID;
  const [agentName, setAgentName] = useState<string | null>(null);
  const { text, running, error, run, cancel } = useAgentTextRun();

  // Resolve the agent's display name lazily — only once the user has actually
  // asked for recommendations, so opening the SEO tab costs no extra query.
  useEffect(() => {
    if (!running || agentName) return;
    let cancelled = false;
    void (async () => {
      const list = await fetchAgentList();
      if (cancelled) return;
      setAgentName(list.find((a) => a.id === agentId)?.name ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [running, agentName, agentId]);

  const start = () => {
    void run({
      agentId,
      body: buildSeoRecommendationsRequest(audit),
      runIdPrefix: 'seorec',
    });
  };

  const hasText = text.trim().length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" />
        AI recommendations
        {hasText && (
          <div className="ml-auto normal-case tracking-normal">
            <CopyButton text={text} title="Copy recommendations" size="xs" />
          </div>
        )}
      </div>

      {!hasText && !running && !error && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Send this audit to an agent and get specific, paste-ready fixes for this page.
          </p>
          <Button size="sm" className="h-7 rounded-full px-3 text-xs" onClick={start}>
            <Sparkles className="size-3" />
            Get recommendations
          </Button>
        </div>
      )}

      {hasText && (
        <div className="rounded-xl bg-secondary/25 px-2.5 py-2">
          <Markdown content={text} density="compact" className="text-xs" />
        </div>
      )}

      {running && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          <span>{hasText ? 'Writing…' : 'Reading your audit…'}</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 rounded-full px-2 text-[11px]"
            onClick={() => void cancel()}
          >
            <Square className="size-3" />
            Stop
          </Button>
        </div>
      )}

      {error && (
        <div className="space-y-1.5">
          <div className="text-[11px] text-red-600 dark:text-red-400">{error}</div>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 rounded-full px-3 text-xs"
            onClick={start}
          >
            <RotateCw className="size-3" />
            Try again
          </Button>
        </div>
      )}

      {hasText && !running && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1 truncate rounded px-1 py-0.5 hover:bg-secondary/60 hover:text-foreground"
            title="Open this agent on aimatrx.com"
            onClick={() =>
              void chrome.tabs.create({
                url: `${ENV.FRONTEND_URL}/agents/${encodeURIComponent(agentId)}`,
              })
            }
          >
            <span className="truncate">by {agentName ?? 'your default agent'}</span>
            <ExternalLink className="size-2.5 shrink-0" />
          </button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 shrink-0 rounded-full px-2 text-[11px]"
            onClick={start}
          >
            <RotateCw className="size-3" />
            Regenerate
          </Button>
        </div>
      )}
    </div>
  );
}
