import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ts = (
  await import(
    process.env.MATRX_TYPESCRIPT_MODULE
      ? pathToFileURL(process.env.MATRX_TYPESCRIPT_MODULE).href
      : 'typescript'
  )
).default;

export const terminalBudgetPaths = {
  runner: 'src/lib/data-pattern/run-interactive.ts',
  core: 'src/lib/data-pattern/document-network-capture.ts',
  handler: 'src/lib/tools/handlers/data-patterns.ts',
  panelDriver: 'tests/browser/settings-panel-driver.mjs',
};
const nodes = (root, predicate) => {
  const found = [];
  const visit = (node) => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
};
const parse = (source) => ts.createSourceFile('contract.ts', source, ts.ScriptTarget.Latest, true);
const one = (values) => {
  assert.equal(values.length, 1, 'terminal_budget_contract_mismatch');
  return values[0];
};
const positive = (value) => {
  assert.ok(Number.isSafeInteger(value) && value > 0, 'terminal_budget_contract_mismatch');
  return value;
};

// Read the *installed artifact's* source, not a copied timeout or current HEAD.
// The saved UI carries no timeout override; refuse an unrecognized contract.
export function deriveD47TerminalBudget(sources) {
  const runner = parse(sources.runner);
  const run = one(
    nodes(
      runner,
      (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'runNetworkCapturePattern',
    ),
  );
  const window = one(
    nodes(
      run,
      (node) => ts.isVariableDeclaration(node) && node.name.getText(runner) === 'windowMs',
    ),
  );
  assert.ok(
    ts.isBinaryExpression(window.initializer) &&
      window.initializer.left.getText(runner) === 'opts.timeoutMs' &&
      window.initializer.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      ts.isNumericLiteral(window.initializer.right),
    'terminal_budget_contract_mismatch',
  );
  const captureWindowMs = positive(Number(window.initializer.right.text));
  const armedWindowTimers = nodes(
    run,
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(runner) === 'setTimeout' &&
      node.arguments.at(-1)?.getText(runner) === 'windowMs',
  );
  one(armedWindowTimers);
  const captureCall = one(
    nodes(
      run,
      (node) =>
        ts.isCallExpression(node) &&
        node.expression.getText(runner) === 'openDocumentNetworkCapture',
    ),
  );
  assert.match(captureCall.arguments[0].getText(runner), /timeoutMs:\s*windowMs/);
  assert.match(captureCall.arguments[0].getText(runner), /onArmed:\s*startWindow/);
  const handler = parse(sources.handler);
  const call = one(
    nodes(
      handler,
      (node) => ts.isCallExpression(node) && node.expression.getText(handler) === 'runSavedPattern',
    ),
  );
  assert.ok(
    !/timeoutMs/.test(call.arguments[2].getText(handler)),
    'terminal_budget_override_unavailable',
  );
  assert.ok(
    ts.isObjectLiteralExpression(call.arguments[2]),
    'terminal_budget_override_unavailable',
  );
  for (const property of call.arguments[2].properties) {
    if (!ts.isSpreadAssignment(property)) continue;
    let expression = property.expression;
    while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
    assert.ok(
      ts.isBinaryExpression(expression) &&
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        ts.isObjectLiteralExpression(expression.right),
      'terminal_budget_override_unavailable',
    );
    assert.ok(
      expression.right.properties.every((entry) => !ts.isSpreadAssignment(entry)),
      'terminal_budget_override_unavailable',
    );
  }
  const forwarding = one(
    nodes(
      runner,
      (node) =>
        ts.isCallExpression(node) && node.expression.getText(runner) === 'runNetworkCapturePattern',
    ),
  );
  assert.equal(
    forwarding.arguments[2].getText(runner),
    'opts',
    'terminal_budget_override_unavailable',
  );

  const core = parse(sources.core);
  // Cleanup removal and debugger release race the SAME deadline (one window).
  const deadline = one(
    nodes(core, (node) => ts.isVariableDeclaration(node) && node.name.getText(core) === 'deadline'),
  );
  const timer = one(
    nodes(
      deadline,
      (node) => ts.isCallExpression(node) && node.expression.getText(core) === 'setTimeout',
    ),
  );
  assert.equal(
    timer.arguments[1].getText(core),
    'opts.timeoutMs',
    'terminal_budget_contract_mismatch',
  );
  const driver = parse(sources.panelDriver);
  const wait = one(
    nodes(driver, (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'waitFor'),
  );
  const timeout = one(
    wait.parameters.filter((parameter) => parameter.name.getText(driver) === 'timeoutMs'),
  );
  assert.ok(ts.isNumericLiteral(timeout.initializer), 'terminal_budget_contract_mismatch');
  const deliveryMs = positive(Number(timeout.initializer.text));
  const polling = one(
    nodes(
      wait,
      (node) => ts.isCallExpression(node) && node.expression.getText(driver) === 'setTimeout',
    ),
  );
  assert.ok(ts.isNumericLiteral(polling.arguments[1]), 'terminal_budget_contract_mismatch');
  const pollMs = positive(Number(polling.arguments[1].text));
  return {
    capture_window_ms: captureWindowMs,
    cleanup_ms: captureWindowMs,
    delivery_ms: deliveryMs,
    poll_ms: pollMs,
    // Called only AFTER current HTTP response: setup/arming already happened.
    timeout_ms: captureWindowMs + captureWindowMs + deliveryMs,
    source_sha256: Object.fromEntries(
      Object.entries(sources).map(([key, value]) => [
        key,
        createHash('sha256').update(value).digest('hex'),
      ]),
    ),
  };
}

export async function waitD47SavedTerminal({
  budget,
  read,
  record,
  now = () => performance.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const started = now();
  const deadline = started + budget.timeout_ms;
  for (;;) {
    let state;
    try {
      state = await read();
    } catch {
      state = { observation_unavailable: true };
    }
    // Monotonic durations, booleans only. Never retain body text or exceptions.
    const safe = Object.fromEntries(
      [
        'exact_recipe',
        'current_row',
        'old_row',
        'running',
        'error_present',
        'observation_unavailable',
      ].map((key) => [key, state?.[key] === true]),
    );
    const elapsed = now() - started;
    record({ elapsed_ms: elapsed, remaining_ms: Math.max(0, deadline - now()), ...safe });
    if (safe.exact_recipe && safe.current_row) return safe;
    if (elapsed >= budget.timeout_ms) throw new Error('saved_current_result_not_observed');
    await sleep(Math.min(budget.poll_ms, deadline - now()));
  }
}
