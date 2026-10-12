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
