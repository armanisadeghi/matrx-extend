/**
 * Example task handler for `kind='ping'`.
 *
 * This handler simply echoes a result so we can exercise the full
 * scheduler-host loop end-to-end (subscribe → claim → handler → finalize)
 * once a task of this kind arrives. It exists primarily to prove that the
 * registration path compiles and runs at SW boot.
 *
 * Important caveat: `sch_task.kind` is currently constrained to `'agent'`
 * by the DB CHECK constraint defined in `migrations/2026_05_10_sch_v0.sql`.
 * Until that CHECK is widened (Phase 3c.2 / Phase 4 work in aidream) no
 * `kind='ping'` row can be inserted, so this handler will register but
 * never fire. Subsequent phases will:
 *   - Widen the CHECK constraint to include additional kinds.
 *   - Ship real handlers (agent dispatch, browser actions, etc.) that
 *     route through the same `registerTaskHandler` mechanism.
 *
 * Side-effect registration: importing this module is enough — the call to
 * `registerTaskHandler('ping', ...)` runs at module-init time. The host's
 * `index.ts` imports this file once so the registration happens at SW boot.
 */

import { registerTaskHandler } from '@/lib/scheduler-host';

registerTaskHandler('ping', async (task) => {
    return {
        ok: true,
        resultSummary: `pong from chrome-extension-chat (task=${task.id})`,
        resultMetadata: {
            handledBy: 'matrx-extend',
            taskTitle: task.title,
        },
    };
});
