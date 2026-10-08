import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const drivers = ['showcase-d47-public-initial-load.mjs', 'showcase-d47-document-lifecycle.mjs'];
const url = (name) => new URL(name, import.meta.url);

// A missing or swapped UUID in either real D47 checkpoint call must fail this census.
function assertHandoff(source, driver) {
  const tree = ts.createSourceFile(driver, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let approvedBinding = null;
  let approvedDeclaration = null;
  let fixtureImport = null;
  const checkpointCalls = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      for (const element of node.importClause?.namedBindings?.elements ?? []) {
        if (element.name.text === 'approvedShowcaseOrganization')
          fixtureImport = {
            source: node.moduleSpecifier.text,
            exportedName: element.propertyName?.text ?? element.name.text,
          };
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const initializer = node.initializer;
      if (
        initializer &&
        ts.isAwaitExpression(initializer) &&
        ts.isCallExpression(initializer.expression) &&
        ts.isIdentifier(initializer.expression.expression) &&
        initializer.expression.expression.text === 'approvedShowcaseOrganization'
      ) {
        approvedBinding = node.name.text;
        approvedDeclaration = node.getText(tree);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'runShowcaseOrganizationCheckpoint'
    )
      checkpointCalls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(fixtureImport, `${driver}: fixture reader import must resolve`);
  assert.ok(approvedBinding, `${driver}: approved private fixture identity must be loaded`);
  assert.equal(checkpointCalls.length, 1, `${driver}: census every actual checkpoint handoff`);
  const fields = checkpointCalls[0].arguments[0];
  assert.ok(
    ts.isObjectLiteralExpression(fields),
    `${driver}: checkpoint arguments must be explicit`,
  );
  for (const [field, member] of [
    ['requiredOrganizationName', 'name'],
    ['requiredOrganizationId', 'id'],
  ]) {
    const properties = fields.properties.filter(
      (property) => ts.isPropertyAssignment(property) && property.name.getText(tree) === field,
    );
    assert.equal(properties.length, 1, `${driver}: ${field} must reach checkpoint once`);
    const value = properties[0].initializer;
    assert.ok(
      ts.isPropertyAccessExpression(value) &&
        ts.isIdentifier(value.expression) &&
        value.expression.text === approvedBinding &&
        value.name.text === member,
      `${driver}: ${field} must come from the approved private fixture ${member}`,
    );
  }
  return { approvedDeclaration, checkpointCall: checkpointCalls[0].getText(tree), fixtureImport };
}

async function runCallerHandoff(handoff, driver, file, id, name) {
  const imported = await import(new URL(handoff.fixtureImport.source, url(driver)));
  const reader = imported[handoff.fixtureImport.exportedName];
  assert.equal(typeof reader, 'function', `${driver}: fixture reader import must resolve`);
  const run = new (async () => {}).constructor(
    'approvedShowcaseOrganization',
    'runShowcaseOrganizationCheckpoint',
    'panel',
    'auth',
    'resourceAction',
    'report',
    'process',
    `${handoff.approvedDeclaration}; return ${handoff.checkpointCall};`,
  );
  let observed;
  const panel = {};
  const auth = {};
  const report = {};
  const resourceAction = () => {};
  await run(
    reader,
    (args) => {
      observed = args;
    },
    panel,
    auth,
    resourceAction,
    report,
    { env: { MATRX_APPROVED_ADMIN_ORGANIZATION_FILE: file } },
  );
  assert.deepEqual(
    observed,
    {
      panel,
      auth,
      resourceAction,
      report,
      requiredOrganizationName: name,
      requiredOrganizationId: id,
    },
    `${driver}: approved identity must survive the real handoff`,
  );
}

test('every D47 entrypoint passes the approved private name and UUID to the real checkpoint', async () => {
  for (const driver of drivers) assertHandoff(await readFile(url(driver), 'utf8'), driver);
});

test('D47 handoff guard rejects a missing or exchanged UUID in each caller', async () => {
  for (const driver of drivers) {
    const source = await readFile(url(driver), 'utf8');
    assert.throws(
      () =>
        assertHandoff(
          source.replace(/requiredOrganizationId: approvedOrganization\.id,/, ''),
          driver,
        ),
      /requiredOrganizationId must reach checkpoint once/,
    );
    assert.throws(
      () =>
        assertHandoff(
          source.replace(
            /requiredOrganizationId: approvedOrganization\.id,/,
            'requiredOrganizationId: approvedOrganization.name,',
          ),
          driver,
        ),
      /requiredOrganizationId must come from the approved private fixture id/,
    );
  }
});

test('D47 handoff guard rejects a removed or wrong production fixture import', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'd47-org-import-sabotage-'));
  const id = '7af9b2d1-36e8-4f51-9d72-5e0a193deaf2';
  const name = 'Harbor Dental';
  const file = join(directory, 'approved.json');
  await writeFile(
    file,
    JSON.stringify({ approved_organization_id: id, approved_organization_name: name }),
    { mode: 0o600 },
  );
  try {
    for (const driver of drivers) {
      const source = await readFile(url(driver), 'utf8');
      assert.throws(
        () =>
          assertHandoff(
            source.replace('approvedShowcaseOrganization, signInSettings', 'signInSettings'),
            driver,
          ),
        /fixture reader import must resolve/,
      );
      const wrongBinding = assertHandoff(
        source.replace(
          'approvedShowcaseOrganization, signInSettings',
          'approvedAdminOrganizationName as approvedShowcaseOrganization, signInSettings',
        ),
        driver,
      );
      await assert.rejects(
        runCallerHandoff(wrongBinding, driver, file, id, name),
        /approved identity must survive the real handoff/,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('both real D47 caller expressions carry distinct private identities into the checkpoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'd47-org-handoff-'));
  try {
    const pairs = [
      ['7af9b2d1-36e8-4f51-9d72-5e0a193deaf2', 'Harbor Dental'],
      ['98f3c4be-e21a-41a9-a6ce-96e6bc17b830', 'Cedar Recycling'],
    ];
    for (const driver of drivers) {
      const handoff = assertHandoff(await readFile(url(driver), 'utf8'), driver);
      for (const [id, name] of pairs) {
        const file = join(directory, `${id}.json`);
        await writeFile(
          file,
          JSON.stringify({ approved_organization_id: id, approved_organization_name: name }),
          { mode: 0o600 },
        );
        await runCallerHandoff(handoff, driver, file, id, name);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
