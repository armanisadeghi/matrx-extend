import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const DRIVER = resolve(import.meta.dirname, 'seo-guest-acceptance.mjs');

function descendants(node, accept) {
  const found = [];
  function visit(child) {
    if (accept(child)) found.push(child);
    ts.forEachChild(child, visit);
  }
  visit(node);
  return found;
}

function callsNamed(node, name) {
  return descendants(
    node,
    (child) =>
      ts.isCallExpression(child) &&
      (ts.isIdentifier(child.expression)
        ? child.expression.text === name
        : ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === name),
  );
}

function literal(call, position) {
  const arg = call.arguments[position];
  return arg && ts.isStringLiteral(arg) ? arg.text : null;
}

function alwaysExits(statement) {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  if (ts.isBlock(statement)) return statement.statements.some(alwaysExits);
  if (ts.isIfStatement(statement))
    return (
      (statement.expression.kind === ts.SyntaxKind.TrueKeyword &&
        alwaysExits(statement.thenStatement)) ||
      (statement.elseStatement &&
        alwaysExits(statement.thenStatement) &&
        alwaysExits(statement.elseStatement))
    );
  return false;
}

// Follow the actual statement path, including nested callback bodies. This
// rejects an unconditional exit before a retained call without requiring a
// browser double or treating unrelated source text as executable evidence.
function assertReachable(call, boundary, message) {
  for (let child = call; child !== boundary; child = child.parent) {
    assert.ok(child.parent, `${message}: call stays inside its callback`);
    if (!ts.isBlock(child.parent)) continue;
    const prior = child.parent.statements.slice(0, child.parent.statements.indexOf(child));
    assert.ok(!prior.some(alwaysExits), message);
  }
}

// Inspect the callback the native harness actually executes. The guard is
// derived from calls that perform the cases, rather than a line or text order.
function inspectDriverSequence(source) {
  assert.match(
    source,
    /const SEO_CASE_SCOPE = process\.env\.SEO_GUEST_CASE_SCOPE \?\? 'full';/,
    'native driver reads scope with full default',
  );
  const ast = ts.createSourceFile('seo-guest-acceptance.mjs', source, ts.ScriptTarget.Latest, true);
  assert.equal(ast.parseDiagnostics.length, 0, 'SEO driver parses');
  const harnesses = callsNamed(ast, 'runNativeSidepanelQa');
  assert.equal(harnesses.length, 1, 'one native SEO harness invocation');
  const options = harnesses[0].arguments[0];
  assert.ok(options && ts.isObjectLiteralExpression(options), 'native harness has options');
  const panel = options.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === 'exercisePanel',
  )?.initializer;
  assert.ok(panel && ts.isArrowFunction(panel), 'native harness executes SEO panel callback');
  const sequences = callsNamed(panel, 'runSeoCaseSequence');
  assert.equal(sequences.length, 1, 'native panel runs the sequence exactly once');
  const sequence = sequences[0];
  assert.ok(ts.isAwaitExpression(sequence.parent), 'native panel awaits the sequence');
  assert.ok(
    ts.isBlock(panel.body) && panel.body.statements.includes(sequence.parent.parent),
    'native panel executes the sequence directly',
  );
  assertReachable(sequence, panel, 'native panel sequence is reachable');
  assert.equal(sequence.arguments.length, 3, 'controlled, detail, and scope are wired');
  const [controlled, dynamic, scope] = sequence.arguments;
  assert.ok(
    ts.isIdentifier(scope) && scope.text === 'SEO_CASE_SCOPE',
    'native driver passes selected scope',
  );
  assert.ok(ts.isArrowFunction(controlled), 'first phase is an executable callback');
  assert.ok(ts.isArrowFunction(dynamic), 'second phase is an executable callback');

  const recapture = callsNamed(controlled, 'runCopyCheckThenRecapture');
  assert.equal(recapture.length, 1, 'controlled phase exercises social copy and recapture');
  const socialCopies = callsNamed(controlled, 'copySocialTags');
  assert.equal(socialCopies.length, 2, 'both social copy states run');
  const t02 = callsNamed(controlled, 'target').find(
    (call) =>
      literal(call, 0) === 'T02' &&
      literal(call, 1) === 'guest_reaudit_captures_changed_page_metadata',
  );
  assert.ok(t02, 'controlled phase records the changed-metadata result');
  for (const call of [recapture[0], ...socialCopies, t02])
    assertReachable(call, controlled, 'controlled phase is reachable');
  assert.ok(
    callsNamed(dynamic, 'assertNext').some(
      (call) => literal(call, 0) === 'manual_source_stability',
    ),
    'volatile public source still gates exact detail credit',
  );
  assert.ok(
    callsNamed(dynamic, 'target').some((call) => literal(call, 0) === 'T09'),
    'detail phase retains its original result targets',
  );
  assert.equal(
    callsNamed(panel, 'runCopyCheckThenRecapture').length,
    1,
    'all controlled copy and recapture work is inside the first phase',
  );
  assert.equal(
    callsNamed(panel, 'copySocialTags').length,
    2,
    'all social copy work is in sequence',
  );
  assert.equal(
    callsNamed(panel, 'assertNext').filter((call) => literal(call, 0) === 'manual_source_stability')
      .length,
    1,
    'one volatile source assertion runs inside the second phase',
  );
  assert.ok(
    callsNamed(panel, 'target').some(
      (call) => literal(call, 1) === 'guest_reaudit_captures_changed_page_metadata',
    ),
    'actual driver records controlled T02 result',
  );
  assert.ok(
    callsNamed(panel, 'copySocialTags').length === 2,
    'actual driver executes both T14 copy states',
  );
  return { ast, sequence };
}

test('actual native driver wires independent cases before volatile detail checks', async () => {
  const source = await readFile(DRIVER, 'utf8');
  const { ast, sequence } = inspectDriverSequence(source);
  const [controlled, dynamic] = sequence.arguments;
  const unfiltered =
    source.slice(0, sequence.arguments[2].getStart(ast)) +
    "'full'" +
    source.slice(sequence.arguments[2].end);
  assert.throws(() => inspectDriverSequence(unfiltered), /selected scope/);
  assert.throws(
    () => inspectDriverSequence(source.replace('process.env.SEO_GUEST_CASE_SCOPE ??', "'full' ??")),
    /reads scope with full default/,
  );
  const swapped =
    source.slice(0, controlled.getStart(ast)) +
    dynamic.getText(ast) +
    source.slice(controlled.end, dynamic.getStart(ast)) +
    controlled.getText(ast) +
    source.slice(dynamic.end);
  assert.throws(() => inspectDriverSequence(swapped), /controlled phase/);

  const bypassed = `${source.slice(0, sequence.parent.parent.getStart(ast))}await Promise.resolve();${source.slice(sequence.parent.parent.end)}`;
  assert.throws(
    () => inspectDriverSequence(bypassed),
    /native panel runs the sequence exactly once/,
  );

  const skippedSequence = `${source.slice(0, sequence.parent.parent.getStart(ast))}return;\n${source.slice(sequence.parent.parent.getStart(ast))}`;
  assert.throws(() => inspectDriverSequence(skippedSequence), /sequence is reachable/);

  const skippedControlled = `${source.slice(0, controlled.body.statements[0].getStart(ast))}return;\n${source.slice(controlled.body.statements[0].getStart(ast))}`;
  assert.throws(() => inspectDriverSequence(skippedControlled), /controlled phase is reachable/);

  const recapture = callsNamed(controlled, 'runCopyCheckThenRecapture')[0].arguments[1];
  assert.ok(ts.isArrowFunction(recapture) && ts.isBlock(recapture.body));
  const skippedRecapture = `${source.slice(0, recapture.body.statements[0].getStart(ast))}return;\n${source.slice(recapture.body.statements[0].getStart(ast))}`;
  assert.throws(() => inspectDriverSequence(skippedRecapture), /controlled phase is reachable/);
});
