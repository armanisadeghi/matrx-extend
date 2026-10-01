/**
 * The composer's context chip: every value the next turn carries, its size,
 * and the person's two knobs (include, inline limit) — the shared
 * `ContextRulesChip` from `@ai-matrx/agents/context/react`, fed by this
 * extension's stores.
 *
 * Contract: /Users/armanisadeghi/code/common-docs/systems/scopes-context/context-delivery/RULES.md
 *
 * - Rows are resolved by the SAME function the send path uses
 *   (`contextRowSources` + `resolveContextRow` with the saved rules), so the
 *   chip shows exactly what will be sent. Opening the chip reads the page
 *   once (the same builder a send runs); until then it shows the rows the
 *   last send used.
 * - A change is saved at once to the person's one home for rules
 *   (`users.user_surface_state`), which the server reads every turn.
 * - After a turn, the server's receipt is compared with the rows that turn
 *   was built from; any difference turns the chip amber.
 */

import { resolveAttachedGoogleFileIds, resolveAttachedHighlights } from '@/hooks/use-chat-stream';
import { resolveActiveTab } from '@/lib/chat/active-tab';
import { buildChatContextValues } from '@/lib/chat/context';
import { contextRowSources } from '@/lib/chat/context/request-context';
import { log } from '@/lib/debug/log';
import { useAuthStore } from '@/state/auth';
import { useAutoScrapeStore } from '@/state/auto-scrape';
import { useChatStore } from '@/state/chat';
import {
  loadContextRules,
  resetContextRules,
  saveContextRule,
  useContextRulesStore,
} from '@/state/context-rules';
import { useDesktopStore } from '@/state/desktop';
import { useScrapeStore } from '@/state/scrape';
import {
  DEFAULT_INLINE_CAP,
  DEFAULT_SURFACE_KEY,
  resolveContextRow,
} from '@ai-matrx/agents/context';
import { ContextRulesChip, ContextRulesPanelBody } from '@ai-matrx/agents/context/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@ai-matrx/design-system';
import { useCallback, useEffect, useMemo, useState } from 'react';

/** Read every value the next turn would carry — the send path's own builder. */
async function readPreviewSources(conversationId: string | null): Promise<void> {
  const store = useContextRulesStore;
  store.setState({ previewing: true });
  try {
    const user = useAuthStore.getState().user;
    const values = await buildChatContextValues({
      user: user ? { id: user.id, email: user.email, full_name: user.full_name ?? null } : null,
      desktopTransport: useDesktopStore.getState().transport,
      scrape: useScrapeStore.getState().current,
      autoScrape: useAutoScrapeStore.getState().current,
      activeTab: await resolveActiveTab(),
      conversationId,
      highlights: await resolveAttachedHighlights(),
      googleFileIds: resolveAttachedGoogleFileIds(),
    });
    store.setState({ previewSources: contextRowSources(values).sources });
  } catch (err) {
    log.warn('stream', 'context preview read failed', err);
  } finally {
    store.setState({ previewing: false });
  }
}

export function ContextRulesComposerChip() {
  const conversationId = useChatStore((s) => s.selectedConversationId);
  const saved = useContextRulesStore((s) => s.rows);
  const previewSources = useContextRulesStore((s) => s.previewSources);
  const lastSentRows = useContextRulesStore((s) => s.lastSentRows);
  const receiptEntry = useContextRulesStore((s) =>
    conversationId ? s.receiptByConversation[conversationId] : undefined,
  );
  const [fullView, setFullView] = useState(false);
  const signedIn = useAuthStore((s) => Boolean(s.user));

  // The saved rules are read once per session (and re-read on every open), so
  // the face shows the person's rules before the first send.
  useEffect(() => {
    if (signedIn) void loadContextRules();
  }, [signedIn]);

  const cap = receiptEntry?.receipt.cap ?? DEFAULT_INLINE_CAP;
  const rows = useMemo(() => {
    if (previewSources) return previewSources.map((s) => resolveContextRow(s, saved, cap));
    // Before the page is read: the last send's rows, re-resolved so a rule
    // changed since then shows at once (their sizes were measured at send).
    return lastSentRows.map((r) =>
      resolveContextRow(
        {
          key: r.key,
          label: r.label,
          surfaceKey: r.surfaceKey,
          origin: r.origin,
          value: undefined,
          chars: r.chars,
          ...(r.layers !== undefined && { layers: r.layers }),
        },
        saved,
        cap,
      ),
    );
  }, [previewSources, lastSentRows, saved, cap]);

  const mismatches = receiptEntry?.mismatches ?? [];

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) return;
      void loadContextRules();
      void readPreviewSources(conversationId);
    },
    [conversationId],
  );

  const onChange = useCallback(
    (
      key: string,
      surfaceKey: string,
      next: { include?: boolean; max_inline_chars?: number } | null,
    ) => {
      void saveContextRule(surfaceKey, key, next);
    },
    [],
  );

  return (
    <>
      <ContextRulesChip
        label="Context"
        rows={rows}
        cap={cap}
        modelReadsContext={receiptEntry?.receipt.model_reads_context !== false}
        onChange={onChange}
        onResetAll={() => void resetContextRules(DEFAULT_SURFACE_KEY)}
        onOpenFullView={() => setFullView(true)}
        onOpenRow={() => setFullView(true)}
        mismatchCount={mismatches.length}
        mismatches={mismatches}
        onOpenChange={onOpenChange}
      />
      <Dialog open={fullView} onOpenChange={setFullView}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Context</DialogTitle>
          </DialogHeader>
          <ContextRulesPanelBody
            rows={rows}
            cap={cap}
            mismatches={mismatches}
            onChange={onChange}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
