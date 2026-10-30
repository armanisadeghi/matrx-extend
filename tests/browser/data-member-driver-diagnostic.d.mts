export interface DataMemberPointerDiagnostic {
  code: 'pointer_target_not_unique';
  sample_stage: 'visibility_filter';
  matched_target_count: number | null;
  visible_target_count: number | null;
  data_tab: {
    matching_tab_count: number | null;
    visible_tab_count: number | null;
    active_tab_count: number | null;
    active_data_pane_count: number | null;
  } | null;
}

export interface DataMemberNameEntrySample {
  sampled: boolean;
  read_failure_category: 'diagnostic_read_unavailable' | null;
  active: boolean | null;
  input_count: number | null;
  focused: boolean | null;
  nonempty: boolean | null;
  value_length: number | null;
  expected_length: number | null;
  matches: boolean | null;
  document_time_origin: number | null;
}

export interface DataMemberReloadWaitSample {
  sampled: boolean;
  active: boolean | null;
  matching_tab_count: number | null;
  visible_tab_count: number | null;
  active_tab_count: number | null;
  selected_tab_count: number | null;
  linked_pane_count: number | null;
  linked_active_pane_count: number | null;
  active_tab_category: 'data' | 'chat' | 'other' | 'none' | 'ambiguous' | null;
  render_error_present: boolean | null;
  saved_pattern_visible: boolean | null;
}

export function captureDataMemberDriverDiagnostic(
  error: unknown,
): DataMemberPointerDiagnostic | null;
export function recordDataMemberDriverDiagnostic(
  error: unknown,
  report: Record<string, unknown>,
): DataMemberPointerDiagnostic | null;
export function dataMemberNameEntrySample(value: unknown): DataMemberNameEntrySample;
export function observeDataMemberNameEntry(
  report: Record<string, unknown>,
  stage: string,
  read: () => unknown,
): Promise<void>;
export function dataMemberReloadWaitSample(value: unknown): DataMemberReloadWaitSample;
