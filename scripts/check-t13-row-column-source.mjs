#!/usr/bin/env node
/**
 * T-13 source ratchet — no new code reference to the retiring row column (access ladder).
 *
 * Access ladder T-13 (common-docs/projects/access-ladder/t13/PLAN.md §2.5c) retires the row
 * column into `shown_to` (a list filter) and `published_to_web` (the only anonymous lane). Every
 * code reference to the old column is a reader or writer phase 5 converts; this guard makes sure
 * the set only shrinks while that happens. The same guard, rule and baseline shape live in aidream,
 * matrx-frontend, matrx-extend and matrx-local.
 *
 * WHAT IT COUNTS: per file, the lines naming the column as a whole word (lower case — the column,
 * the `platform.<word>` enum, a `.eq("<word>", …)` filter, a type field, a SQL predicate) in tracked
 * and untracked-but-not-ignored code files (py, ts, tsx, js, jsx, mjs, cjs, sql, rs, svelte, vue).
 * NOT counted, because they are a different word: the CSS/DOM property of the same name (`style.<word>`,
 * `<word>: hidden|visible|collapse…`), the SEO `ai_<word>` feature, `document.<word>…`.
 * Skipped paths: migrations (the database guard `t13_no_new_row_column_reader` owns what lands in
 * the database), generated types and build output.
 *
 * It FAILS (exit 1) when any file holds more such lines than
 * `scripts/t13-row-column-source-baseline.json` allows (a new file's allowance is 0), naming every
 * line. The baseline was taken 2026-09-28 from this detector and cross-checked against the T-13
 * census (common-docs/projects/access-ladder/t13/census/). It only shrinks: `--shrink-baseline`
 * lowers counts to what is live and drops converted files; it can never raise one.
 *
 * WHAT IT CANNOT SEE: a reference spelled without the word (a constant holding it, a dynamic key).
 * Green means no new literal reference, not that no new reader exists.
 *
 * `--self-test` proves it red-then-green in memory, writing nothing: a planted new file filtering on
 * the column fails, one more line in a baselined file fails, planted CSS/DOM lines do not fire, and
 * the real tree without plants passes.
 *
 *   node scripts/check-t13-row-column-source.mjs
 *   node scripts/check-t13-row-column-source.mjs --shrink-baseline
 *   node scripts/check-t13-row-column-source.mjs --self-test
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 't13-row-column-source-baseline.json');
const WORD = 'visi' + 'bility';
const QUOTE = `["'${String.fromCharCode(96)}]`;
const ROW = new RegExp(`(?<![A-Za-z0-9_\\-])${WORD}(?![A-Za-z0-9_\\-])`);
// Remove only the recognized occurrence, never its entire source line. A CSS
// property or diagnostic label must not conceal a database field beside it.
const NOISE = [
  new RegExp(
    `\\b(?:[A-Za-z_$][\\w$]*\\.)?(?:style|[A-Za-z_$][\\w$]*Style)\\s*(?:\\.\\s*${WORD}\\b|\\[\\s*${QUOTE}${WORD}${QUOTE}\\s*\\])`,
    'g',
  ),
  new RegExp(`getComputedStyle\\s*\\([^)]*\\)\\.${WORD}\\b`, 'g'),
  // Bare s/cs aliases may be database rows. A comparison to a CSS-only
  // computed-style value is safe to ignore; a bare read remains counted.
  new RegExp(
    `\\b(?:s|cs)\\s*\\.\\s*${WORD}\\s*(?:===|!==|==|!=)\\s*['"](?:hidden|visible|collapse)['"]`,
    'g',
  ),
  new RegExp(
    `${WORD}\\s*:\\s*${QUOTE}?(?:hidden|visible|collapse|inherit|initial|unset|revert)\\b`,
    'g',
  ),
  new RegExp(`${WORD}\\s*:\\s*\\$\\{`, 'g'),
  new RegExp(`ai[_-]${WORD}`, 'g'),
  new RegExp(`\\bconsole\\.log\\(\\s*(["'])(?:(?!\\1).)*${WORD}(?:(?!\\1).)*\\1`, 'g'),
  new RegExp(`document\\.${WORD}\\b`, 'g'),
  new RegExp(`\\b${WORD}\\s*:\\s*["'](?:other|unsupported)["']`, 'g'),
  new RegExp(`\\b(?:test|describe)\\s*\\(\\s*(["'])(?:(?!\\1).)*${WORD}(?:(?!\\1).)*\\1`, 'g'),
];
// These unqualified identifiers describe native panel state only in files that
// actually observe browser visibility. Unknown object/payload shorthand stays
// counted; callback returns and event destructuring have explicit syntax below.
const BROWSER_STATE = new RegExp(`observePanelVisibility|document\\.${WORD}State|${WORD}change`);
const BROWSER_NOISE = [
  new RegExp(
    `\\b${WORD}\\s*:\\s*[A-Za-z_$][\\w$]*\\s*(?:<|>|===|!==|==|!=)\\s*\\d+\\s*\\?\\s*(['"])(?:visible|hidden)\\1\\s*:\\s*(['"])(?:visible|hidden)\\2`,
    'g',
  ),
  new RegExp(
    `\\b${WORD}\\s*:\\s*(?:\\[[^\\]\\n]*\\]\\.includes\\()?document\\.${WORD}State\\b`,
    'g',
  ),
  new RegExp(
    `\\b${WORD}\\s*:\\s*${WORD}\\s*===\\s*['"]unsupported['"]\\s*\\?\\s*['"]other['"]\\s*:\\s*${WORD}\\b`,
    'g',
  ),
  new RegExp(`\\b${WORD}\\.(?:measured|${WORD})\\b`, 'g'),
  new RegExp(`\\b(?:event|events)\\.${WORD}\\b(?!\\s*=(?!=))`, 'g'),
  new RegExp(`\\b(?:const|let|var)\\s+${WORD}\\s*=`, 'g'),
  new RegExp(`\\b${WORD}State\\s*:\\s*${WORD}\\b`, 'g'),
  new RegExp(`\\[\\s*${WORD}\\s*,\\s*focus\\b`, 'g'),
  new RegExp(`\\breturn\\s+${WORD}\\s*;`, 'g'),
  new RegExp(`(?<![.\\w])${WORD}\\s*=\\s*${WORD}\\s*===`, 'g'),
  new RegExp(`(?<![.\\w])${WORD}\\s*=\\s*["'](?:visible|hidden)["']`, 'g'),
  new RegExp(`\\bstate\\?\\.${WORD}\\b`, 'g'),
  new RegExp(`\\basync\\s*\\(\\s*\\)\\s*=>\\s*\\(\\{\\s*${WORD}\\s*\\}\\)`, 'g'),
  new RegExp(
    `\\(\\{\\s*kind\\s*,\\s*${WORD}\\s*\\}\\)\\s*=>\\s*\\[\\s*kind\\s*,\\s*${WORD}\\s*\\]`,
    'g',
  ),
];
const CODE = /\.(py|ts|tsx|js|jsx|mjs|cjs|sql|rs|svelte|vue)$/;
const SKIP =
  /(^|\/)(migrations|node_modules|dist|build|\.next|\.output|vendor|__pycache__|target)\/|database\.types\.ts$|generated|api-types\.ts$|\.d\.ts$|\.min\.js$/;

// SPLIT SPELLINGS FAIL: the word assembled from quoted pieces ("visi" + ..., 'vis' || ..., implicit
// concatenation, a list join) hides a reader from this count, which defeats the guard. Only this guard file
// may assemble it (it must name the word without counting itself).
const SPLIT = new RegExp(
  Array.from({ length: WORD.length - 1 }, (_, i) => i + 1)
    .map(
      (k) =>
        `${WORD.slice(0, k)}["'\`]\\s*(?:\\+|\\|\\||,|\\s)\\s*[rbfuRBFU]{0,2}["'\`]${WORD.slice(k)}`,
    )
    .join('|'),
  'i',
);
const GUARD_FILE = 'scripts/check-t13-row-column-source.mjs';

function files() {
  const out = new Set();
  for (const args of [['ls-files'], ['ls-files', '--others', '--exclude-standard']]) {
    const res = execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    for (const p of res.split('\n')) if (p) out.add(p);
  }
  return [...out].filter((p) => CODE.test(p) && !SKIP.test(p)).sort();
}

// Keep strings (including embedded SQL/test source) and line positions intact.
// A commented database reference is not an executable reader or writer.
function withoutComments(text) {
  let output = '';
  // A Node shebang starts with #!, not JavaScript division. Starting the
  // regex scanner at its slash can swallow a later import and expose comments.
  let start = 0;
  if (text.startsWith('#!')) {
    const end = text.indexOf('\n');
    if (end < 0) return ' '.repeat(text.length);
    output = ' '.repeat(end);
    start = end;
  }
  let quote = null;
  let block = false;
  let line = false;
  let escaped = false;
  let regex = false;
  let regexClass = false;
  let regexEscaped = false;
  const regexCanStart = () => {
    const before = output.trimEnd();
    const previous = before.at(-1);
    if (!previous) return true;
    if (previous === ')' && /\b(?:if|while|for|with|switch|catch)\s*\([^()]*\)\s*$/.test(before))
      return true;
    if ('([{=:;,!?&|+-*%^~<>'.includes(previous)) return true;
    return /\b(?:return|throw|case|delete|void|typeof|instanceof|in|of|yield|await|else|do)\s*$/.test(
      before,
    );
  };
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (regex) {
      if (char === '\n') output += '\n';
      else output += ' ';
      if (regexEscaped) regexEscaped = false;
      else if (char === '\\') regexEscaped = true;
      else if (char === '[') regexClass = true;
      else if (char === ']') regexClass = false;
      else if (char === '/' && !regexClass) {
        regex = false;
        while (/[A-Za-z]/.test(text[i + 1] ?? '')) {
          output += ' ';
          i++;
        }
      }
    } else if (line) {
      if (char === '\n') line = false;
      output += char === '\n' ? '\n' : ' ';
    } else if (block) {
      if (char === '*' && next === '/') {
        output += '  ';
        i++;
        block = false;
      } else output += char === '\n' ? '\n' : ' ';
    } else if (quote) {
      // Template literals can embed executable source (for example, CDP
      // expressions). Strip a comment-only line there too, while preserving
      // arbitrary template text and every line boundary for the source census.
      if (
        quote === '`' &&
        char === '/' &&
        (next === '/' || next === '*') &&
        /^[\t ]*$/.test(text.slice(text.lastIndexOf('\n', i - 1) + 1, i))
      ) {
        block = next === '*';
        line = next === '/';
        output += '  ';
        i++;
        continue;
      }
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char.charCodeAt(0) === 96) {
      quote = char;
      output += char;
    } else if (quote === null && char === '/' && next !== '/' && next !== '*' && regexCanStart()) {
      regex = true;
      regexClass = false;
      regexEscaped = false;
      output += ' ';
    } else if (char === '/' && (next === '/' || next === '*')) {
      block = next === '*';
      line = next === '/';
      output += '  ';
      i++;
    } else output += char;
  }
  return output;
}

export function matchingLines(text) {
  const hits = [];
  const source = withoutComments(text);
  const originalLines = text.split('\n');
  const browserState = BROWSER_STATE.test(source);
  source.split('\n').forEach((line, i) => {
    let remainder = line;
    // Test/SQL strings deliberately remain visible to the census. Only known
    // CSS/browser occurrences are erased, preserving every sibling reference.
    for (const pattern of NOISE) remainder = remainder.replace(pattern, '');
    if (browserState)
      for (const pattern of BROWSER_NOISE) remainder = remainder.replace(pattern, '');
    if (ROW.test(remainder)) hits.push([i + 1, originalLines[i].trim()]);
  });
  return hits;
}

export function scan(overrides = {}) {
  const found = {};
  for (const rel of [...new Set([...files(), ...Object.keys(overrides)])]
    .filter((path) => path !== GUARD_FILE)
    .sort()) {
    let text;
    if (rel in overrides) text = overrides[rel];
    else {
      const p = join(ROOT, rel);
      if (!existsSync(p) || !statSync(p).isFile()) continue;
      text = readFileSync(p, 'utf8');
    }
    const hits = matchingLines(text);
    if (hits.length) found[rel] = hits;
  }
  return found;
}

export function splitSpellings(overrides = {}) {
  const out = [];
  for (const rel of [...new Set([...files(), ...Object.keys(overrides)])].sort()) {
    if (rel === GUARD_FILE) continue;
    let text;
    if (rel in overrides) text = overrides[rel];
    else {
      const p = join(ROOT, rel);
      if (!existsSync(p) || !statSync(p).isFile()) continue;
      text = readFileSync(p, 'utf8');
    }
    text.split('\n').forEach((line, i) => {
      if (SPLIT.test(line)) out.push(`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`);
    });
  }
  return out;
}

const loadBaseline = () => JSON.parse(readFileSync(BASELINE, 'utf8')).files;

export function verdict(found, baseline) {
  const grew = [];
  const shrinkable = [];
  for (const rel of Object.keys(found).sort()) {
    const allowed = baseline[rel] ?? 0;
    const hits = found[rel];
    if (hits.length > allowed) {
      grew.push(
        `${rel}: ${hits.length} reference(s), baseline allows ${allowed}${hits
          .map(([n, l]) => `\n    ${rel}:${n}: ${l.slice(0, 160)}`)
          .join('')}`,
      );
    }
  }
  for (const [rel, allowed] of Object.entries(baseline)) {
    const n = found[rel]?.length ?? 0;
    if (n < allowed) shrinkable.push(`${rel}: ${n} < ${allowed}`);
  }
  return { grew, shrinkable };
}

function shrink(found) {
  const data = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const old = data.files;
  const next = {};
  for (const [rel, n] of Object.entries(old)) {
    const live = found[rel]?.length ?? 0;
    if (live) next[rel] = Math.min(n, live);
  }
  const added = Object.keys(next).filter((r) => !(r in old) || next[r] > old[r]);
  if (added.length) throw new Error(`refused: shrinking would add ${added.join(', ')}`);
  data.files = Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(BASELINE, `${JSON.stringify(data, null, 1)}\n`);
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  console.log(`[t13-row-column-source] baseline shrunk: ${sum(old)} -> ${sum(next)} lines`);
  return 0;
}

function selfTest() {
  const baseline = loadBaseline();
  const someFile = Object.keys(baseline)[0];
  const real = readFileSync(join(ROOT, someFile), 'utf8');
  const plantNew = 'src/__t13_selftest_plant__.ts';
  const embeddedComment = (statement) =>
    [
      'const expression = `(() => {',
      `  // diagnostic ${WORD} state`,
      `  ${statement}`,
      '})()`;',
    ].join('\n');
  const cases = [
    ['real tree, no plant', {}, false],
    [
      'planted new file filtering on the column',
      { [plantNew]: `q.eq("${WORD}", "public");\n` },
      true,
    ],
    [
      'one more reference in a baselined file',
      { [someFile]: `${real}\nrow.${WORD} = "public";\n` },
      true,
    ],
    [
      'planted CSS/DOM lines only (must not fire)',
      {
        [plantNew]: `el.style.${WORD} = "hidden";\nconst css = "${WORD}: hidden;";\nconst style = getComputedStyle(el);\nstyle.${WORD} !== "hidden";\nconst ai_${WORD}_panel = 1;\n`,
      },
      false,
    ],
    [
      'planted browser diagnostic state only (must not fire)',
      {
        [plantNew]: `const visibility = await observePanelVisibility(panel);\nif (!visibility.measured || visibility.visibility !== "visible") return;\nconst event = { visibility: "hidden" };\nreturn event.visibility;\n`,
      },
      false,
    ],
    [
      'planted browser panel checkpoint labels only (must not fire)',
      {
        [plantNew]: `const phases = observePanelVisibility(panel);\nconst entry = { ${WORD}: index < 3 ? 'visible' : 'hidden' };\n`,
      },
      false,
    ],
    [
      'comment in embedded browser source only (must not fire)',
      { [plantNew]: embeddedComment('return true;') },
      false,
    ],
    [
      'shebang followed by import and ordinary comments (must not fire)',
      {
        [plantNew]: `#!/usr/bin/env node\nimport 'node:fs';\n/** ${WORD} comment */\n// ${WORD} comment\n`,
      },
      false,
    ],
    [
      'embedded source query remains counted after comment',
      { [plantNew]: embeddedComment(`query.eq('${WORD}', 'internal');`) },
      true,
    ],
    ...[
      ['query field', `query.eq('${WORD}', 'internal');`, true],
      [
        'escaped-slash regex leaves following query visible',
        `const scheme = /https?:\\/\\//; query.eq('${WORD}', 'internal');`,
        true,
      ],
      [
        'regex character class does not start a comment',
        `/[/*]/; query.eq('${WORD}', 'internal');`,
        true,
      ],
      [
        'regex after control condition does not start a comment',
        `if (ready) /[/*]/.test(value); query.eq('${WORD}', 'internal');`,
        true,
      ],
      [
        'regex after return leaves following query visible',
        `return /https?:\\/\\//; query.eq('${WORD}', 'internal');`,
        true,
      ],
      ['row payload', `const body = { ${WORD}: 'internal' };`, true],
      ['payload shorthand', `const body = { ${WORD} };`, true],
      ['variable-valued payload', `const body = { ${WORD}: ${WORD} };`, true],
      ['expression-valued payload', `const body = { ${WORD}: ${WORD} === 'public' };`, true],
      ['expression-valued property write', `row.${WORD} = ${WORD} === 'visible';`, true],
      ['property write', `row.${WORD} = 'public';`, true],
      ['bare s row read', `const row = s.${WORD};`, true],
      ['bare cs row read', `const row = cs.${WORD};`, true],
      [
        'computed style s comparison',
        `const s = getComputedStyle(el); s.${WORD} !== 'hidden';`,
        false,
      ],
      [
        'computed style cs comparison',
        `const cs = getComputedStyle(el); cs.${WORD} === 'visible';`,
        false,
      ],
      [
        'query assigned to diagnostic-named variable',
        `const ${WORD} = query.eq('${WORD}', 'internal');`,
        true,
      ],
      ['mixed CSS and query', `style.${WORD} === 'hidden'; query.eq('${WORD}', 'internal');`, true],
      [
        'mixed console label and query',
        `console.log('${WORD}', query.eq('${WORD}', 'internal'));`,
        true,
      ],
      ['mixed browser event and row write', `event.${WORD}; row.${WORD} = 'public';`, true],
      ['browser event property write is not noise', `event.${WORD} = 'public';`, true],
      ['CSS property comparison', `style.${WORD} === 'hidden';`, false],
      ['CSS property write', `element.style.${WORD} = 'hidden';`, false],
      ['CSS bracket property write', `element.style['${WORD}'] = 'hidden';`, false],
      [
        'mixed CSS bracket property and query',
        `element.style['${WORD}'] = 'hidden'; query.eq('${WORD}', 'internal');`,
        true,
      ],
      ['computed CSS comparison', `getComputedStyle(element).${WORD} === 'visible';`, false],
      ['browser callback result', `async () => ({ ${WORD} }),`, false],
      [
        'browser event destructuring',
        `result.events.map(({ kind, ${WORD} }) => [kind, ${WORD}]);`,
        false,
      ],
      ['inline commented query', `style.display; // query.eq('${WORD}', 'internal');`, false],
      ['block commented query', `/* disabled\nquery.eq('${WORD}', 'internal');\n*/`, false],
      ['comment followed by live query', `/* disabled */ query.eq('${WORD}', 'internal');`, true],
      ['commented query', `// query.eq('${WORD}', 'internal');`, false],
    ].map(([name, text, wantFail]) => [
      `isolated ${name}`,
      { [plantNew]: `const state = document.${WORD}State;\n${text}\n` },
      wantFail,
    ]),
  ];
  let ok = true;
  const splitPlant = 'scripts/__t13_selftest_split__.ts';
  const [a, b] = [WORD.slice(0, 4), WORD.slice(4)];
  for (const [name, text, wantFail] of [
    ['planted split spelling with +', `const W = "${a}" + "${b}";\n`, true],
    ['planted split spelling with || (SQL)', `const q = "select '${a}' || '${b}'";\n`, true],
    ['planted list join', `const W = ["${a}", "${b}"].join('');\n`, true],
    ['unrelated concatenation (must not fire)', `const x = "vis" + "ual";\n`, false],
  ]) {
    const hits = splitSpellings({ [splitPlant]: text }).filter((h) => h.startsWith(splitPlant));
    const good = hits.length > 0 === wantFail;
    ok &&= good;
    console.log(`  ${good ? 'ok  ' : 'FAIL'} ${name}: ${hits.length ? 'red' : 'green'}`);
  }
  const realSplit = splitSpellings();
  ok &&= realSplit.length === 0;
  console.log(
    `  ${realSplit.length ? 'FAIL' : 'ok  '} real tree has no split spelling outside the guard (${realSplit.length})`,
  );
  for (const [name, overrides, wantFail] of cases) {
    const { grew } = verdict(scan(overrides), baseline);
    const failed = grew.length > 0;
    const named = wantFail
      ? Object.keys(overrides).every((k) => grew.some((g) => g.includes(k)))
      : true;
    const good = failed === wantFail && named;
    ok &&= good;
    console.log(
      `  ${good ? 'ok  ' : 'FAIL'} ${name}: ${failed ? 'red' : 'green'}${grew.length ? ` — ${grew[0].split('\n')[0]}` : ''}`,
    );
  }
  console.log(
    `[t13-row-column-source] self-test ${ok ? 'PASS' : 'FAIL'} (in memory, nothing written)`,
  );
  return ok ? 0 : 1;
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();
  const split = splitSpellings();
  if (split.length) {
    for (const s of split)
      console.log(`FAIL split spelling of the row column (hides a reader from this guard): ${s}`);
    console.log(
      '[t13-row-column-source] FAIL — write the column name plainly (common-docs/projects/access-ladder/t13/PLAN.md §2.5).',
    );
    return 1;
  }
  const found = scan();
  if (argv.includes('--shrink-baseline')) return shrink(found);
  const { grew, shrinkable } = verdict(found, loadBaseline());
  if (shrinkable.length) {
    console.log(
      `[t13-row-column-source] ${shrinkable.length} file(s) converted below baseline — run --shrink-baseline`,
    );
  }
  if (grew.length) {
    for (const g of grew) console.log(`FAIL ${g}`);
    console.log(
      `[t13-row-column-source] FAIL — ${grew.length} file(s) gained a reference to the row column access-ladder T-13 retires. Read published_to_web for the anonymous lane and shown_to for list narrowing (common-docs/projects/access-ladder/t13/PLAN.md); the baseline never grows.`,
    );
    return 1;
  }
  const total = Object.values(found).reduce((a, h) => a + h.length, 0);
  console.log(
    `[t13-row-column-source] clean — ${total} baselined reference(s) in ${Object.keys(found).length} file(s), none new`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
