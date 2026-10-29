/** Type surface consumed by TypeScript harness tests; implementation remains in the native driver. */
export interface EvaluationPanel {
  send(
    method: 'Runtime.evaluate',
    params: { expression: string; awaitPromise: true; returnByValue: true },
  ): Promise<{ exceptionDetails?: unknown; result?: { value?: unknown } }>;
}

export function activeTabPanelExpression(title: string): string;
export function evaluate(panel: EvaluationPanel, expression: string): Promise<unknown>;
export function waitFor<T>(
  label: string,
  read: () => T | Promise<T>,
  accept: (value: T | { transient: string }) => boolean,
  timeoutMs?: number,
  diagnostic?: (value: T | { transient: string }) => unknown,
  beforeRead?: () => void | Promise<void>,
): Promise<T | { transient: string }>;
