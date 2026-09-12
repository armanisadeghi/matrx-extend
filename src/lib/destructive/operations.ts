/**
 * THE CENSUS OF DESTRUCTIVE OPERATIONS in this extension — machine-readable,
 * so the class cannot quietly regrow one surface at a time.
 *
 * Why a registry instead of a rule of thumb: the 2026-09-08 destructive-click
 * sweep fixed AgendaView and stopped, and nothing in the repo could tell the
 * next agent that ten other surfaces still deleted on an unguarded click. A
 * list that a test enforces is the difference between a sweep and a class fix.
 *
 * TWO TESTS READ THIS FILE (`tests/unit/destructive-confirm-guard.test.ts`):
 *
 *  1. DISCOVERY — every function anywhere in `src/` whose body performs a
 *     permanent-removal primitive (a Supabase `.delete()`, a
 *     `chrome.storage.*.remove/clear`, a `localStorage` removal, a vault
 *     `DELETE`) must appear below, either as a CONFIRMED operation or in
 *     `INTERNAL_ONLY` with a reason. Write new destructive code and the suite
 *     goes red until you have said what it destroys.
 *
 *  2. CALL-SITE GATING — every `.tsx` call to one of the `uiEntryPoints`
 *     names below must sit inside a confirmed callback (the `run` of
 *     `confirmDestructive`, or the `onConfirm` of a `<ConfirmDialog />`).
 *     A new surface that wires a delete button straight to the operation
 *     fails before it can ship.
 *
 * Law: `common-docs/policies/destructive-and-expensive-actions.md`.
 */

export interface DestructiveOperation {
  /** Exported function (or store method) that performs the removal. */
  fn: string;
  /** Where it lives, relative to the repo root. */
  module: string;
  /**
   * The names a `.tsx` actually calls to reach it. Often `fn` itself, but a
   * hook or store wrapper is what a view imports — and the wrapper is where
   * the guard must look, because that is where the button is wired.
   */
  uiEntryPoints: string[];
  /** What a click on it destroys, in plain English. Feeds review, not the UI. */
  destroys: string;
}

/** Operations a UI click can reach. Every one of these must be confirmed. */
export const DESTRUCTIVE_OPERATIONS: DestructiveOperation[] = [
  {
    fn: 'deleteTask',
    module: 'src/lib/agenda/queries.ts',
    uiEntryPoints: ['deleteTask'],
    destroys: 'A scheduled task row plus, by FK cascade, its triggers and its entire run history.',
  },
  {
    fn: 'deleteHighlight',
    module: 'src/lib/highlights/queries.ts',
    uiEntryPoints: ['deleteHighlight'],
    destroys: 'One saved highlight (soft-deleted: the row is flagged, not dropped).',
  },
  {
    fn: 'clearHighlightsForUrl',
    module: 'src/lib/highlights/queries.ts',
    uiEntryPoints: ['clearHighlightsForUrl'],
    destroys: 'Every highlight saved on one page, in one go.',
  },
  {
    fn: 'deleteGuidanceItem',
    module: 'src/lib/guidance/storage.ts',
    uiEntryPoints: ['deleteGuidance', 'deleteGuidanceItem'],
    destroys:
      'One saved guidance item — its note, screenshot, GIF or demo — from this device and, through the sync engine, from the cloud copy too.',
  },
  {
    fn: 'deleteDemo',
    module: 'src/lib/demos/storage.ts',
    uiEntryPoints: ['deleteDemo'],
    destroys: 'One recorded demo and its steps, locally and in the cloud.',
  },
  {
    fn: 'deletePattern',
    module: 'src/lib/supabase/queries.ts',
    uiEntryPoints: ['deletePattern'],
    destroys: 'One saved extraction pattern row (extend.wbx_pattern).',
  },
  {
    fn: 'deleteScreenshot',
    module: 'src/lib/supabase/queries.ts',
    uiEntryPoints: ['deleteScreenshot'],
    destroys:
      'One screenshot index row (extend.wbx_screenshot). The image file itself stays in cloud storage.',
  },
  {
    fn: 'removeTask',
    module: 'src/lib/lists/storage.ts',
    uiEntryPoints: ['removeTask'],
    destroys: 'One agent task, including whatever the agent recorded against it.',
  },
  {
    fn: 'clearCompletedTasks',
    module: 'src/lib/lists/storage.ts',
    uiEntryPoints: ['clearCompletedTasks'],
    destroys: 'Every done and skipped task in the conversation, in one go.',
  },
  {
    fn: 'clearAllTasks',
    module: 'src/lib/lists/storage.ts',
    uiEntryPoints: ['clearAllTasks'],
    destroys: 'Every task in the conversation, done or not.',
  },
  {
    fn: 'removeUserTodo',
    module: 'src/lib/lists/storage.ts',
    uiEntryPoints: ['removeUserTodo'],
    destroys: 'One of the user’s own to-dos.',
  },
  {
    fn: 'clearDoneUserTodos',
    module: 'src/lib/lists/storage.ts',
    uiEntryPoints: ['clearDoneUserTodos'],
    destroys: 'Every to-do already ticked off in the conversation.',
  },
  {
    fn: 'purgeConversation',
    module: 'src/lib/lists/storage.ts',
    uiEntryPoints: ['purgeConversation'],
    destroys: "A conversation's plan, all its tasks and all its to-dos.",
  },
  {
    fn: 'deleteVaultItem',
    module: 'src/lib/api/routes/vault.ts',
    uiEntryPoints: ['removeVaultItem'],
    destroys: 'A whole saved login and every field on it, server-side.',
  },
  {
    fn: 'deleteVaultField',
    module: 'src/lib/api/routes/vault.ts',
    uiEntryPoints: ['removeVaultField'],
    destroys: 'One field of a saved login, server-side.',
  },
  {
    fn: 'handleClearLocalDataConfirmed',
    module: 'src/features/settings/SettingsView.tsx',
    uiEntryPoints: ['handleClearLocalDataConfirmed'],
    destroys:
      'Everything the extension has cached on this device — settings, tokens, pair codes — and signs the user out. Server-side chats, captures and patterns survive.',
  },
  {
    fn: 'clearPairToken',
    module: 'src/lib/desktop/http.ts',
    uiEntryPoints: ['clearPairToken'],
    destroys: 'The desktop pairing token, which unpairs this browser from the desktop app.',
  },
  {
    // Zustand store methods, reached as `useRecordingsStore((s) => s.clear)`.
    // The guard matches the local names views bind them to, which is why the
    // views must keep calling them `clearRecordings` / `removeRecording`.
    fn: 'useRecordingsStore.clear',
    module: 'src/lib/video/recordings-store.ts',
    uiEntryPoints: ['clearRecordings'],
    destroys:
      'The whole local list of tab recordings on this device. The video files themselves stay in the cloud, but nothing in the extension points at them any more.',
  },
  {
    fn: 'useRecordingsStore.remove',
    module: 'src/lib/video/recordings-store.ts',
    uiEntryPoints: ['removeRecording'],
    destroys: 'One recording from the local list. The video file itself stays in the cloud.',
  },
];

/**
 * Destructive primitives the discovery scan will find that NO user click can
 * reach — sync engines, auth teardown, storage adapters. Each needs a reason,
 * because "it's internal" is exactly what the next unguarded delete button
 * will claim about itself.
 */
export const INTERNAL_ONLY: { fn: string; module: string; why: string }[] = [
  {
    fn: 'AgendaView',
    module: 'src/features/agenda/AgendaView.tsx',
    why: 'Consumes a one-shot "focus this task" key that the background wrote for it. Reading it is what spends it.',
  },
  {
    fn: 'drainPendingDraft',
    module: 'src/hooks/use-context-menu-listener.ts',
    why: 'Reads-and-consumes a one-shot draft handed over by the right-click menu.',
  },
  {
    fn: 'createTask',
    module: 'src/lib/agenda/queries.ts',
    why: 'Rolls back the half-created row it just inserted when a later insert fails. It can only ever delete its own failed work.',
  },
  {
    fn: 'signIn',
    module: 'src/lib/auth/flow.ts',
    why: 'Clears the one-time PKCE verifier the sign-in exchange has just consumed.',
  },
  {
    fn: 'signOut',
    module: 'src/lib/auth/flow.ts',
    why: 'Sign-out drops session keys. A session is not data; signing back in restores everything.',
  },
  {
    fn: 'signOut',
    module: 'src/hooks/use-auth.ts',
    why: 'Drops the cached is-admin bit on sign-out. Re-derived on the next sign-in.',
  },
  {
    fn: 'invalidateEnginePortCache',
    module: 'src/lib/desktop/discovery.ts',
    why: 'Cached desktop-engine port. Rediscovered automatically on the next call.',
  },
  {
    fn: 'setEnginePortOverride',
    module: 'src/lib/desktop/discovery.ts',
    why: 'Clearing a dev-only port override restores automatic discovery.',
  },
  {
    fn: 'removeItem',
    module: 'src/lib/auth/chrome-storage-adapter.ts',
    why: 'Supabase auth storage adapter. Called by the auth library, never by a control.',
  },
  {
    fn: 'removeItem',
    module: 'src/lib/storage/zustand-adapter.ts',
    why: 'Zustand persistence adapter. Called by the store engine, never by a control.',
  },
  {
    fn: 'deleteGuidanceItem',
    module: 'src/lib/guidance/storage.ts',
    why: 'Also listed above as a confirmed operation; the sync engine reaches it with { sync: false } when applying a delete another device already confirmed.',
  },
  {
    fn: 'deleteDemo',
    module: 'src/lib/demos/storage.ts',
    why: 'Also listed above as a confirmed operation; the sync engine reaches it when applying a delete another device already confirmed.',
  },
  {
    fn: 'erasePersistedSnapshot',
    module: 'src/lib/credentials/capture-candidates.ts',
    why: 'Wipes the plaintext login-capture session cache (chrome.storage.session), never a user record. Called only from the service worker\'s own bookkeeping — persist() once no candidate is pending, and ensureSession() on worker startup when the actor changed or capture got disabled — never from a click or a message a user or the UI sends.',
  },
];

/**
 * KNOWN LIMIT OF THE DISCOVERY SCAN, stated rather than hidden: it recognises
 * a removal by its PRIMITIVE — a Supabase `.delete()`, a chrome.storage or
 * localStorage removal, the vault's HTTP DELETE. Two shapes it cannot see are
 * a soft delete (an UPDATE that sets `is_deleted`) and a store that overwrites
 * its key with an empty list. Both exist here (`deleteHighlight`,
 * `useRecordingsStore.clear`) and both are registered ABOVE by hand, so the
 * call-site guard covers them; what the discovery scan cannot do is force a
 * NEW one of those two shapes to be registered. If a third soft-delete surface
 * appears, add its primitive here rather than trusting the next sweep.
 */
