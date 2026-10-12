import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import { jsx } from 'react/jsx-runtime';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import wxtConfig from '../../wxt.config';

const require = createRequire(import.meta.url);
const modulePath = path.join(
  path.dirname(require.resolve('tldraw')),
  '../dist-esm/lib/shapes/embed/EmbedShapeUtil.mjs',
);
const upstream = readFileSync(modulePath, 'utf8');

async function transformAnnotationEmbed(source = upstream) {
  if (typeof wxtConfig.vite !== 'function') throw new Error('Missing extension Vite configuration');
  const config = await wxtConfig.vite({} as never);
  // These two hooks are our integration boundary: use the real extension configuration.
  const plugin = config.plugins?.find(
    (entry) =>
      entry && typeof entry === 'object' && 'name' in entry && entry.name === 'tldraw-gist-link',
  );
  if (!plugin || typeof plugin !== 'object' || !('transform' in plugin)) {
    throw new Error('Annotation embed transform is not wired into the extension');
  }
  const hook = plugin.transform;
  if (typeof hook !== 'function') throw new Error('Missing annotation embed transform');
  const result = await Reflect.apply(hook, {}, [source, modulePath]);
  return typeof result === 'string' ? result : (result?.code ?? source);
}

function gistRenderer(source: string) {
  const module = ts.createSourceFile(
    'EmbedShapeUtil.mjs',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const gist = module.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === 'Gist',
  );
  if (!gist) throw new Error('Installed tldraw Gist renderer was not measured');
  // Execute the actual transformed renderer. Only unrelated geometry helpers are dependencies.
  return runInNewContext(`(${gist.getText(module)})`, {
    jsx,
    toDomPrecision: (value: number) => value,
    getRotatedBoxShadow: () => '',
  });
}

function assertGistLink(html: string, id: string) {
  expect(html).not.toMatch(/<iframe|<script|srcdoc=/i);
  expect(html).toContain(`href="https://gist.github.com/${id}"`);
  expect(html).toContain('Open Gist on GitHub');
  expect(html).toContain('target="_blank"');
}

describe('annotation Gist embeds', () => {
  // Break: upstream Gist srcDoc executes a remote .js file after paste or snapshot restore.
  it.each(['aa11bb22cc33', 'dd44ee55ff66'])(
    'renders %s as a usable external link without executable HTML',
    async (id) => {
      const source = await transformAnnotationEmbed();
      const render = gistRenderer(source);
      const html = renderToStaticMarkup(
        render({ id, width: 420, height: 240, isInteractive: true, pageRotation: 0 }),
      );
      assertGistLink(html, id);
      expect(html).toContain('width:420px;height:240px');
      expect(source).not.toMatch(/<script|srcDoc\s*:/);
    },
  );

  it('measures the original remote script failure rather than a synthetic fixture', () => {
    const html = renderToStaticMarkup(
      gistRenderer(upstream)({
        id: 'aa11bb22cc33',
        width: 420,
        height: 240,
        isInteractive: true,
        pageRotation: 0,
      }),
    );
    expect(html).toContain('srcDoc=');
    expect(html).toContain('https://gist.github.com/aa11bb22cc33.js');
  });
  it('refuses an upstream upgrade that removes the recognized Gist renderer', async () => {
    await expect(
      transformAnnotationEmbed(upstream.replace('function Gist(', 'function GistPreview(')),
    ).rejects.toThrow('tldraw Gist renderer changed');
  });

  it('rejects literal inline HTML outside the replaced Gist renderer', async () => {
    await expect(
      transformAnnotationEmbed(
        `${upstream}\nconst anotherEmbed = { srcDoc: '<script src="https://gist.github.com/aa11bb22cc33.js"></script>' };`,
      ),
    ).rejects.toThrow('additional literal inline HTML');
  });

  it('rejects an upstream renderer bypass and a constant-link renderer in memory', async () => {
    const props = {
      id: 'aa11bb22cc33',
      width: 420,
      height: 240,
      isInteractive: true,
      pageRotation: 0,
    };
    const unsafeHtml = renderToStaticMarkup(gistRenderer(upstream)(props));
    expect(() => assertGistLink(unsafeHtml, props.id)).toThrow();
    const source = await transformAnnotationEmbed();
    const renderer = gistRenderer(source);
    // Gut check: replacing the renderer with its expected result for the first
    // input must fail the second real Gist URL; no shared files are weakened.
    const constantResult = renderer(props);
    const constantRenderer = () => constantResult;
    expect(() =>
      assertGistLink(renderToStaticMarkup(constantRenderer()), 'dd44ee55ff66'),
    ).toThrow();
  });
});
