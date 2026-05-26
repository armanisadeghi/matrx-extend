/**
 * Compute-target wire shapes, mirroring aidream's
 * `aidream/api/schemas/compute_targets.py`. Keep these in sync — they are
 * the contract between every matrx client (this extension, matrx-frontend,
 * matrx-local) and the aidream backend.
 *
 * A target is one of:
 *   - **ec2 / hosted sandbox** — orchestrator-managed container
 *   - **local-pc** — user's own machine, registered by matrx-local with a
 *     Cloudflare tunnel
 *
 * The user picks one in the SandboxPickerChip; the selection is stored in
 * the chat store and resolved on every chat send through
 * `POST /api/compute-targets/resolve` into the full sandbox-binding payload
 * the agent loop already knows how to consume.
 */

export type ComputeTargetKind = "ec2" | "hosted" | "local-pc";

export type ComputeTargetStatus =
  | "ready"
  | "running"
  | "starting"
  | "creating"
  | "shutting_down"
  | "stopped"
  | "failed"
  | "expired"
  | "online"
  | "offline";

export interface ComputeTarget {
  id: string;
  kind: ComputeTargetKind;
  name: string;
  status: ComputeTargetStatus;
  is_online: boolean;
  is_this_device: boolean;

  // Sandbox-only:
  sandbox_id: string | null;
  tier: "ec2" | "hosted" | null;
  template: string | null;
  expires_at: string | null;

  // Local-PC-only:
  instance_id: string | null;
  tunnel_url: string | null;
  platform: string | null;
  last_seen: string | null;
}

export interface ComputeTargetListResponse {
  targets: ComputeTarget[];
  max_sandboxes: number;
  sandbox_count: number;
}

/** Stored per-conversation in the chat Zustand store. */
export interface ComputeTargetRef {
  kind: ComputeTargetKind;
  id: string;
  /** The display name latched at selection time so the picker chip can
   * render it without re-fetching the full list. */
  name: string;
}

/** Full sandbox binding the server resolves a ref into — the existing
 * shape the chat backend consumes on every turn. */
export interface SandboxBindingPayload {
  sandbox_id: string;
  base_url: string;
  access_token: string;
  root_path: string;
}
