/**
 * Demo recording / replay shared types.
 *
 * 📝 Design notes:
 *    .research/proposed-tools-and-features.md (item #1)
 *    .research/demo-system-design-notes.md
 */

/** A single user-action event captured during recording. */
export type DemoStepKind =
  | 'navigate'
  | 'click'
  | 'type'
  | 'submit'
  | 'select'
  | 'check'
  | 'press_key'
  | 'scroll'
  | 'wait';

/**
 * One strategy for re-finding the element at replay time. Strategies are
 * tried in `selector_chain` order — first one that resolves a unique,
 * visible element wins. We capture multiple strategies per step so a
 * single brittle selector doesn't break replay; this is the heart of the
 * "self-healing" pattern.
 */
export interface SelectorStrategy {
  /** Why we trust this strategy (informational, also used to rank). */
  kind:
    | 'matrx-ref'
    | 'id'
    | 'data-testid'
    | 'name-attr'
    | 'aria'
    | 'text'
    | 'css-path';
  /** A CSS selector (or pseudo-selector) the resolver knows how to consume. */
  selector: string;
  /** Optional accessible-name / visible-text for `aria` and `text` strategies. */
  match_text?: string;
  /** Optional ARIA role for `aria` strategy. */
  role?: string;
}

/** Snapshot of the element captured at record time, for diagnostics + LLM fallback. */
export interface ElementSnapshot {
  tag: string;
  role?: string;
  accessible_name?: string;
  visible_text?: string;
  /** Normalised viewport rect at the moment of capture. */
  bounding_rect?: { x: number; y: number; w: number; h: number };
  /** A small set of attributes that are diagnostic without being noisy. */
  attrs?: Record<string, string>;
}

export interface DemoStep {
  /** Stable per-step uuid (for editing / replacement). */
  id: string;
  /** Insertion order; replay walks in ascending order. */
  index: number;
  kind: DemoStepKind;
  /** The page URL at the moment of capture. */
  url: string;
  /** Tab id at the moment of capture (informational only — replay opens fresh). */
  source_tab_id: number;
  /** Milliseconds since the recording began. */
  ts_ms_offset: number;

  selector_chain: SelectorStrategy[];
  element_snapshot?: ElementSnapshot;

  /** Text typed (for `type` / `select`) or key-combo pressed (for `press_key`). */
  input_text?: string;
  /** Boolean state for `check` (checkbox / radio). */
  checked?: boolean;
  /** [x, y] target for `scroll`. */
  scroll_target?: { x: number; y: number };
  /** Destination URL for `navigate`. */
  navigation_url?: string;

  /**
   * If non-null, the captured `input_text` represents a parameter slot.
   * At replay time `params[param_placeholder]` substitutes for the
   * recorded value. Useful for credentials, IDs, dates, etc.
   */
  param_placeholder?: string;
  /**
   * Recorder marks fields that were password / autocomplete=cc-* / etc.
   * The runtime never echoes these in logs and never persists them
   * unencrypted — they are forced to be parameterized at save time.
   */
  is_sensitive?: boolean;
}

export interface DemoParameter {
  /** Placeholder name as referenced in steps (`{{email}}` → `email`). */
  name: string;
  /** Human-readable description for the agent / user. */
  description?: string;
  /** Optional hint at the expected shape: 'email', 'url', 'number', etc. */
  type?: string;
  /** Was this parameter created from a sensitive field? */
  sensitive?: boolean;
}

export interface DemoSummary {
  id: string;
  name: string;
  description: string;
  start_url: string;
  step_count: number;
  parameter_names: string[];
  created_at: number;
  updated_at: number;
}

export interface Demo extends DemoSummary {
  steps: DemoStep[];
  parameters: DemoParameter[];
  created_by_user_id?: string;
}

/** Mutable in-flight recording. Lives in SW memory until saved or discarded. */
export interface RecordingState {
  recordingId: string;
  tabId: number;
  startedAt: number;
  startUrl: string;
  steps: DemoStep[];
  /** True after we've emitted at least one event for the current page load. */
  pageLoaded: boolean;
  /** Last URL we know about — used to detect SPA navigations. */
  lastUrl: string;
  /** Tracks pending scroll debounces by tab. */
  scrollTimer: ReturnType<typeof setTimeout> | null;
  unregister: () => Promise<void>;
}

/** Result envelope returned by the replayer per step. */
export interface ReplayStepResult {
  step_id: string;
  index: number;
  kind: DemoStepKind;
  ok: boolean;
  resolved_via?: SelectorStrategy['kind'];
  error?: string;
  /** Wall-clock ms spent waiting + acting on this step. */
  elapsed_ms: number;
}

export interface ReplayResult {
  ok: boolean;
  demo_id: string;
  steps_attempted: number;
  steps_succeeded: number;
  step_results: ReplayStepResult[];
  /** When the run aborted, this is the index that failed. */
  failed_at_index?: number;
  duration_ms: number;
}
