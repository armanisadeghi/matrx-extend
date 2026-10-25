#!/usr/bin/env node
/**
 * Source contract for extension sign-out, NOT whole-program alias analysis.
 * - SDK signOut/sign_out references must be direct calls with one literal
 *   { scope: 'local' | 'others' }; extraction/bind/call/apply are forbidden.
 * - An `auth` property may only receive a direct, statically named method call
 *   or itself be called as a factory, or compared with a primitive. It cannot escape
 *   through assignments, arguments, returns, destructuring, spreads or containers.
 * - useAuth() UI callbacks are application actions, not SDK methods.
 * - Bare OAuth calls require lexical provenance to the reviewed package factory.
 *   Every local assignment and function return must resolve to that factory or null;
 *   assertions, unknown values and shadowed imports do not establish provenance.
 *
 * This checks visible property syntax in tracked/unignored source, not arbitrary
 * imported functions, reflective access, dynamically constructed property names
 * on client objects, eval, or dependency internals. New access patterns require
 * extending this contract/review; PASS is not a proof about arbitrary JavaScript.
 * Literal GoTrue URLs are checked separately; dynamically assembled URLs are not.
 */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const EXT = /\.(ts|tsx|js|mjs|rs|py|sh)$/;
const SKIP = /(^|\/)(node_modules|dist|target|build|\.next|\.venv|__pycache__|\.matrx|release)\//;
const LOGOUT_URL = /(?:\/auth\/v1\/logout|["'`]\/logout)(?<rest>[^"'`\n]*)/g;
const COMMENT = /^\s*(?:\/\/|\*|\/\*|#)/;
const FLOW = 'src/lib/auth/flow.ts';
// Reviewed against @ai-matrx/auth 0.4.14. Approval fingerprints, not dependency pins.
// Since 0.3.5 signOut is unchanged: local clear first, then POST logout?scope=local.
const OAUTH_SHA = 'a32106dc15c064b483e05e4d595d56455438a00e805f02c341b38bca5c567ab5';
const hash = (text) => createHash('sha256').update(text).digest('hex');
const approvedImplementation = (source) => hash(source) === OAUTH_SHA;

// The published entry now re-exports shared chunks. Approve their actual bytes,
// including the JWT helper, rather than approving only an unchanged facade.
export function readReviewedOAuth(
  entryUrl = import.meta.resolve('@ai-matrx/auth/matrx-oauth'),
  readSource = (url) => readFileSync(fileURLToPath(url), 'utf8'),
) {
  const root = dirname(realpathSync(fileURLToPath(entryUrl)));
  const modules = new Map();
  function visit(url) {
    const target = new URL(url);
    assert.ok(
      target.protocol === 'file:' && !target.search && !target.hash,
      'OAuth approval requires plain file module URLs',
    );
    const realPath = realpathSync(fileURLToPath(target));
    assert.ok(statSync(realPath).isFile(), 'OAuth approval module must be a file');
    const canonicalUrl = pathToFileURL(realPath).href;
    if (modules.has(canonicalUrl)) return;
    const path = relative(root, realPath).replaceAll('\\', '/');
    assert.ok(path && !path.startsWith('../'), 'OAuth approval module must stay in package dist');
    const source = readSource(canonicalUrl);
    const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    assert.equal(parsed.parseDiagnostics.length, 0, 'OAuth approval module must parse');
    modules.set(canonicalUrl, { path, source, parsed });
    for (const node of nodesIn(parsed)) {
      assert.ok(
        !ts.isImportEqualsDeclaration(node) &&
          !(
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
          ),
        'OAuth approval requires a static module closure',
      );
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      const specifier = node.moduleSpecifier;
      if (!specifier) continue;
      assert.ok(
        ts.isStringLiteral(specifier) && /^\.\.?\//.test(specifier.text),
        'OAuth approval requires reviewed relative module imports',
      );
      visit(new URL(specifier.text, canonicalUrl).href);
    }
  }
  visit(entryUrl);
  const ordered = [...modules.entries()].sort(([, left], [, right]) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const implementations = ordered.flatMap(([url, module]) =>
    nodesIn(module.parsed)
      .filter(
        (node) => ts.isMethodDeclaration(node) && node.body && nameOf(node.name) === 'signOut',
      )
      .map(() => [url, module]),
  );
  assert.equal(implementations.length, 1, 'OAuth signOut must have one reviewed implementation');
  const [implementationUrl, implementation] = implementations[0];
  return {
    approvalSource: JSON.stringify(ordered.map(([, { path, source }]) => [path, source])),
    implementation: implementation.source,
    implementationUrl,
    modules,
  };
}

function importableMutation(source, moduleUrl) {
  let mutatedSource = source;
  const parsed = ts.createSourceFile('oauth.js', source, ts.ScriptTarget.Latest, true);
  const replacements = nodesIn(parsed)
    .filter((node) => ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    .map((node) => node.moduleSpecifier)
    .filter((node) => node && ts.isStringLiteral(node))
    .sort((left, right) => right.getStart(parsed) - left.getStart(parsed));
  for (const specifier of replacements)
    mutatedSource = `${mutatedSource.slice(0, specifier.getStart(parsed))}${JSON.stringify(new URL(specifier.text, moduleUrl).href)}${mutatedSource.slice(specifier.end)}`;
  return mutatedSource;
}
const logout = (name) => name === 'signOut' || name === 'sign_out';
const member = (node) => ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
function nameOf(node) {
  if (!node) return null;
  if (ts.isComputedPropertyName(node))
    return ts.isStringLiteral(node.expression) ||
      ts.isNoSubstitutionTemplateLiteral(node.expression)
      ? node.expression.text
      : null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  return null;
}
function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  // Identifiers in brackets are dynamic, even when their spelling is "signOut".
  return ts.isStringLiteral(node.argumentExpression) ||
    ts.isNoSubstitutionTemplateLiteral(node.argumentExpression)
    ? node.argumentExpression.text
    : null;
}
function scoped(call) {
  if (call.arguments.length !== 1 || !ts.isObjectLiteralExpression(call.arguments[0])) return false;
  const properties = call.arguments[0].properties;
  return (
    properties.length === 1 &&
    ts.isPropertyAssignment(properties[0]) &&
    nameOf(properties[0].name) === 'scope' &&
    ts.isStringLiteral(properties[0].initializer) &&
    ['local', 'others'].includes(properties[0].initializer.text)
  );
}
function primitiveComparison(node) {
  const parent = node.parent;
  if (
    !ts.isBinaryExpression(parent) ||
    ![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(
      parent.operatorToken.kind,
    )
  )
    return false;
  const other = parent.left === node ? parent.right : parent.left;
  return (
    ts.isStringLiteral(other) ||
    ts.isNumericLiteral(other) ||
    [ts.SyntaxKind.NullKeyword, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(
      other.kind,
    )
  );
}
function nodesIn(root) {
  const nodes = [];
  function visit(node) {
    nodes.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return nodes;
}
// Keep offsets/newlines intact so URL findings still point to their source line.
// The scanner recognizes comments without mistaking // inside quoted URLs for one.
function withoutJsComments(source) {
  const visible = source.split('');
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source,
  );
  const templateDepths = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      for (let i = scanner.getTokenPos(); i < scanner.getTextPos(); i++)
        if (visible[i] !== '\n') visible[i] = ' ';
    } else if (token === ts.SyntaxKind.TemplateHead) templateDepths.push(0);
    else if (templateDepths.length && token === ts.SyntaxKind.OpenBraceToken)
      templateDepths[templateDepths.length - 1]++;
    else if (templateDepths.length && token === ts.SyntaxKind.CloseBraceToken) {
      const last = templateDepths.length - 1;
      if (templateDepths[last] > 0) templateDepths[last]--;
      else {
        token = scanner.reScanTemplateToken(false);
        if (token === ts.SyntaxKind.TemplateTail) templateDepths.pop();
      }
    }
  }
  return visible.join('');
}
// Resolve only lexical UI-hook imports, never infer SDK aliases or return values.
function uiHookCall(nodes, initializer) {
  if (!initializer || !ts.isCallExpression(initializer) || !ts.isIdentifier(initializer.expression))
    return false;
  const name = initializer.expression.text;
  const imports = nodes.filter(
    (node) =>
      ts.isImportSpecifier(node) &&
      node.name.text === name &&
      (node.propertyName?.text ?? name) === 'useAuth' &&
      node.parent.parent.parent.moduleSpecifier.text === '@/hooks/use-auth',
  );
  if (imports.length !== 1) return false;
  // Any local declaration with this name refuses the exemption, including nested patterns.
  return !nodes.some(
    (node) =>
      ts.isIdentifier(node) &&
      node.text === name &&
      (ts.isVariableDeclaration(node.parent) ||
        ts.isParameter(node.parent) ||
        ts.isBindingElement(node.parent) ||
        ts.isFunctionDeclaration(node.parent) ||
        ts.isClassDeclaration(node.parent)) &&
      node.parent.name === node,
  );
}

// Bind symbols within this source without loading dependencies or trusting assertions.
// A shadowed import is a different symbol and cannot establish factory provenance.
function oauthProvenance(sourceFile, nodes) {
  const host = {
    getSourceFile: (name) => (name === sourceFile.fileName ? sourceFile : undefined),
    getDefaultLibFileName: () => '',
    writeFile() {},
    getCurrentDirectory: () => '',
    getDirectories: () => [],
    fileExists: () => false,
    readFile: () => undefined,
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const checker = ts
    .createProgram([sourceFile.fileName], { noLib: true, noResolve: true }, host)
    .getTypeChecker();
  const symbol = (node) =>
    ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node);
  function importedFactory(node) {
    const declarations = symbol(node)?.declarations;
    return (
      declarations?.length === 1 &&
      ts.isImportSpecifier(declarations[0]) &&
      !declarations[0].isTypeOnly &&
      !declarations[0].parent.parent.isTypeOnly &&
      (declarations[0].propertyName ?? declarations[0].name).text === 'createMatrxOAuth' &&
      declarations[0].parent.parent.parent.moduleSpecifier.text === '@ai-matrx/auth/matrx-oauth'
    );
  }
  function combine(values) {
    return values.length && values.every((item) => item !== null) ? values.some(Boolean) : null;
  }
  function value(node, visiting = new Set()) {
    if (!node) return null;
    if (node.kind === ts.SyntaxKind.NullKeyword) return false;
    if (ts.isParenthesizedExpression(node)) return value(node.expression, visiting);
    if (ts.isConditionalExpression(node))
      return combine([value(node.whenTrue, visiting), value(node.whenFalse, visiting)]);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (importedFactory(node.expression)) return true;
      const declaration = symbol(node.expression)?.valueDeclaration;
      if (
        symbol(node.expression)?.declarations?.length !== 1 ||
        !declaration ||
        !ts.isFunctionDeclaration(declaration) ||
        !declaration.body ||
        declaration.parameters.length ||
        visiting.has(declaration) ||
        nodes.some(
          (candidate) =>
            ts.isBinaryExpression(candidate) &&
            candidate.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
            candidate.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
            nodesIn(candidate.left).some(
              (part) => ts.isIdentifier(part) && symbol(part) === symbol(node.expression),
            ),
        )
      )
        return null;
      const next = new Set(visiting).add(declaration);
      const returns = [];
      function visit(child) {
        if (ts.isReturnStatement(child)) returns.push(value(child.expression, next));
        else if (!ts.isFunctionLike(child)) ts.forEachChild(child, visit);
      }
      visit(declaration.body);
      return combine(returns);
    }
    if (!ts.isIdentifier(node)) return null;
    const identity = symbol(node);
    const declaration = identity?.valueDeclaration;
    if (
      identity?.declarations?.length !== 1 ||
      !declaration ||
      !ts.isVariableDeclaration(declaration) ||
      !ts.isIdentifier(declaration.name) ||
      visiting.has(declaration)
    )
      return null;
    const next = new Set(visiting).add(declaration);
    const values = [value(declaration.initializer, next)];
    for (const candidate of nodes) {
      if (
        (ts.isForOfStatement(candidate) || ts.isForInStatement(candidate)) &&
        nodesIn(candidate.initializer).some(
          (part) => ts.isIdentifier(part) && symbol(part) === identity,
        )
      )
        values.push(null);
      if (
        ts.isBinaryExpression(candidate) &&
        ts.isIdentifier(candidate.left) &&
        symbol(candidate.left) === identity &&
        candidate.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        candidate.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      )
        values.push(
          candidate.operatorToken.kind === ts.SyntaxKind.EqualsToken
            ? value(candidate.right, next)
            : null,
        );
      if (
        ts.isBinaryExpression(candidate) &&
        candidate.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        (ts.isObjectLiteralExpression(candidate.left) ||
          ts.isArrayLiteralExpression(candidate.left)) &&
        nodesIn(candidate.left).some((part) => ts.isIdentifier(part) && symbol(part) === identity)
      )
        values.push(null);
    }
    return combine(values);
  }
  return (expression) => value(expression) === true;
}

export function findingsIn(source, file) {
  const out = [];
  if (!/\.(rs|py|sh)$/.test(file)) {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const nodes = nodesIn(sourceFile);
    const approvedOAuth = oauthProvenance(sourceFile, nodes);
    const report = (node, message) =>
      out.push(
        `${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}: ${message}`,
      );
    for (const error of sourceFile.parseDiagnostics)
      report(
        sourceFile,
        `unparseable source: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`,
      );
    for (const node of nodes) {
      if (member(node)) {
        const name = memberName(node);
        const call =
          ts.isCallExpression(node.parent) && node.parent.expression === node ? node.parent : null;
        if (logout(name) && !primitiveComparison(node)) {
          if (!call)
            report(
              node,
              'sign-out method extraction is forbidden; call it directly with a literal scope',
            );
          else if (
            !scoped(call) &&
            !(approvedOAuth(node.expression) && call.arguments.length === 0)
          )
            report(node, 'sign-out requires exactly { scope: "local" } or { scope: "others" }');
        }
        if (name === 'auth' && !primitiveComparison(node)) {
          const next = node.parent;
          if (
            !(
              (ts.isCallExpression(next) && next.expression === node) ||
              (member(next) &&
                next.expression === node &&
                memberName(next) !== null &&
                ts.isCallExpression(next.parent) &&
                next.parent.expression === next)
            )
          )
            report(
              node,
              'auth object escape/computed access is forbidden; use a direct named method call',
            );
        }
      }
      if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
        const name = nameOf(node.propertyName ?? node.name);
        const declaration = node.parent.parent;
        if (
          name === 'auth' ||
          (logout(name) &&
            !(ts.isVariableDeclaration(declaration) && uiHookCall(nodes, declaration.initializer)))
        )
          report(
            node,
            'auth/sign-out destructuring is forbidden outside the imported useAuth UI hook',
          );
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isObjectLiteralExpression(node.left)
      ) {
        for (const property of nodesIn(node.left)) {
          if (
            (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
            (nameOf(property.name) === 'auth' || logout(nameOf(property.name)))
          )
            report(property, 'auth/sign-out destructuring assignment is forbidden');
        }
      }
    }
  }
  const jsLike = !/\.(py|sh)$/.test(file);
  const urlSource = jsLike ? withoutJsComments(source) : source;
  urlSource.split('\n').forEach((line, i) => {
    if (!jsLike && COMMENT.test(line)) return;
    for (const match of line.matchAll(LOGOUT_URL)) {
      // Only an explicit local/others query value is accepted; variable scopes refuse.
      const scopes = [...match.groups.rest.matchAll(/[?&]scope=([^&\s]*)/g)];
      if (scopes.length !== 1 || !['local', 'others'].includes(scopes[0][1]))
        out.push(
          `${file}:${i + 1}: GoTrue logout URL requires literal scope=local or scope=others`,
        );
    }
  });
  return out;
}
function scan() {
  const findings = [];
  const { approvalSource } = readReviewedOAuth();
  if (!approvedImplementation(approvalSource))
    findings.push(
      'Installed OAuth implementation changed: review its local sign-out behavior and renew the approval fingerprint.',
    );
  const files = execSync('git ls-files --cached --others --exclude-standard', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).split('\n');
  for (const file of new Set(files)) {
    if (
      !file ||
      !EXT.test(file) ||
      SKIP.test(file) ||
      /(^|\/)(tests?|__tests__)\//.test(file) ||
      /\.test\.|self-test/.test(file) ||
      file.endsWith('check-signout-scope.mjs')
    )
      continue;
    try {
      findings.push(...findingsIn(readFileSync(resolve(REPO_ROOT, file), 'utf8'), file));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return findings;
}
async function packageProof(createClient) {
  const { createMatrxOAuth } = await import('@ai-matrx/auth/matrx-oauth');
  const values = new Map();
  const requests = [];
  const client = (createClient ?? createMatrxOAuth)(
    {
      authUrl: 'https://auth.invalid',
      clientId: 'extension-guard',
      redirectUri: 'https://extension.invalid/callback',
    },
    {
      storage: {
        getItem: async (key) => values.get(key) ?? null,
        setItem: async (key, value) => {
          values.set(key, value);
        },
        removeItem: async (key) => {
          values.delete(key);
        },
      },
      openAuthorization: async () => {
        throw new Error('Unexpected sign-in');
      },
      fetch: async (url, options) => {
        requests.push({ url, method: options.method, cleared: values.size === 0 });
        return new Response(null, { status: 204 });
      },
    },
  );
  const accessToken = `header.${Buffer.from(JSON.stringify({ sub: 'guard-person', exp: 4102444800 })).toString('base64url')}.signature`;
  await client.adoptTokens({
    accessToken,
    refreshToken: 'guard-refresh',
    expiresAtMs: 4102444800000,
  });
  assert.notEqual(await client.getSession(), null);
  assert.deepEqual(await client.signOut(), { revoked: true });
  assert.equal(await client.getSession(), null);
  assert.deepEqual(requests, [
    { url: 'https://auth.invalid/auth/v1/logout?scope=local', method: 'POST', cleared: true },
  ]);
  assert.deepEqual(await client.signOut(), { revoked: null });
  assert.equal(requests.length, 1);
}
async function selfTest() {
  const cases = [
    ['supabase.auth.signOut()', true],
    ['supabase.auth.signOut({scope:"global"})', true],
    ['supabase.auth.signOut({scope:"local"})', false],
    ['supabase.auth["signOut"]({scope:"others"})', false],
    ['supabase.auth.signOut({scope:"local", ...options})', true],
    ['supabase.auth.signOut({scope:"local", scope:"global"})', true],
    ['supabase.auth.signOut(options)', true],
    ['supabase.auth.signOut({scope:choice})', true],
    ['supabase.auth.signOut({[scope]:"local"})', true],
    ['supabase.auth.signOut({["scope"]:"local"})', false],
    ['const leave=supabase.auth.signOut.bind(supabase.auth); leave()', true],
    ['const leave=supabase.auth["signOut"].bind(supabase.auth); leave()', true],
    ['supabase.auth.signOut.call(supabase.auth)', true],
    ['supabase.auth.signOut.apply(supabase.auth, [])', true],
    ['const leave=supabase.auth.signOut; leave({scope:"local"})', true],
    ['const leave=authClient.signOut; leave()', true],
    ['const {signOut:leave}=supabase.auth; leave()', true],
    ['const {auth:a}=supabase; a[method]()', true],
    ['let a; ({auth:a}=supabase); a[method]()', true],
    ['const a=supabase.auth; a[method]()', true],
    ['const box=[supabase.auth]; box[0][method]()', true],
    ['function pick(){return supabase.auth} pick()[method]()', true],
    ['run(supabase.auth)', true],
    ['const auth=unrelated; auth[method]()', false],
    ['const [auth,setAuth]=useState("checking")', false],
    ['supabase.auth[method]()', true],
    ['supabase.auth["sign"+"Out"]()', true],
    ['supabase.auth.getSession()', false],
    ['supabase["auth"].signOut({scope:"local"})', false],
    ['vault.auth === "signed-out"', false],
    ['state.signOut === 1', false],
    ['oauth.signOut()', true],
    ['const {signOut}=useAuth(); signOut()', true],
    ['import {useAuth} from "@/hooks/use-auth"; const {signOut}=useAuth(); signOut()', false],
    [
      'import {useAuth} from "@/hooks/use-auth"; function run(useAuth) { const {signOut}=useAuth(); signOut() }',
      true,
    ],
    ['fetch(`${url}/auth/v1/logout`)', true],
    ['fetch(`${url}/auth/v1/logout?scope=global`)', true],
    ['fetch(`${url}/auth/v1/logout?scope=local`)', false],
    ['fetch(`${url}/auth/v1/logout?scope=${scope}`)', true],
    ['/* audit */ fetch("/auth/v1/logout")', true],
    ['/* audit */ fetch("/auth/v1/logout?scope=global")', true],
    ['/* audit */ fetch("/auth/v1/logout?scope=local")', false],
    ['fetch("/auth/v1/logout") /* audit */', true],
    ['// audit\nfetch("/auth/v1/logout")', true],
    ['/* audit\n * checked */ fetch("/auth/v1/logout")', true],
    ['/* fetch("/auth/v1/logout") */', false],
    ['fetch("/auth/v1/logout?scope=local") /* fetch("/auth/v1/logout") */', false],
    ['fetch("/auth/v1/logout?scope=local") // /auth/v1/logout', false],
    ['// fetch("/auth/v1/logout")\nfetch("/auth/v1/logout?scope=local")', false],
    ['fetch(`${root /* audit */}/auth/v1/logout?scope=local`)', false],
    ['fetch(`https://${host}/auth/v1/logout`)', true],
    ['fetch(`https://${host}/auth/v1/logout?scope=local`)', false],
    ['// supabase.auth.signOut()', false],
    ['supabase.auth.signOut(', true],
  ];
  const factoryImport = 'import {createMatrxOAuth as make} from "@ai-matrx/auth/matrx-oauth";';
  for (const [body, expected] of [
    ['const device = make(config, runtime); device.signOut()', false],
    ['const device = make(config, runtime); const renamed = device; renamed.signOut()', false],
    [
      'let cached = null; function get() { if (cached) return cached; cached = make(config, runtime); return cached; } const device = get(); device.signOut()',
      false,
    ],
    ['const device = make(config, runtime); device.signOut({scope:"global"})', true],
    ['function run(make) { const device = make(); device.signOut(); }', true],
    ['const device = other as MatrxOAuthClient; device.signOut()', true],
    ['let device = make(config, runtime); device = other; device.signOut()', true],
    ['let device = make(config, runtime); ({device} = other); device.signOut()', true],
    ['let device = make(config, runtime); [device] = other; device.signOut()', true],
    ['let device = make(config, runtime); for (device of others) { device.signOut(); }', true],
    ['var device = make(config, runtime); var device = other; device.signOut()', true],
    [
      'function get() { return make(config, runtime); } function get() { return other; } get().signOut()',
      true,
    ],
    ['function get() { return other; } const device = get(); device.signOut()', true],
    ['function get() { return make(config, runtime); } get = replacement; get().signOut()', true],
    [
      'function get() { if (ready) return make(config, runtime); return other; } const device = get(); device.signOut()',
      true,
    ],
    ['function get(device) { return device; } get(other).signOut()', true],
    ['const device = make(config, runtime); function run(device) { device.signOut(); }', true],
    ['const device = make(config, runtime); const leave = device.signOut; leave()', true],
  ])
    cases.push([factoryImport + body, expected]);
  cases.push([
    'const attempt = { auth: deps.auth() }; attempt.auth.signOut({scope:"local"})',
    false,
  ]);
  cases.push(['const attempt = { auth: deps.auth() }; attempt.auth.signOut()', true]);
  cases.push([
    'const attempt = { auth: client.auth }; attempt.auth.signOut({scope:"local"})',
    true,
  ]);
  const flow = readFileSync(resolve(REPO_ROOT, FLOW), 'utf8');
  cases.push([flow, false, FLOW]);
  cases.push([
    flow.replace('await oauth.signOut();', 'await supabase.auth.signOut();'),
    true,
    FLOW,
  ]);
  cases.push([
    flow.replace('const oauth = getClient();', 'const oauth = supabase.auth;'),
    true,
    FLOW,
  ]);
  cases.push([
    `${flow}\nconst leave=supabase.auth.signOut.bind(supabase.auth); leave();`,
    true,
    FLOW,
  ]);
  cases.push([
    flow.replace('if (client) return client;', 'if (client) return otherClient;'),
    true,
    FLOW,
  ]);
  for (const [source, expected, file = 'planted.ts'] of cases)
    assert.equal(
      findingsIn(source, file).length > 0,
      expected,
      `source-contract case: ${source.slice(0, 120)}`,
    );
  const { approvalSource, implementation, implementationUrl, modules } = readReviewedOAuth();
  assert.equal(
    approvedImplementation(approvalSource),
    true,
    'installed OAuth module closure approval',
  );
  assert.equal(
    approvedImplementation(approvalSource.replace('scope=local', 'scope=global')),
    false,
    'changed OAuth artifact must lose approval',
  );
  for (const [changedUrl] of modules) {
    const changed = readReviewedOAuth(
      undefined,
      (url) =>
        `${readFileSync(fileURLToPath(url), 'utf8')}${url === changedUrl ? '\n// changed artifact\n' : ''}`,
    );
    assert.equal(
      approvedImplementation(changed.approvalSource),
      false,
      'any changed entry or dependency artifact must lose approval',
    );
  }
  const entryUrl = import.meta.resolve('@ai-matrx/auth/matrx-oauth');
  const helperPath = [...modules.entries()].find(
    ([url]) => url !== entryUrl && url !== implementationUrl,
  )?.[1].path;
  assert.ok(helperPath, 'split OAuth artifact must include its reviewed helper');
  assert.throws(
    () =>
      readReviewedOAuth(entryUrl, (url) => {
        const source = readFileSync(fileURLToPath(url), 'utf8');
        return url === entryUrl
          ? source.replace(`./${modules.get(implementationUrl).path}`, `./${helperPath}`)
          : source;
      }),
    'retargeting the entry away from signOut must lose approval',
  );
  for (const unsupported of [
    'import("./dynamic.js");',
    'require("./dynamic.js");',
    'import value from "node:fs";',
    'export * from "./missing-oauth-approval.js";',
    'export * from "./matrx-oauth.js?unreviewed";',
    'export * from "../../outside-approval.js";',
    'export * from "file:///tmp/outside-approval.js";',
  ])
    assert.throws(
      () =>
        readReviewedOAuth(
          entryUrl,
          (url) =>
            `${readFileSync(fileURLToPath(url), 'utf8')}${url === entryUrl ? `\n${unsupported}\n` : ''}`,
        ),
      'unsupported module graph must lose approval',
    );
  await packageProof();
  // Execute mutations of the real installed artifact in memory: changing scope,
  // skipping local cleanup, or returning success without work must fail this proof.
  const parsed = ts.createSourceFile('oauth.js', implementation, ts.ScriptTarget.Latest, true);
  const signOut = nodesIn(parsed).find(
    (node) => ts.isMethodDeclaration(node) && nameOf(node.name) === 'signOut',
  );
  assert.ok(signOut?.body, 'installed OAuth signOut method must be measurable');
  assert.equal(
    nodesIn(parsed).filter(
      (node) => ts.isMethodDeclaration(node) && nameOf(node.name) === 'signOut',
    ).length,
    1,
  );
  for (const target of ['scope=local', 'const access = await lock(clearLocal);'])
    assert.equal(
      implementation.split(target).length,
      2,
      'behavior mutation target must occur exactly once',
    );
  const mutants = [
    implementation.replace('scope=local', 'scope=global'),
    implementation.replace(
      'const access = await lock(clearLocal);',
      'const access = (await loadStored())?.accessToken ?? null;',
    ),
    `${implementation.slice(0, signOut.body.getStart(parsed))}{ return { revoked: true }; }${implementation.slice(signOut.body.end)}`,
  ];
  for (const mutant of mutants) {
    assert.notEqual(mutant, implementation, 'behavior mutation must change the installed artifact');
    const { createMatrxOAuth } = await import(
      `data:text/javascript;base64,${Buffer.from(importableMutation(mutant, implementationUrl)).toString('base64')}`
    );
    await assert.rejects(() => packageProof(createMatrxOAuth), assert.AssertionError);
  }
  console.log(
    `check:signout-scope self-test: PASS (${cases.length} source cases + installed-package local revoke behavior + ${mutants.length} rejected behavior mutations)`,
  );
}
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) await selfTest();
  else {
    const findings = scan();
    if (findings.length) {
      console.error(
        `Sign-out source contract failed:\n${findings.map((finding) => `  ${finding}`).join('\n')}`,
      );
      process.exitCode = 1;
    } else {
      await packageProof();
      console.log(
        'check:signout-scope: PASS (visible source contract, reviewed OAuth artifact and local revoke behavior; not whole-program analysis)',
      );
    }
  }
}
