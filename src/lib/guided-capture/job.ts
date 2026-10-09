/**
 * Guided capture — the job's life on the page, as pure transitions.
 *
 * The overlay is a view of this state; the content script feeds it events.
 * Nothing here touches the DOM or chrome.*, so every transition is unit-tested.
 *
 *   guiding ──capture──▶ filing ──ok──▶ done
 *      ▲                    │
 *      └────── retry ◀── failed ◀──fail
 */

export type GuidedPhase = 'guiding' | 'filing' | 'done' | 'failed';

export interface GuidedState {
  phase: GuidedPhase;
  /** Items seen on the page so far (posts, videos). Only ever grows. */
  itemCount: number;
  /** Filled when `done`. */
  filed: { chars: number; items: number; notice: string | null } | null;
  /** The sentence a person reads when `failed`. */
  error: string | null;
}

export type GuidedEvent =
  | { type: 'items'; count: number }
  | { type: 'capture' }
  | { type: 'filed'; chars: number; items: number; notice?: string | null }
  | { type: 'failed'; sentence: string }
  | { type: 'retry' };

export const INITIAL_GUIDED_STATE: GuidedState = {
  phase: 'guiding',
  itemCount: 0,
  filed: null,
  error: null,
};

export function reduceGuided(state: GuidedState, event: GuidedEvent): GuidedState {
  switch (event.type) {
    case 'items':
      // Progress is a running high-water mark: a feed that recycles its DOM
      // must never make the person's count go down.
      if (state.phase === 'done') return state;
      return event.count > state.itemCount ? { ...state, itemCount: event.count } : state;
    case 'capture':
      return state.phase === 'guiding' ? { ...state, phase: 'filing', error: null } : state;
    case 'filed':
      return state.phase === 'filing'
        ? {
            ...state,
            phase: 'done',
            error: null,
            filed: { chars: event.chars, items: event.items, notice: event.notice ?? null },
          }
        : state;
    case 'failed':
      return state.phase === 'filing'
        ? { ...state, phase: 'failed', error: event.sentence }
        : state;
    case 'retry':
      return state.phase === 'failed' ? { ...state, phase: 'guiding', error: null } : state;
  }
}

/** Whether the Capture button is live. */
export function canCapture(state: GuidedState): boolean {
  return state.phase === 'guiding';
}
