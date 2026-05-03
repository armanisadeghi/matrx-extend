/**
 * Public entry point for building per-message context. Implementation lives
 * in `./context/`. Two shapes available:
 *   - v2-bundled (default) — opinionated bundles, ~12 keys, page_brief always
 *     loaded, the rest available on demand via the server's auto-context-fetch.
 *   - v1-flat (admin toggle) — legacy flat 65-key shape for A/B comparison.
 *
 * The toggle lives in chrome.storage.local under `matrx.context.shape`.
 */

export {
  buildChatContext,
  getContextShape,
  setContextShape,
  DEFAULT_CONTEXT_SHAPE,
} from './context';
export type { ContextBuildInputs, ContextShape } from './context';
