/**
 * The one prop contract every registered kind component in this client takes.
 *
 * `value` is the RECONSTRUCTED kind instance — the zero-loss value object the
 * envelope carries, `__kind` marker included (accept-and-ignore it; never
 * strip it, and never treat its presence as a data field).
 */
export interface KindComponentProps {
  value: unknown;
  kind: string;
  /** False while the block is still arriving; a component may render partially. */
  complete: boolean;
}
