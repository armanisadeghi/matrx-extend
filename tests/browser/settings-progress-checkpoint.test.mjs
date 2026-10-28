import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const source = readFileSync(
  new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
  'utf8',
);
const atomic = new URL('./atomic-json-report.mjs', import.meta.url).href;
const scrape = new URL('./scrape-save-auth-report.mjs', import.meta.url).href;
const fixture = new URL('./settings-scrape-mode-baseline.mjs', import.meta.url).href;

// The real callback and case producer must persist before the process can be killed.
test('native and case checkpoints survive ordinary SIGTERM without final verdicts', async () => {
  const start = source.indexOf('let publicationFailure;');
  const end = source.indexOf('\nlet observedPort;', start);
  assert.ok(start >= 0 && end > start, 'actual checkpoint and runCase producer exists');
  const callback = source.match(
    /onStage:\s*(\(stage\)\s*=>\s*checkpoint\('native_stage', stage\))/,
  )?.[1];
  assert.ok(callback, 'actual native callback is wired');
  const dir = mkdtempSync(join(tmpdir(), 'settings-progress-'));
  try {
    const script = join(dir, 'child.mjs');
    writeFileSync(
      script,
      `import { settingsFixtureIntegrityFailure } from ${JSON.stringify(fixture)};
import { publishAtomicJsonReport } from ${JSON.stringify(atomic)};
import { NATIVE_STAGES } from ${JSON.stringify(scrape)};
const OUTPUT = ${JSON.stringify(join(dir, 'report.json'))};
const CASE_IDS = ['EXT-F-1003-T04','EXT-F-1003-T10'];
const report = { cases: CASE_IDS.map(id => ({ id, status:'unverified', criteria:[] })) };
const criterion = (c, name, status, evidence) => c.criteria.push({name,status,evidence});
${source.slice(start, end)}
const onStage = ${callback};
onStage(process.argv[2]);
if (process.argv[4] === 'native') { process.stdout.write('parked\\n'); setInterval(() => {}, 1000); await new Promise(() => {}); }
await runCase(report.cases[Number(process.argv[3])], async () => { if (process.argv[4] === 'inside') { process.stdout.write('parked\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); } report.cases[Number(process.argv[3])].criteria.push({status:'pass'}); });
process.stdout.write('parked\\n');
setInterval(() => {}, 1000);
`,
    );
    for (const [stage, index, expected, boundary] of [
      ['panel_context', '0', 'panel_context', 'native'],
      ['exercise_panel', '1', 'exercise_panel', 'native'],
      ['panel_context', '0', 'EXT-F-1003-T04', 'inside'],
      ['exercise_panel', '1', 'EXT-F-1003-T10', 'inside'],
      ['panel_context', '0', 'EXT-F-1003-T04', 'case'],
      ['exercise_panel', '1', 'EXT-F-1003-T10', 'case'],
    ]) {
      const child = spawn(process.execPath, [script, stage, index, boundary], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const [chunk] = await once(child.stdout, 'data');
      assert.match(String(chunk), /parked/);
      child.kill('SIGTERM');
      const [, signal] = await once(child, 'exit');
      assert.equal(signal, 'SIGTERM');
      const saved = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
      assert.equal(
        saved.diagnostic_progress.kind,
        boundary === 'native' ? 'native_stage' : boundary === 'inside' ? 'case_start' : 'case_end',
      );
      assert.equal(saved.diagnostic_progress.label, expected);
      assert.equal(
        saved.diagnostic_progress.sequence,
        boundary === 'native' ? 1 : boundary === 'inside' ? 2 : 3,
      );
      assert.equal(saved.status, 'unverified');
      assert.equal(saved.terminal, false);
      assert.ok(saved.cases.every((item) => item.status === 'unverified'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('failed publication blocks the operation and does not advance memory', async () => {
  const start = source.indexOf('let publicationFailure;');
  const end = source.indexOf('\nlet observedPort;', start);
  assert.ok(start >= 0 && end > start);
  const dir = mkdtempSync(join(tmpdir(), 'settings-progress-failure-'));
  try {
    const script = join(dir, 'child.mjs');
    writeFileSync(
      script,
      `import { settingsFixtureIntegrityFailure } from ${JSON.stringify(fixture)};
import { publishAtomicJsonReport } from ${JSON.stringify(atomic)};
import { NATIVE_STAGES } from ${JSON.stringify(scrape)};
const OUTPUT = ${JSON.stringify(dir)};
const CASE_IDS = ['EXT-F-1003-T04'];
const report = { cases: [{ id: CASE_IDS[0], status:'unverified', criteria:[] }] };
const criterion = () => {};
${source.slice(start, end)}
let ran = false;
try { await runCase(report.cases[0], async () => { ran = true; }); } catch {}
try { await runCase(report.cases[0], async () => { ran = true; }); } catch {}
if (ran || report.diagnostic_progress !== undefined || !publicationFailure) process.exitCode = 1;
`,
    );
    const child = spawn(process.execPath, [script], { stdio: 'pipe' });
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('actual outer cleanup and sticky publication errors preserve the prior checkpoint', async () => {
  const start = source.indexOf('let publicationFailure;');
  const end = source.indexOf('\nlet observedPort;', start);
  const outer = source.indexOf(
    '} catch (error) {\n  const fixtureFailure = settingsFixtureIntegrityFailure(error);',
    end,
  );
  assert.ok(start >= 0 && end > start && outer > end);
  const dir = mkdtempSync(join(tmpdir(), 'settings-final-errors-'));
  try {
    for (const mode of ['cleanup', 'recovered', 'final_write']) {
      const output = join(dir, `${mode}.json`);
      const script = join(dir, `${mode}.mjs`);
      writeFileSync(
        script,
        `import { settingsFixtureIntegrityFailure } from ${JSON.stringify(fixture)};
import { publishAtomicJsonReport as actual } from ${JSON.stringify(atomic)};
import { NATIVE_STAGES } from ${JSON.stringify(scrape)};
const OUTPUT = ${JSON.stringify(output)};
const CASE_IDS = ['EXT-F-1003-T04'];
const report = { cases: [{ id: CASE_IDS[0], status:'pass', criteria:[{status:'pass'}] }], build:{verified:true}, preconditions:[] };
const criterion = (c,name,status,evidence) => c.criteria.push({name,status,evidence});
let fail = false;
const publishAtomicJsonReport = (...args) => { if (fail) throw Error('io_failure'); actual(...args); };
const THEME_RENDERING_PROBE = true, RELOAD_SENDER_DOCUMENT_DIAGNOSTIC = false, RELOAD_OPEN_DIAGNOSTIC = false;
const enforceFullExtensionRechecks = () => {};
const finalizeSettingsSenderDocumentDiagnostic = () => false;
const observedPort = { close: async () => { if (${JSON.stringify(mode)} === 'cleanup') throw Error('cleanup_failure'); } };
${source.slice(start, end)}
checkpoint('native_stage','panel_context');
try {
 if (${JSON.stringify(mode)} === 'recovered') { try { await runCase(report.cases[0], async () => { fail = true; try { checkpoint('native_stage','panel_settle'); } finally { fail = false; } }); } finally { fail = false; } }
 if (${JSON.stringify(mode)} === 'final_write') fail = true;
${source.slice(outer)}
`,
      );
      const child = spawn(process.execPath, [script], { stdio: 'pipe' });
      const [code] = await once(child, 'exit');
      assert.notEqual(code, 0);
      const saved = JSON.parse(readFileSync(output, 'utf8'));
      assert.equal(
        saved.diagnostic_progress.label,
        mode === 'recovered' ? 'EXT-F-1003-T04' : 'panel_context',
      );
      assert.equal(saved.status, 'unverified');
      assert.equal(saved.terminal, false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scratch mutants cannot fake a durable pre-operation nonfinal checkpoint', async () => {
  const start = source.indexOf('let publicationFailure;');
  const end = source.indexOf('\nlet observedPort;', start);
  const original = source.slice(start, end);
  const dir = mkdtempSync(join(tmpdir(), 'settings-mutants-'));
  try {
    for (const mutant of [
      'dropped_callback',
      'dropped_case',
      'premature_pass',
      'swallowed_failure',
    ]) {
      let body = original;
      if (mutant === 'dropped_case') body = body.replace("checkpoint('case_start', c.id);", '');
      if (mutant === 'premature_pass')
        body = body.replace(
          /status: 'unverified',\s*terminal: false/,
          "status: 'pass', terminal: true",
        );
      if (mutant === 'swallowed_failure')
        body = body.replaceAll('if (publicationFailure) throw publicationFailure;', '');
      if (mutant !== 'dropped_callback')
        assert.notEqual(body, original, `${mutant} must change actual source`);
      const output = join(dir, `${mutant}.json`);
      const script = join(dir, `${mutant}.mjs`);
      writeFileSync(
        script,
        `import { settingsFixtureIntegrityFailure } from ${JSON.stringify(fixture)};
import { publishAtomicJsonReport as actual } from ${JSON.stringify(atomic)};
import { NATIVE_STAGES } from ${JSON.stringify(scrape)};
import { writeFileSync } from 'node:fs';
const OUTPUT = ${JSON.stringify(output)};
const CASE_IDS = ['EXT-F-1003-T04'];
const report = { cases: [{id: CASE_IDS[0], status:'pass', criteria:[{status:'pass'}]}] };
const criterion = (c,name,status,evidence) => c.criteria.push({name,status,evidence});
let fail = false;
const publishAtomicJsonReport = (...args) => { if (fail) throw Error('io_failure'); actual(...args); };
${body}
if (${JSON.stringify(mutant)} !== 'dropped_callback') checkpoint('native_stage','panel_context');
if (${JSON.stringify(mutant)} === 'swallowed_failure') {
 try { await runCase(report.cases[0], async () => { fail = true; try { checkpoint('native_stage','panel_settle'); } finally { fail = false; } }); } catch {}
 await runCase(report.cases[0], async () => { writeFileSync(${JSON.stringify(join(dir, 'next-operation'))}, 'ran'); });
}
await runCase(report.cases[0], async () => { process.stdout.write('parked\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); });
`,
      );
      const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
      await once(child.stdout, 'data');
      child.kill('SIGTERM');
      await once(child, 'exit');
      let saved;
      try {
        saved = JSON.parse(readFileSync(output, 'utf8'));
      } catch {}
      const caught =
        mutant === 'dropped_callback'
          ? saved?.diagnostic_progress.sequence !== 2
          : mutant === 'dropped_case'
            ? saved?.diagnostic_progress.kind !== 'case_start'
            : mutant === 'premature_pass'
              ? saved?.status !== 'unverified' || saved?.terminal !== false
              : (() => {
                  try {
                    readFileSync(join(dir, 'next-operation'));
                    return true;
                  } catch {
                    return false;
                  }
                })();
      assert.equal(caught, true, `${mutant} survived its forcing check`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Break: replacing the actual final publish with a truncating writer destroys the prior checkpoint.
test('actual PASS-eligible final producer preserves exact checkpoint bytes across SIGTERM', async () => {
  const start = source.indexOf('let publicationFailure;');
  const end = source.indexOf('\nlet observedPort;', start);
  const outer = source.indexOf(
    '} catch (error) {\n  const fixtureFailure = settingsFixtureIntegrityFailure(error);',
    end,
  );
  assert.ok(start >= 0 && end > start && outer > end);
  const finalCall = '  publishAtomicJsonReport(report, OUTPUT);';
  const finalProducer = source.slice(outer);
  assert.equal(finalProducer.split(finalCall).length, 2, 'one actual final publication seam');
  const atomicSource = readFileSync(new URL('./atomic-json-report.mjs', import.meta.url), 'utf8');
  const rename = '    renameSync(temporary, destination);';
  assert.equal(atomicSource.split(rename).length, 2, 'one rename after actual fsync and close');
  const park =
    "process.stdout.write('parked\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);";
  const dir = mkdtempSync(join(tmpdir(), 'settings-final-interruption-'));
  try {
    for (const mode of ['complete', 'atomic', 'destructive']) {
      const output = join(dir, `${mode}.json`);
      const previous = join(dir, `${mode}.previous`);
      const cleanup = join(dir, `${mode}.cleanup`);
      const helper = join(dir, `${mode}-atomic.mjs`);
      // Only the scratch helper parks, after the real temp file has been fsynced and closed.
      writeFileSync(
        helper,
        atomicSource.replace(
          rename,
          `    if (report.terminal === true && ${JSON.stringify(mode)} === 'atomic') { ${park} }\n${rename}`,
        ),
      );
      const producer =
        mode === 'destructive'
          ? finalProducer.replace(finalCall, `  writeFileSync(OUTPUT, '{'); ${park}`)
          : finalProducer;
      const script = join(dir, `${mode}.mjs`);
      writeFileSync(
        script,
        `import { settingsFixtureIntegrityFailure } from ${JSON.stringify(fixture)};
import { publishAtomicJsonReport } from ${JSON.stringify(helper)};
import { NATIVE_STAGES } from ${JSON.stringify(scrape)};
import { readFileSync, writeFileSync } from 'node:fs';
const OUTPUT = ${JSON.stringify(output)}, CASE_IDS = ['EXT-F-1003-T04'];
const report = { cases: [{ id: CASE_IDS[0], status: 'pass', criteria: [{status:'pass'}] }], build: {verified:true}, preconditions: [] };
const criterion = (c,name,status,evidence) => c.criteria.push({name,status,evidence});
const THEME_RENDERING_PROBE = true, RELOAD_SENDER_DOCUMENT_DIAGNOSTIC = false, RELOAD_OPEN_DIAGNOSTIC = false;
const enforceFullExtensionRechecks = () => {};
const finalizeSettingsSenderDocumentDiagnostic = () => false;
const observedPort = { close: async () => { writeFileSync(${JSON.stringify(cleanup)}, 'closed'); } };
${source.slice(start, end)}
checkpoint('native_stage', 'panel_context');
writeFileSync(${JSON.stringify(previous)}, readFileSync(OUTPUT));
try {
${producer}
`,
      );
      const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
      if (mode === 'complete') {
        const [code, signal] = await once(child, 'exit');
        assert.equal(code, 0);
        assert.equal(signal, null);
        const final = JSON.parse(readFileSync(output, 'utf8'));
        assert.equal(final.status, 'pass');
        assert.equal(final.terminal, true);
        assert.equal(final.build.verified, true);
        assert.ok(final.cases.every((item) => item.status === 'pass'));
      } else {
        const [chunk] = await once(child.stdout, 'data');
        assert.equal(String(chunk), 'parked\n');
        assert.equal(readFileSync(cleanup, 'utf8'), 'closed');
        child.kill('SIGTERM');
        const [code, signal] = await once(child, 'exit');
        assert.equal(code, null);
        assert.equal(signal, 'SIGTERM');
        const prior = readFileSync(previous);
        const saved = JSON.parse(prior);
        assert.equal(saved.status, 'unverified');
        assert.equal(saved.terminal, false);
        assert.equal(saved.diagnostic_progress.label, 'panel_context');
        assert.ok(saved.cases.every((item) => item.status === 'unverified'));
        const preservationOracle = () => assert.deepEqual(readFileSync(output), prior);
        if (mode === 'atomic') preservationOracle();
        else
          assert.throws(
            preservationOracle,
            { code: 'ERR_ASSERTION' },
            'same byte oracle kills actual-final destructive mutant',
          );
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('current-source checkpoint-erasure mutant loses progress on SIGTERM', async () => {
  const start = source.indexOf('async function runCase(c, fn) {');
  const end = source.indexOf('\nlet observedPort;', start);
  const outer = source.indexOf(
    '} catch (error) {\n  const fixtureFailure = settingsFixtureIntegrityFailure(error);',
    end,
  );
  assert.ok(start >= 0 && end > start && outer > end);
  const actual = source.slice(start, end);
  assert.equal(actual.split("  checkpoint('case_start', c.id);").length, 2);
  assert.equal(actual.split("  checkpoint('case_end', c.id);").length, 2);
  const withoutCheckpoints = actual
    .replace("  checkpoint('case_start', c.id);", '')
    .replace("  checkpoint('case_end', c.id);", '');
  assert.notEqual(withoutCheckpoints, actual);
  const dir = mkdtempSync(join(tmpdir(), 'settings-erased-producer-'));
  try {
    const script = join(dir, 'erased.mjs');
    writeFileSync(
      script,
      `import { settingsFixtureIntegrityFailure } from ${JSON.stringify(fixture)};
import { publishAtomicJsonReport } from ${JSON.stringify(atomic)};
import { join } from 'node:path';
const REPO = ${JSON.stringify(dir)}, OUTPUT = join(REPO, 'test-results', 'settings-local-controls-acceptance.json');
const publicationFailure = undefined;
const report = { cases: [{id:'EXT-F-1003-T04', criteria:[], status:'unverified'}], build:{}, preconditions:[] };
const criterion = (c,name,status,evidence) => c.criteria.push({name,status,evidence});
const observedPort = undefined, THEME_RENDERING_PROBE = true, RELOAD_SENDER_DOCUMENT_DIAGNOSTIC = false, RELOAD_OPEN_DIAGNOSTIC = false;
const enforceFullExtensionRechecks = () => {}, finalizeSettingsSenderDocumentDiagnostic = () => false;
${withoutCheckpoints}
try { await runCase(report.cases[0], async () => { process.stdout.write('parked\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); });
${source.slice(outer)}
`,
    );
    const child = spawn(process.execPath, [script], { stdio: 'pipe' });
    await once(child.stdout, 'data');
    child.kill('SIGTERM');
    const [, signal] = await once(child, 'exit');
    assert.equal(signal, 'SIGTERM');
    assert.throws(
      () => readFileSync(join(dir, 'test-results', 'settings-local-controls-acceptance.json')),
      { code: 'ENOENT' },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown stage and case labels refuse private canaries without publication', async () => {
  const start = source.indexOf('let publicationFailure;');
  const end = source.indexOf('\nlet observedPort;', start);
  const dir = mkdtempSync(join(tmpdir(), 'settings-invalid-labels-'));
  try {
    const script = join(dir, 'invalid.mjs');
    const output = join(dir, 'report.json');
    writeFileSync(
      script,
      `import { settingsFixtureIntegrityFailure } from ${JSON.stringify(fixture)};
import { publishAtomicJsonReport } from ${JSON.stringify(atomic)};
import { NATIVE_STAGES } from ${JSON.stringify(scrape)};
const OUTPUT = ${JSON.stringify(output)}, CASE_IDS = ['EXT-F-1003-T04'];
const report = {cases:[{id:CASE_IDS[0],status:'pass',criteria:[]}]};
const criterion = () => {};
${source.slice(start, end)}
checkpoint('native_stage','panel_context');
for (const [kind,value] of [['native_stage','private-stage-canary'], ['case_start','private-case-canary']]) {
  try { checkpoint(kind,value); process.exitCode = 1; } catch {}
}
`,
    );
    const child = spawn(process.execPath, [script], { stdio: 'pipe' });
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
    const raw = readFileSync(output, 'utf8');
    assert.equal(raw.includes('private-'), false);
    assert.equal(JSON.parse(raw).diagnostic_progress.label, 'panel_context');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
