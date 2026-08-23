/**
 * The route environment for `applyIrKindRoute` — registries + platform + the
 * scream seam, bound once.
 *
 * Deliberately React-free so the stream handler and any test can route a block
 * without a provider in scope. The route decides a block's TYPE; turning that
 * type into pixels is `components/kinds/dispatch.tsx`.
 */

import type { KindRouteEnv, KindVersionSources } from '@ai-matrx/content-ir-react';
import { kindRegistry, componentRegistry } from './registry';
import { CONTENT_IR_PLATFORM } from './platform';
import { reportContentIrError } from './errors';

export const contentIrRouteEnv: KindRouteEnv = {
  kinds: kindRegistry,
  components: componentRegistry,
  reportError: reportContentIrError,
  platform: CONTENT_IR_PLATFORM,
};

/**
 * The repaint sources for `useContentIrKindVersion`. Passed EXPLICITLY because
 * a render block draws below no provider — the host boundary wraps only the
 * generic floor, which is the one place a package component needs the seams.
 */
export const contentIrVersionSources: KindVersionSources = {
  kinds: kindRegistry,
  components: componentRegistry,
};

/**
 * Warm both registries once. Called when the chat surface mounts, not at
 * module load: an unauthenticated side panel has no session to read with, and
 * the resolver's own failure path is retryable.
 */
export function warmContentIr(): void {
  void kindRegistry.ensureWarm();
  void componentRegistry.ensureWarm();
}
