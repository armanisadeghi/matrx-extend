import { readFile } from 'node:fs/promises';
import path from 'node:path';

const outputDir = path.resolve('.output/chrome-mv3');
const manifestPath = path.join(outputDir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const failures = [];

if (manifest.key != null) {
  failures.push('Store manifest contains a development key');
}

if (manifest.action?.default_popup != null) {
  failures.push('Store action still has default_popup; the toolbar must open the side panel');
}

if (manifest.side_panel?.default_path !== 'sidepanel.html') {
  failures.push('Store manifest does not point side_panel.default_path at sidepanel.html');
}

if (!manifest.permissions?.includes('sidePanel')) {
  failures.push('Store manifest is missing the sidePanel permission');
}

if (failures.length > 0) {
  console.error('Chrome Web Store package validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  'Chrome Web Store package validation passed: no dev key or toolbar popup; side panel is canonical.',
);
