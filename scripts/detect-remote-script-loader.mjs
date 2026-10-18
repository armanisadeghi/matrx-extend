/** Detect executable script injection in emitted extension JavaScript. */
export function containsScriptSrcLoader(source) {
  for (const match of source.matchAll(
    /(?<![\w$])([A-Za-z_$][\w$]*)\s*=\s*(?:[A-Za-z_$][\w$]*\.)*createElement\(\s*(["'`])script\2\s*\)/g,
  )) {
    // $ is a valid minified identifier character and a regexp metacharacter.
    const scriptVariable = match[1].replace(/\$/g, '\\$');
    const loader = source.slice(match.index, match.index + 2000);
    const srcAssignment = new RegExp(`(?<![\\w$])${scriptVariable}\\.src\\s*=`);
    const append = new RegExp(`appendChild\\s*\\(\\s*${scriptVariable}\\s*\\)`);
    if (srcAssignment.test(loader) && append.test(loader)) return true;
  }
  return false;
}

/** Detect tldraw's Gist iframe HTML that executes a remotely hosted .js file. */
export function containsGistSrcDocScript(source) {
  if (!source.includes('srcDoc') || !source.includes('gist.github.com')) return false;
  const file = ts.createSourceFile(
    'emitted.js',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const nodes = [file];
  while (nodes.length > 0) {
    const node = nodes.pop();
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === 'srcDoc' &&
      /<script\b[^>]{0,160}\ssrc\s*=[^<>]{0,160}https:\/\/gist\.github\.com\//.test(
        node.initializer.getText(file),
      )
    ) {
      return true;
    }
    ts.forEachChild(node, (child) => {
      nodes.push(child);
    });
  }
  return false;
}
import ts from 'typescript';
