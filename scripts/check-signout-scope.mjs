#!/usr/bin/env node
/**
 * Source contract for extension sign-out, NOT whole-program alias analysis.
 * - SDK signOut/sign_out references must be direct calls with one literal
 *   { scope: 'local' | 'others' }; extraction/bind/call/apply are forbidden.
 * - An `auth` property may only receive a direct, statically named method call
 *   or be compared with a primitive (the vault's auth status). It cannot escape
 *   through assignments, arguments, returns, destructuring, spreads or containers.
 * - useAuth() UI callbacks are application actions, not SDK methods.
 * - The sole bare OAuth call is allowed in the exact reviewed flow.ts artifact,
 *   with the exact reviewed installed OAuth implementation. Changes require review
 *   and renewed package behavior proof, NOT pinning the dependency version.
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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const EXT = /\.(ts|tsx|js|mjs|rs|py|sh)$/;
const SKIP = /(^|\/)(node_modules|dist|target|build|\.next|\.venv|__pycache__|\.matrx|release)\//;
const LOGOUT_URL = /(?:\/auth\/v1\/logout|["'`]\/logout)(?<rest>[^"'`\n]*)/g;
const COMMENT = /^\s*(?:\/\/|\*|\/\*|#)/;
const FLOW = 'src/lib/auth/flow.ts';
// Reviewed against @ai-matrx/auth 0.3.2. Approval fingerprints, not dependency pins.
const FLOW_SHA = 'a3918502f40c9b7c34a753d2c4a696b9a1613ec2a0804870e0cf9fb64f423e90';
const OAUTH_SHA = 'ec69236f7f4522fa1f34fd402c1e302e518f2e16d7d9e6db5fcba079305ae0a6';
const hash = (text) => createHash('sha256').update(text).digest('hex');
const approvedImplementation = (source) => hash(source) === OAUTH_SHA;
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

export function findingsIn(source, file) {
  const out = [];
  if (!/\.(rs|py|sh)$/.test(file)) {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const nodes = nodesIn(sourceFile);
    const approvedOAuth = file === FLOW && hash(source) === FLOW_SHA;
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
            !(
              approvedOAuth &&
              node.getText(sourceFile) === 'oauth.signOut' &&
              call.arguments.length === 0
            )
          )
            report(node, 'sign-out requires exactly { scope: "local" } or { scope: "others" }');
        }
        if (name === 'auth' && !primitiveComparison(node)) {
          const next = node.parent;
          if (
            !(
              member(next) &&
              next.expression === node &&
              memberName(next) !== null &&
              ts.isCallExpression(next.parent) &&
              next.parent.expression === next
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
  const implementation = readFileSync(
    fileURLToPath(import.meta.resolve('@ai-matrx/auth/matrx-oauth')),
    'utf8',
  );
  if (!approvedImplementation(implementation))
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
async function packageProof() {
  const { createMatrxOAuth } = await import('@ai-matrx/auth/matrx-oauth');
  const values = new Map();
  const requests = [];
  const client = createMatrxOAuth(
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
  const implementation = readFileSync(
    fileURLToPath(import.meta.resolve('@ai-matrx/auth/matrx-oauth')),
    'utf8',
  );
  assert.equal(approvedImplementation(implementation), true, 'installed OAuth artifact approval');
  assert.equal(
    approvedImplementation(implementation.replace('scope=local', 'scope=global')),
    false,
    'changed OAuth artifact must lose approval',
  );
  await packageProof();
  console.log(
    `check:signout-scope self-test: PASS (${cases.length} source cases + installed-package local revoke behavior)`,
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
    } else
      console.log(
        'check:signout-scope: PASS (visible source contract and reviewed OAuth artifact; not whole-program analysis)',
      );
  }
}
