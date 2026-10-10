// Fixed vocabulary only: never persist exception messages, stacks or target data.
export const RELOAD_OPERATIONS = Object.freeze([
  'reload_setup',
  'worker_retirement',
  'sender_document_prepare',
  'fixture_focus',
  'open_diagnostic_start',
  'fixture_reply_clear',
  'fixture_open_prepare',
  'fixture_open_click',
  'panel_poll',
  'context_observation',
  'management_recheck',
  'reply_observation_close',
  'open_diagnostic_close',
  'panel_attach',
  'lifetime_close',
  'listeners_remove',
  'management_page_close',
]);
const EXCEPTION_CLASSES = new Set([
  'Error',
  'TypeError',
  'ReferenceError',
  'RangeError',
  'SyntaxError',
  'TimeoutError',
  'AssertionError',
  'ProtocolError',
  'unknown',
]);
export function safeReloadOperationFailure(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    operation: RELOAD_OPERATIONS.includes(value.operation) ? value.operation : 'unavailable',
    exceptionClass: EXCEPTION_CLASSES.has(value.exceptionClass) ? value.exceptionClass : 'unknown',
    cleanupFailures: Array.isArray(value.cleanupFailures)
      ? [...new Set(value.cleanupFailures.filter((stage) => RELOAD_OPERATIONS.includes(stage)))]
      : [],
  };
}
export function reloadOperationBoundary() {
  let operation = 'reload_setup';
  let primary;
  const cleanupFailures = [];
  return {
    mark(value) {
      operation = value;
    },
    capture(error) {
      if (!primary)
        primary = {
          operation,
          exceptionClass: EXCEPTION_CLASSES.has(error?.name) ? error.name : 'unknown',
          cleanupFailures,
        };
      if (error && typeof error === 'object') error.reloadOperationFailure = primary;
    },
    async cleanup(stage, action) {
      try {
        await action();
      } catch (error) {
        cleanupFailures.push(stage);
        if (!primary) {
          operation = stage;
          this.capture(error);
          return error;
        }
      }
      return null;
    },
  };
}
