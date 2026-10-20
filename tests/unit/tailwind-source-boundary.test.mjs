import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

// Changing the CSS source root back to automatic repo scanning must admit the
// planted docs/test classes and fail this test. Exercise Tailwind's own CSS
// compiler metadata and the same Oxide scanner configuration used by Vite.
const requireFromTailwindVite = createRequire(import.meta.resolve('@tailwindcss/vite'));
const { compile } = await import(requireFromTailwindVite.resolve('@tailwindcss/node'));
const { Scanner } = await import(requireFromTailwindVite.resolve('@tailwindcss/oxide'));
const repo = resolve(import.meta.dirname, '../..');
const stylesheet = join(repo, 'src/styles/globals.css');

test('Tailwind scans app and shared-package classes but excludes diagnostic and test sources', async () => {
  const dirs = [
    mkdtempSync(join(repo, 'docs/tailwind-source-probe-')),
    mkdtempSync(join(repo, 'tests/browser/tailwind-source-probe-')),
    mkdtempSync(join(repo, 'src/components/tailwind-source-probe-')),
    mkdtempSync(join(repo, 'src/entrypoints/sidepanel/tailwind-source-probe-')),
  ];
  try {
    const probes = [
      ['docs', join(dirs[0], 'report.md'), 'z-[991101px]', false],
      ['browser test', join(dirs[1], 'acceptance.mjs'), 'z-[991102px]', false],
      ['colocated unit test', join(dirs[2], 'component.test.tsx'), 'z-[991103px]', false],
      ['app component', join(dirs[2], 'component.tsx'), 'z-[991104px]', true],
      ['WXT HTML entrypoint', join(dirs[3], 'index.html'), 'z-[991105px]', true],
      ['source documentation', join(dirs[2], 'report.md'), 'z-[991106px]', false],
      ['source fixture', join(dirs[2], 'component.fixture.tsx'), 'z-[991107px]', false],
    ];
    for (const [, file, className] of probes) {
      writeFileSync(file, `<div class="${className}"></div>\n`);
    }

    const compiled = await compile(readFileSync(stylesheet, 'utf8'), {
      base: dirname(stylesheet),
      from: stylesheet,
      onDependency() {},
    });
    const sources = (
      compiled.root === 'none'
        ? []
        : compiled.root === null
          ? [{ base: repo, pattern: '**/*', negated: false }]
          : [{ ...compiled.root, negated: false }]
    ).concat(compiled.sources);
    const scanner = new Scanner({ sources });
    const candidates = new Set(scanner.scan());
    for (const [label, , className, admitted] of probes) {
      assert.equal(candidates.has(className), admitted, `${label}: ${className}`);
    }

    // This utility occurs in the installed agents catalog JS, not app source.
    assert.equal(candidates.has('active:bg-muted/70'), true, 'shared agents catalog class');
    assert.equal(
      scanner.files.some((file) => file.includes('/@ai-matrx/agents/dist/catalog/react/index.cjs')),
      true,
      'shared agents catalog source',
    );
    assert.equal(candidates.has('disabled:opacity-60'), true, 'transitive records UI class');
    assert.equal(
      scanner.files.some((file) => file.includes('/@ai-matrx/records-ui/dist/')),
      true,
      'transitive records UI source',
    );
  } finally {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  }
});
