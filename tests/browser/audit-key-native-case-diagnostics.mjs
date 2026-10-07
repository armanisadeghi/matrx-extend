// Fixed targets for the additional audit inventory cases. Never copy CDP
// errors, card text, key IDs, receipt rows, URLs, or wait snapshots here.
const STEPS = {
  T27: new Set([
    'reload_for_warm',
    'read_storage',
    'check_precondition',
    'compare_warm',
    'reload_for_comparison',
    'compare_reloaded',
  ]),
  T62: new Set([
    'select_agent',
    'compare_agent',
    'select_pilot',
    'compare_pilot',
    'select_parallel',
    'compare_parallel',
    'select_webmcp',
    'compare_webmcp',
    'select_all',
    'compare_all',
    'check_empty_origin',
  ]),
  T61: new Set([
    'read_before_cancel',
    'open_confirmation',
    'wait_confirmation',
    'cancel_confirmation',
    'wait_closed',
    'compare_after_cancel',
    'compare_cancelled_card',
    'inject_history_failure',
    'confirm_failed_rotation',
    'observe_failed_rotation',
    'read_failure_fault',
    'compare_after_failure',
    'restore_history',
    'confirm_successful_rotation',
    'observe_successful_rotation',
    'read_after_rotation',
    'check_history',
  ]),
};
const ORIGINS = new Set(['all', 'agent', 'pilot', 'parallel', 'webmcp']);
const bounded = (value) => (Number.isInteger(value) && value >= 0 && value <= 1000 ? value : null);

export function auditMissingCaseFailure(caseId, step, observation = {}) {
  if (!Object.hasOwn(STEPS, caseId) || !STEPS[caseId].has(step)) return null;
  return {
    failure_code: `audit_${caseId.toLowerCase()}_${step}_failed`,
    diagnostic: {
      case_id: caseId,
      step,
      last_safe_observation: {
        selected_origin: ORIGINS.has(observation.selected_origin)
          ? observation.selected_origin
          : null,
        receipt_count: bounded(observation.receipt_count),
        visible_rows: bounded(observation.visible_rows),
        dialog_visible:
          typeof observation.dialog_visible === 'boolean' ? observation.dialog_visible : null,
        key_unchanged:
          typeof observation.key_unchanged === 'boolean' ? observation.key_unchanged : null,
      },
    },
  };
}
