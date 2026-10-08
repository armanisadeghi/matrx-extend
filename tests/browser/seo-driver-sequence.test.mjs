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

// Inspect the callback the native harness actually executes. The guard is
// derived from calls that perform the cases, rather than a line or text order.
function inspectDriverSequence(source) {
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
  assert.equal(sequence.arguments.length, 2, 'controlled and detail phases are both present');
  const [controlled, dynamic] = sequence.arguments;
  assert.ok(ts.isArrowFunction(controlled), 'first phase is an executable callback');
  assert.ok(ts.isArrowFunction(dynamic), 'second phase is an executable callback');

  assert.equal(
    callsNamed(controlled, 'runCopyCheckThenRecapture').length,
    1,
    'controlled phase exercises social copy and recapture',
  );
  assert.equal(callsNamed(controlled, 'copySocialTags').length, 2, 'both social copy states run');
  assert.ok(
    callsNamed(controlled, 'target').some(
      (call) =>
        literal(call, 0) === 'T02' &&
        literal(call, 1) === 'guest_reaudit_captures_changed_page_metadata',
    ),
    'controlled phase records the changed-metadata result',
  );
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
  return { ast, sequence };
}

test('actual native driver wires independent cases before volatile detail checks', async () => {
  const source = await readFile(DRIVER, 'utf8');
  const { ast, sequence } = inspectDriverSequence(source);
  const [controlled, dynamic] = sequence.arguments;
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
});
