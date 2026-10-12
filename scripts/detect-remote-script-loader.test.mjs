import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { containsScriptSrcLoader } from './detect-remote-script-loader.mjs';

test('flags the rejected branch with every legal minified identifier shape', () => {
  // Alpha-renaming the captured jsPDF script handle changes no executable behavior.
  // Minifiers may emit $ both at the start and within an identifier.
  const rejected =
    'var i=`https://cdnjs.cloudflare.com/ajax/libs/pdfobject/2.1.1/pdfobject.min.js`,s=Ct(o),c=s.document.createElement(`script`),l=this;c.src=i,c.onload=function(){o.PDFObject.embed(l.output(`dataurlstring`),t)},s.body.appendChild(c)';
  for (const identifier of ['c', '$', '$c', 'c$', '_c']) {
    const emitted = rejected.replace(/\bc\b/g, () => identifier);
    assert.equal(containsScriptSrcLoader(emitted), true, `missed script handle ${identifier}`);
  }
});

test('flags the jsPDF PDFObject branch after minification', () => {
  // Captured from the rejected Store chunk `jspdf.es.min-MShcGOQj.js`.
  const rejected =
    'var i=`https://cdnjs.cloudflare.com/ajax/libs/pdfobject/2.1.1/pdfobject.min.js`,s=Ct(o),c=s.document.createElement(`script`),l=this;c.src=i,c.onload=function(){o.PDFObject.embed(l.output(`dataurlstring`),t)},s.body.appendChild(c)';
  assert.equal(containsScriptSrcLoader(rejected), true);
});

test('allows PDF Blob generation and a non-executable script element', () => {
  assert.equal(containsScriptSrcLoader('case"blob":return getBlob(buildDocument())'), false);
  assert.equal(
    containsScriptSrcLoader(
      'const script=document.createElement("script");script.textContent="note";document.body.appendChild(script)',
    ),
    false,
  );
  // React DOM's bundled script handling does not directly assign src here.
  assert.equal(
    containsScriptSrcLoader(
      'a=n.createElement(`script`),E(a),np(a,`link`,e),n.head.appendChild(a);other.src=url',
    ),
    false,
  );
  assert.equal(
    containsScriptSrcLoader(
      'c=document.createElement(`script`);$c.src=url;document.body.appendChild(c)',
    ),
    false,
  );
});

test('the Store emitted-code gate refuses the rejected loader when its script handle is $', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'd0204-script-loader-'));
  const baselinePath = fileURLToPath(
    new URL('../config/chrome-web-store-approved-baseline.json', import.meta.url),
  );
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  try {
    mkdirSync(path.join(directory, 'config'));
    mkdirSync(path.join(directory, '.output/chrome-mv3'), { recursive: true });
    writeFileSync(
      path.join(directory, 'config/chrome-web-store-approved-baseline.json'),
      JSON.stringify(baseline),
    );
    writeFileSync(
      path.join(directory, '.output/chrome-mv3/manifest.json'),
      JSON.stringify(baseline.policySurface),
    );
    const chunk = path.join(directory, '.output/chrome-mv3/jspdf.js');
    const runGate = () =>
      spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./check-cws-release-risk.mjs', import.meta.url))],
        { cwd: directory, encoding: 'utf8' },
      );
    writeFileSync(chunk, 'case"blob":return getBlob(buildDocument())');
    const allowed = runGate();
    assert.equal(allowed.status, 0, allowed.stderr);
    writeFileSync(
      chunk,
      'var i=`https://cdnjs.cloudflare.com/ajax/libs/pdfobject/2.1.1/pdfobject.min.js`,s=Ct(o),$=s.document.createElement(`script`),l=this;$.src=i,$.onload=function(){o.PDFObject.embed(l.output(`dataurlstring`),t)},s.body.appendChild($)',
    );
    const rejected = runGate();
    assert.equal(rejected.status, 1);
    assert.match(
      rejected.stderr,
      /jspdf\.js creates an executable script element and assigns its src/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
