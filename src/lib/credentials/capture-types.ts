/**
 * Wire shapes shared by the three sides of the "Save this login?" flow
 * (content detector / prompt, service-worker host, side-panel card).
 * Everything here is METADATA — the only value-bearing shape is
 * `CaptureCandidateWire` in capture-detector.ts, and it is consumed by exactly
 * one raw listener in capture-candidates.ts.
 */

export interface CaptureExistingLogin {
  item_id: string;
  display_name: string;
}

/** What a tab / the side panel is told about a pending candidate. Value-free. */
export interface CapturePromptMeta {
  candidateId: string;
  tabId: number;
  host: string;
  /** The username the page showed — not secret, shown so the user knows which account. */
  username: string | null;
  /** Server-approved logins already saved for this site → "Update" instead of duplicate. */
  existing: CaptureExistingLogin[];
}

export type CaptureDecisionAction = 'save' | 'update' | 'dismiss' | 'never';

export interface CaptureDecision {
  candidateId: string;
  action: CaptureDecisionAction;
  /** Required for `update`: which existing login receives the new password. */
  itemId?: string;
}

export type CaptureDecisionStatus =
  | 'saved'
  | 'updated'
  | 'dismissed'
  | 'never'
  | 'expired'
  | 'sign_in_required'
  | 'error';

export interface CaptureDecisionResult {
  ok: boolean;
  status: CaptureDecisionStatus;
  /** Static human copy. Never derived from page or server text. */
  message: string;
}

export interface CaptureStatusQuery {
  tabId: number;
}
