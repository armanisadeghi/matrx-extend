import assert from 'node:assert/strict';
import { test } from 'node:test';
import { containsScriptSrcLoader } from './detect-remote-script-loader.mjs';

test('flags the jsPDF PDFObject branch after minification', () => {
  // Captured from the rejected Store chunk `jspdf.es.min-MShcGOQj.js`.
  const rejected = 'var i=`https://cdnjs.cloudflare.com/ajax/libs/pdfobject/2.1.1/pdfobject.min.js`,s=Ct(o),c=s.document.createElement(`script`),l=this;c.src=i,c.onload=function(){o.PDFObject.embed(l.output(`dataurlstring`),t)},s.body.appendChild(c)';
  assert.equal(containsScriptSrcLoader(rejected), true);
});

test('allows PDF Blob generation and a non-executable script element', () => {
  assert.equal(containsScriptSrcLoader('case"blob":return getBlob(buildDocument())'), false);
  assert.equal(containsScriptSrcLoader('const script=document.createElement("script");script.textContent="note";document.body.appendChild(script)'), false);
  // React DOM's bundled script handling does not directly assign src here.
  assert.equal(containsScriptSrcLoader('a=n.createElement(`script`),E(a),np(a,`link`,e),n.head.appendChild(a);other.src=url'), false);
});
