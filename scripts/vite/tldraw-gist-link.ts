import ts from 'typescript';

/**
 * tldraw 4.5's Gist renderer loads remote JavaScript through iframe srcDoc.
 * Replace that renderer at the dependency boundary for every extension build.
 * Keep the embed shape, URL, dimensions, and interaction behavior for paste and
 * saved snapshots. No dependency files are modified; upstream changes fail closed.
 */
export function tldrawGistLink() {
  return {
    name: 'tldraw-gist-link',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (
        !id.replaceAll('\\', '/').endsWith('/tldraw/dist-esm/lib/shapes/embed/EmbedShapeUtil.mjs')
      ) {
        return null;
      }
      const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const renderers = source.statements.filter(
        (statement): statement is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(statement) && statement.name?.text === 'Gist',
      );
      const renderer = renderers[0];
      if (
        renderers.length !== 1 ||
        !renderer?.body ||
        !renderer.getText(source).includes('srcDoc:') ||
        !renderer.getText(source).includes('https://gist.github.com/')
      ) {
        throw new Error(
          'tldraw Gist renderer changed; review its remote-code behavior before packaging.',
        );
      }
      const replacement = `{
        if (!/^[0-9a-f]+$/.test(id)) throw Error("No gist id!");
        return jsx("a", {
          className: "tl-embed",
          href: "https://gist.github.com/" + id,
          target: "_blank",
          rel: "noopener noreferrer",
          tabIndex: isInteractive ? 0 : -1,
          draggable: false,
          style: {
            ...style,
            width: toDomPrecision(width),
            height: toDomPrecision(height),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--tl-color-background)",
            color: "var(--tl-color-text)",
            borderRadius: 8,
            pointerEvents: isInteractive ? "all" : "none",
            boxShadow: getRotatedBoxShadow(pageRotation)
          },
          children: "Open Gist on GitHub"
        });
      }`;
      const transformed =
        code.slice(0, renderer.body.getStart(source)) + replacement + code.slice(renderer.body.end);
      if (/srcDoc\s*:|<script\b/i.test(transformed)) {
        throw new Error(
          'tldraw contains another executable HTML embed; review it before packaging.',
        );
      }
      return { code: transformed, map: null };
    },
  };
}
