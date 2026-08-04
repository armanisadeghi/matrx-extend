/**
 * Guidance: user-saved clues for the agent.
 *
 * A guidance item is a domain-scoped artifact the user creates so that
 * the agent automatically discovers it on the next visit. Items range
 * from text notes to recorded demos to annotated screenshots.
 *
 * The unifying property: each item is something the same agent (or a
 * Playwright runner on the server) can use directly when it next visits
 * the site — either as inline context (text, image, GIF) or as an
 * agent-callable tool (replay a demo).
 *
 * Storage layout (chrome.storage.local):
 *   matrx.guidance.list         → GuidanceSummary[] (cheap-to-list index)
 *   matrx.guidance.{id}         → GuidanceItem (full record)
 *
 * Heavy bytes (image / GIF) live in cld_files via uploadFile(); we keep
 * only the file_id + URL inline. Annotation document JSON stays inline
 * because it's small and self-contained.
 */

export type GuidanceKind = 'note' | 'screenshot' | 'gif' | 'demo_ref';

interface GuidanceBase {
  id: string;
  domain: string;
  /** Optional one-line summary the user types or that's auto-derived. */
  caption?: string;
  /** ISO timestamps. */
  created_at: number;
  updated_at: number;
  /** When known — the URL the artifact was captured on (more specific than `domain`). */
  origin_url?: string;
}

export interface GuidanceNote extends GuidanceBase {
  kind: 'note';
  text: string;
}

export interface GuidanceScreenshot extends GuidanceBase {
  kind: 'screenshot';
  /** cld_files MediaRef of the raw screenshot. */
  file_id: string;
  /** Fetchable URL (CDN or signed) for the raw screenshot. */
  url: string | null;
  width?: number;
  height?: number;
  /** When the user has added markup, the flattened-PNG file_id (preferred for agent vision). */
  annotated_file_id?: string;
  /** When the user has added markup, the corresponding URL. */
  annotated_url?: string | null;
  /** Tldraw document JSON (snapshot the editor produces). Stored inline. */
  annotation_doc?: unknown;
}

export interface GuidanceGif extends GuidanceBase {
  kind: 'gif';
  file_id: string;
  url: string | null;
  duration_ms?: number;
  /** Number of frames recorded (informational). */
  frame_count?: number;
}

/**
 * Reference to a recorded demo. The full demo lives in `chrome.storage.local`
 * under `matrx.demos.{id}` (managed by src/lib/demos/storage.ts); this is a
 * domain-attached pointer so the demo shows up in guidance lookups.
 */
export interface GuidanceDemoRef extends GuidanceBase {
  kind: 'demo_ref';
  demo_id: string;
  /** Mirrored from the Demo for convenience — saves a round trip when listing. */
  name: string;
  step_count: number;
  parameter_names: string[];
}

export type GuidanceItem = GuidanceNote | GuidanceScreenshot | GuidanceGif | GuidanceDemoRef;

/** Lightweight projection used by the list-index and the sidepanel UI. */
export interface GuidanceSummary {
  id: string;
  kind: GuidanceKind;
  domain: string;
  caption?: string;
  created_at: number;
  updated_at: number;
  /** demo_id for kind='demo_ref'; undefined otherwise. */
  demo_id?: string;
}
