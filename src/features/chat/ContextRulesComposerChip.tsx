/**
 * The composer's context chip: every value the next turn carries, its size,
 * and the person's two knobs (include, inline limit) — the shared
 * `ContextRulesChip` from `@ai-matrx/agents/context/react`, fed by this
 * extension's stores.
 *
 * Contract: /Users/armanisadeghi/code/common-docs/systems/account/scopes-context/context-delivery/RULES.md
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
  type ContextComposer,
  loadContextRules,
  resetContextRules,
  saveContextRule,
  useContextRulesStore,
} from '@/state/context-rules';
import { useDesktopStore } from '@/state/desktop';
import { usePilotChatStore } from '@/state/pilot-chat';
import { useScrapeStore } from '@/state/scrape';
import {
  DEFAULT_INLINE_CAP,
  DEFAULT_SURFACE_KEY,
  applyReceiptToRows,
  compareReceipt,
  blocksForRow,
  resolveContextRow,
  systemRowsToResolved,
} from '@ai-matrx/agents/context';
import { ContextRulesChip, ContextRulesPanelBody } from '@ai-matrx/agents/context/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@ai-matrx/design-system';
import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Read every value the next turn would carry — the send path's own builder,
 * with the same inputs that composer's send passes (Pilot attaches no
 * highlights or Google files).
 */
async function readPreviewSources(
  composer: ContextComposer,
  conversationId: string | null,
): Promise<void> {
  try {
    const user = useAuthStore.getState().user;
    const values = await buildChatContextValues({
      user: user ? { id: user.id, email: user.email, full_name: user.full_name ?? null } : null,
      desktopTransport: useDesktopStore.getState().transport,
      scrape: useScrapeStore.getState().current,
      autoScrape: useAutoScrapeStore.getState().current,
      activeTab: await resolveActiveTab(),
      conversationId,
      ...(composer === 'chat' && {
        highlights: await resolveAttachedHighlights(),
        googleFileIds: resolveAttachedGoogleFileIds(),
      }),
    });
    useContextRulesStore.setState((s) => ({
      previewSourcesByComposer: {
        ...s.previewSourcesByComposer,
        [composer]: contextRowSources(values).sources,
      },
    }));
  } catch (err) {
    log.warn('stream', 'context preview read failed', err);
  }
}

const NO_ROWS: never[] = [];

/** The chip for one composer: `chat` (Assistant) or `pilot`. */
export function ContextRulesComposerChip({ composer }: { composer: ContextComposer }) {
  const chatConversationId = useChatStore((s) => s.selectedConversationId);
  const pilotConversationId = usePilotChatStore((s) => s.selectedConversationId);
  const conversationId = composer === 'pilot' ? pilotConversationId : chatConversationId;
  const saved = useContextRulesStore((s) => s.rows);
  const previewSources = useContextRulesStore((s) => s.previewSourcesByComposer[composer]);
  const lastSentRows = useContextRulesStore((s) => s.lastSentRowsByComposer[composer] ?? NO_ROWS);
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

  // DISPLAY only: values the server resolves itself (attached files, *_id
  // references) show the size and delivery the latest receipt reported. The
  // receipt check still compares against the unfilled rows each send recorded.
  // Plus every value the SERVER added this turn (attachments, scope seeds…),
  // so it is visible and can be turned off like any other row.
  const shownRows = useMemo(() => {
    const receipt = receiptEntry?.receipt;
    const filled = applyReceiptToRows(rows, receipt);
    if (!receipt) return filled;
    const { systemRows } = compareReceipt(lastSentRows, receipt);
    return [
      ...filled,
      ...systemRowsToResolved(systemRows).map((row) => {
        const attached = blocksForRow(row.key, receipt.blocks);
        return attached.length ? { ...row, deliveredBlocks: attached } : row;
      }),
    ];
  }, [rows, lastSentRows, receiptEntry]);
  const mismatches = receiptEntry?.mismatches ?? [];

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) return;
      void loadContextRules();
      void readPreviewSources(composer, conversationId);
    },
    [composer, conversationId],
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
        rows={shownRows}
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
            <DialogTitle>Values</DialogTitle>
          </DialogHeader>
          <ContextRulesPanelBody
            rows={shownRows}
            cap={cap}
            mismatches={mismatches}
            {...(receiptEntry?.receipt.blocks !== undefined && {
              blocks: receiptEntry.receipt.blocks,
            })}
            onChange={onChange}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
