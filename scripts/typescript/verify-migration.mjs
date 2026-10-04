#!/usr/bin/env node
// Proves that a TypeScript migration group changed no shipped behaviour, against a base ref.
// The base tree is rebuilt from `git archive` with a copy of this checkout's node_modules and
// regenerated, then three proofs run:
//   1. every browser bundle, skill script, shared runtime chunk and projected pipeline file
//      hashes the same;
//      a JavaScript file that differs passes as "comment-only" when it is token-identical, or as
//      "identifier-normalized" when it is token-identical once every function-local binding is
//      renamed to a canonical name, and the report names the tier;
//   2. each compiled .mjs is token-identical to the tracked .mjs it replaced at the base, after
//      esbuild re-emits both as ESM (comments and layout dropped, exports gathered into one list);
//   3. each generated .d.mts exports the same names and kinds as the hand-written declaration it
//      replaced, and every export is mutually assignable and identical.
// Projected files that changed outside the migrated modules are listed for review, not failed:
// their source diff is the evidence.
//
// Usage: node scripts/typescript/verify-migration.mjs --base <ref>
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { TYPESCRIPT_PROJECTS } from './compile-sources.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJECTION_MANIFESTS = 'packages/pipeline/lib/generated/domain-projections';
const posix = (path) => path.split(sep).join('/');
const isTypeScriptSource = (path) => path.endsWith('.mts') && !path.endsWith('.d.mts');
const isDeclaration = (path) => path.endsWith('.d.mts');
const isJavaScript = (path) => /\.(?:js|mjs)$/u.test(path);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export class MigrationProofError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MigrationProofError';
    this.code = code;
  }
}

function walkFiles(directory, accept) {
  const found = [];
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && accept(path)) found.push(path);
    }
  }
  return found.sort();
}

function git(root, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (allowFailure) return null;
    throw new MigrationProofError(
      'E_MIGRATION_GIT',
      `git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

const readAtRef = (root, ref, path) =>
  git(root, ['cat-file', '-e', `${ref}:${path}`], { allowFailure: true }) === null
    ? null
    : git(root, ['show', `${ref}:${path}`]);

// The same esbuild normalizes both sides, so its version never decides the outcome; the
// workspace's own copy is used so the comparison matches the one that emitted the module.
const esbuildByWorkspace = new Map();
function esbuildFor(root, path) {
  const [scope, workspace] = posix(relative(root, path)).split('/');
  const manifest = resolve(root, scope, workspace, 'package.json');
  const key = existsSync(manifest) ? manifest : resolve(root, 'package.json');
  if (!esbuildByWorkspace.has(key)) esbuildByWorkspace.set(key, createRequire(key)('esbuild'));
  return esbuildByWorkspace.get(key);
}

/**
 * Strip comments and layout so two files compare by their tokens alone. With `format: 'esm'`
 * esbuild also gathers inline `export` keywords into one trailing export list, the form
 * compile-sources emits, so export placement never decides the outcome.
 */
export function normalizeTokens(code, esbuild, { format } = {}) {
  return esbuild.transformSync(code, {
    loader: 'js',
    ...(format ? { format } : {}),
    minifyWhitespace: true,
    legalComments: 'none',
    charset: 'utf8',
  }).code;
}

function textDifference(left, right) {
  let offset = 0;
  while (offset < left.length && left[offset] === right[offset]) offset += 1;
  const context = (text) => JSON.stringify(text.slice(Math.max(0, offset - 40), offset + 40));
  return { offset, before: context(left), after: context(right) };
}

export function compareTokens(before, after, esbuild, options = {}) {
  const left = normalizeTokens(before, esbuild, options);
  const right = normalizeTokens(after, esbuild, options);
  if (left === right) return { identical: true, normalizedBytes: right.length };
  return {
    identical: false,
    normalizedBytes: right.length,
    firstDifference: textDifference(left, right),
  };
}

const Kind = ts.SyntaxKind;
const opensLocalScope = (node) => ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node);

/**
 * How an identifier token enters the canonical stream: a `key` keeps its text (property names,
 * labels, import and export names), a `binding` resolves to its declaration, and a `shorthand`
 * is both, so it is expanded to `key: binding` (`key as binding` in an import).
 */
function identifierRole(node) {
  const parent = node.parent;
  switch (parent.kind) {
    case Kind.PropertyAccessExpression:
    case Kind.PropertyAssignment:
    case Kind.MethodDeclaration:
    case Kind.PropertyDeclaration:
    case Kind.GetAccessor:
    case Kind.SetAccessor:
    case Kind.MetaProperty:
    case Kind.ImportAttribute:
      return parent.name === node ? 'key' : 'binding';
    case Kind.ShorthandPropertyAssignment:
      return parent.name === node ? 'shorthand' : 'binding';
    case Kind.BindingElement:
      if (parent.propertyName === node) return 'key';
      return parent.propertyName ||
        parent.dotDotDotToken ||
        parent.parent.kind !== Kind.ObjectBindingPattern
        ? 'binding'
        : 'shorthand';
    case Kind.ImportSpecifier:
      if (parent.propertyName === node) return 'key';
      return parent.propertyName ? 'binding' : 'shorthand';
    case Kind.ExportSpecifier:
    case Kind.NamespaceExport:
    case Kind.LabeledStatement:
    case Kind.BreakStatement:
    case Kind.ContinueStatement:
      return 'key';
    default:
      return 'binding';
  }
}

const usesDynamicScope = (node) =>
  node.kind === Kind.WithStatement ||
  (ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'eval');

function parseJavaScript(code, fileName) {
  const source = ts.createSourceFile(
    fileName,
    code,
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    true,
    ts.ScriptKind.JS,
  );
  const options = { allowJs: true, noLib: true, noResolve: true, noEmit: true, types: [] };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === fileName ? source : undefined);
  host.fileExists = (name) => name === fileName;
  host.readFile = (name) => (name === fileName ? code : undefined);
  const program = ts.createProgram({ rootNames: [fileName], options, host });
  const syntax = program.getSyntacticDiagnostics(source);
  if (syntax.length > 0)
    throw new MigrationProofError(
      'E_MIGRATION_PARSE',
      `Parsing ${fileName} for identifier normalization failed:\n${formatDiagnostics(syntax, repositoryRoot)}`,
    );
  return { source, checker: program.getTypeChecker() };
}

/**
 * The tokens of `code` with every binding declared inside a function renamed to `#<n>`, numbered
 * by first occurrence; each reference resolves to its binding by TypeScript's scope rules, so a
 * rebound or captured name changes the stream. Top-level bindings (script globals, module
 * imports and exports) and unresolved names keep their text. Returns null when `with` or a
 * direct `eval` makes scope dynamic.
 * A renamed function or class also changes its runtime `.name`, as esbuild's own renaming does.
 */
export function canonicalTokens(code, fileName = 'normalized.js') {
  const { source, checker } = parseJavaScript(code, fileName);
  const isLocal = (symbol) =>
    (symbol?.declarations?.length ?? 0) > 0 &&
    symbol.declarations.every(
      (declaration) =>
        declaration.getSourceFile() === source &&
        ts.findAncestor(declaration.parent, opensLocalScope) !== undefined,
    );
  const indexBySymbol = new Map();
  const stream = { tokens: [], labels: [], names: [] };
  const push = (token, label = token) => {
    stream.tokens.push(token);
    stream.labels.push(label);
  };
  const pushBinding = (symbol, text) => {
    if (!isLocal(symbol)) {
      push(text);
      return;
    }
    if (!indexBySymbol.has(symbol)) {
      indexBySymbol.set(symbol, stream.names.length);
      stream.names.push(text);
    }
    const index = indexBySymbol.get(symbol);
    push(`#${index}`, `${text}#${index}`);
  };
  const pushIdentifier = (node) => {
    const role = identifierRole(node);
    if (role === 'key') push(node.text);
    else if (role === 'binding') pushBinding(checker.getSymbolAtLocation(node), node.text);
    else {
      const parent = node.parent;
      push(node.text);
      push(parent.kind === Kind.ImportSpecifier ? 'as' : ':');
      pushBinding(
        parent.kind === Kind.ShorthandPropertyAssignment
          ? checker.getShorthandAssignmentValueSymbol(parent)
          : checker.getSymbolAtLocation(node),
        node.text,
      );
    }
  };
  let dynamicScope = false;
  const visit = (node) => {
    if (usesDynamicScope(node)) dynamicScope = true;
    if (node.kind === Kind.Identifier) {
      pushIdentifier(node);
      return;
    }
    const children = node.getChildren(source);
    for (const child of children) visit(child);
    if (children.length === 0) {
      const text = node.getText(source);
      if (text) push(text);
    }
  };
  visit(source);
  return dynamicScope ? null : stream;
}

const tokenWindow = (stream, index) =>
  JSON.stringify(stream.labels.slice(Math.max(0, index - 8), index + 8).join(' '));

/** Distinct `[before, after]` names of the bindings the canonical renaming paired. */
function renamedBindings(before, after) {
  const pairs = new Map();
  before.names.forEach((name, index) => {
    const other = after.names[index];
    if (name !== other) pairs.set(`${name}\0${other}`, [name, other]);
  });
  return [...pairs.values()];
}

export const ACCEPTED_TIERS = Object.freeze([
  'byte-identical',
  'comment-only',
  'identifier-normalized',
]);

/**
 * The most specific tier that proves two versions of a JavaScript file equivalent:
 * `byte-identical`, `comment-only` (token-identical) or `identifier-normalized` (token-identical
 * after canonical renaming of function-local bindings). Anything else is `different`, with the
 * first difference of the most permissive comparison that applied.
 */
export function compareJavaScript(before, after, esbuild, options = {}) {
  if (before === after) return { tier: 'byte-identical' };
  const left = normalizeTokens(before, esbuild, options);
  const right = normalizeTokens(after, esbuild, options);
  if (left === right) return { tier: 'comment-only' };
  const base = canonicalTokens(left, 'base.js');
  const head = canonicalTokens(right, 'head.js');
  if (!base || !head)
    return {
      tier: 'different',
      reason: 'identifier normalization does not apply to code that uses with or a direct eval',
      firstDifference: textDifference(left, right),
    };
  const length = Math.max(base.tokens.length, head.tokens.length);
  let index = 0;
  while (index < length && base.tokens[index] === head.tokens[index]) index += 1;
  if (index === length)
    return { tier: 'identifier-normalized', renamed: renamedBindings(base, head) };
  return {
    tier: 'different',
    firstDifference: {
      token: index,
      before: tokenWindow(base, index),
      after: tokenWindow(head, index),
    },
  };
}

const IDENTITY_HELPERS = [
  'type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;',
  'type Mutual<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false;',
];

function declarationOptions(root) {
  return {
    noEmit: true,
    strict: true,
    allowJs: false,
    skipLibCheck: false,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: ['node'],
    typeRoots: [resolve(root, 'node_modules/@types')],
  };
}

// Serves in-memory files beside the generated declaration, so their relative imports resolve
// on disk, and hides .mts sources so `./x.mjs` resolves to `x.d.mts` as it does for a consumer.
function virtualHost(options, virtualFiles) {
  const host = ts.createCompilerHost(options);
  const virtual = new Map([...virtualFiles].map(([path, text]) => [posix(path), text]));
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (fileName) =>
    virtual.has(posix(fileName)) || (!isTypeScriptSource(fileName) && fileExists(fileName));
  host.readFile = (fileName) => virtual.get(posix(fileName)) ?? readFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
    virtual.has(posix(fileName))
      ? ts.createSourceFile(fileName, virtual.get(posix(fileName)), languageVersion, true)
      : getSourceFile(fileName, languageVersion, onError, shouldCreate);
  return host;
}

function formatDiagnostics(diagnostics, root) {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  });
}

function exportedSymbols(program, path) {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(path);
  const module = source && checker.getSymbolAtLocation(source);
  if (!module) return [];
  return checker
    .getExportsOfModule(module)
    .map((symbol) => {
      const target =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const typeParameters = Math.max(
        0,
        ...(target.declarations ?? []).map((node) => node.typeParameters?.length ?? 0),
      );
      const value = (target.flags & ts.SymbolFlags.Value) !== 0;
      const type = (target.flags & ts.SymbolFlags.Type) !== 0;
      return {
        name: symbol.name,
        kind: value && type ? 'value+type' : value ? 'value' : 'type',
        typeParameters,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

const kindOf = ({ kind, typeParameters }) =>
  `${kind}${typeParameters > 0 ? ` with ${typeParameters} type parameter(s)` : ''}`;
const describeExport = (entry) => `${entry.name} (${kindOf(entry)})`;

/** Name and kind differences between two export surfaces, and the exports both share unchanged. */
function compareSurfaces(base, generated) {
  const byName = new Map(generated.map((entry) => [entry.name, entry]));
  const failures = [];
  const shared = [];
  const missing = [];
  for (const entry of base) {
    const other = byName.get(entry.name);
    if (!other) missing.push(entry);
    else if (other.kind !== entry.kind || other.typeParameters !== entry.typeParameters)
      failures.push(
        `${entry.name} is a ${kindOf(entry)} in the hand-written declaration but a ${kindOf(other)} in the generated one`,
      );
    else shared.push(entry);
  }
  const added = generated.filter((entry) => !base.some((other) => other.name === entry.name));
  if (missing.length > 0)
    failures.unshift(`generated declaration omits ${missing.map(describeExport).join(', ')}`);
  if (added.length > 0)
    failures.push(`generated declaration adds ${added.map(describeExport).join(', ')}`);
  return { failures, shared };
}

/**
 * A module that fails to compile once per unequal export. `checks` maps each assertion's line
 * to the export and relation it asserts, so a diagnostic can name what differs.
 */
function equivalenceProbe(stem, shared) {
  const lines = [
    ...IDENTITY_HELPERS,
    `import type * as base from './${stem}.verify-migration-base.mjs';`,
    `import type * as next from './${stem}.mjs';`,
  ];
  const checks = new Map();
  const notes = [];
  const assert = (subject, left, right) => {
    for (const [relation, helper] of [
      ['mutually assignable', 'Mutual'],
      ['identical', 'Equal'],
    ]) {
      checks.set(lines.length, `${subject} is not ${relation}`);
      lines.push(`export const check${lines.length}: ${helper}<${left}, ${right}> = true;`);
    }
  };
  for (const entry of shared) {
    if (entry.kind !== 'type')
      assert(`value ${entry.name}`, `typeof base.${entry.name}`, `typeof next.${entry.name}`);
    if (entry.kind === 'value') continue;
    const args =
      entry.typeParameters > 0 ? `<${Array(entry.typeParameters).fill('never').join(', ')}>` : '';
    if (args)
      notes.push(
        `${entry.name} compared with ${entry.typeParameters} type parameter(s) instantiated as never`,
      );
    assert(`type ${entry.name}`, `base.${entry.name}${args}`, `next.${entry.name}${args}`);
  }
  return { text: `${lines.join('\n')}\n`, checks, notes };
}

function describeProbeDiagnostic(diagnostic, { root, probePath, checks }) {
  const inProbe = diagnostic.file && posix(diagnostic.file.fileName) === posix(probePath);
  const check =
    inProbe && diagnostic.start !== undefined
      ? checks.get(ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start).line)
      : undefined;
  return check
    ? `${check} between the hand-written and generated declarations`
    : `type equivalence probe failed: ${formatDiagnostics([diagnostic], root).trim()}`;
}

/**
 * Compare a generated declaration on disk with the hand-written text it replaced: same export
 * names and kinds, then every export mutually assignable and identical. A generic type export
 * is compared with every parameter instantiated as `never`, which satisfies any constraint.
 */
export function compareDeclarations({ root = repositoryRoot, generatedPath, baseText }) {
  const directory = dirname(generatedPath);
  const stem = basename(generatedPath, '.d.mts');
  const basePath = join(directory, `${stem}.verify-migration-base.d.mts`);
  const probePath = join(directory, `${stem}.verify-migration.mts`);
  const options = declarationOptions(root);
  const surfaceProgram = ts.createProgram({
    rootNames: [basePath, generatedPath],
    options,
    host: virtualHost(options, [[basePath, baseText]]),
  });
  const base = exportedSymbols(surfaceProgram, basePath);
  const { failures, shared } = compareSurfaces(
    base,
    exportedSymbols(surfaceProgram, generatedPath),
  );
  const probe = equivalenceProbe(stem, shared);
  const probeProgram = ts.createProgram({
    rootNames: [probePath],
    options,
    host: virtualHost(options, [
      [basePath, baseText],
      [probePath, probe.text],
    ]),
  });
  for (const diagnostic of ts.getPreEmitDiagnostics(probeProgram))
    failures.push(describeProbeDiagnostic(diagnostic, { root, probePath, checks: probe.checks }));
  return { exports: base, assertions: probe.checks.size, failures, notes: probe.notes };
}

/** The .mts sources of every TypeScript project, with what the base ref tracked beside them. */
export function migratedSources({ root = repositoryRoot, baseRef }) {
  return TYPESCRIPT_PROJECTS.flatMap((project) => {
    const libRoot = resolve(root, project, 'lib');
    if (!existsSync(libRoot)) return [];
    return walkFiles(libRoot, isTypeScriptSource).map((path) => {
      const source = posix(relative(root, path));
      const stem = source.replace(/\.mts$/u, '');
      return {
        project,
        source,
        module: `${stem}.mjs`,
        declaration: `${stem}.d.mts`,
        migratedBefore: readAtRef(root, baseRef, source) !== null,
        baseModule: readAtRef(root, baseRef, `${stem}.mjs`),
        baseDeclaration: readAtRef(root, baseRef, `${stem}.d.mts`),
      };
    });
  });
}

// Every node_modules directory is copied (a copy-on-write clone where the filesystem allows)
// rather than symlinked: esbuild writes each bundled module's path into the bundle, resolved
// through symlinks, so a link back into this checkout would change the base bundle's bytes.
// The copy keeps npm's relative workspace links, which then point into the base tree.
function copyNodeModules(sourceRoot, targetRoot) {
  const candidates = ['node_modules'];
  for (const scope of ['packages', 'apps']) {
    const directory = resolve(sourceRoot, scope);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true }))
      if (entry.isDirectory()) candidates.push(join(scope, entry.name, 'node_modules'));
  }
  for (const candidate of candidates) {
    const source = resolve(sourceRoot, candidate);
    if (existsSync(source) && existsSync(resolve(targetRoot, dirname(candidate))))
      cpSync(source, resolve(targetRoot, candidate), {
        recursive: true,
        verbatimSymlinks: true,
        mode: constants.COPYFILE_FICLONE,
      });
  }
}

/** Extract the base commit, copy this checkout's dependencies in and run its generate graph. */
export function regenerateBaseTree({ root = repositoryRoot, baseSha }) {
  const scratch = mkdtempSync(join(tmpdir(), 'openplanr-verify-migration-'));
  const tree = join(scratch, 'tree');
  mkdirSync(tree);
  const archive = join(scratch, 'base.tar');
  execFileSync('git', ['archive', '--format=tar', '-o', archive, baseSha], { cwd: root });
  execFileSync('tar', ['-xf', archive, '-C', tree]);
  rmSync(archive);
  copyNodeModules(root, tree);
  const result = spawnSync(process.execPath, ['scripts/generate-all.mjs'], {
    cwd: tree,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    rmSync(scratch, { recursive: true, force: true });
    throw new MigrationProofError(
      'E_MIGRATION_BASE_GENERATE',
      `Regenerating the base tree ${baseSha.slice(0, 8)} failed (exit ${result.status}):\n${result.stderr}${result.stdout.split('\n').slice(-20).join('\n')}`,
    );
  }
  return { scratch, tree, summary: result.stdout.trim().split('\n').at(-1) };
}

function listBundles(tree) {
  const packages = resolve(tree, 'packages');
  if (!existsSync(packages)) return [];
  return readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(packages, entry.name, 'templates')))
    .flatMap((entry) =>
      walkFiles(join(packages, entry.name, 'templates'), (path) => path.endsWith('.js')),
    )
    .map((path) => posix(relative(tree, path)));
}

const isSkillBundle = (path) => /\.(?:mjs|js)(?:\.part-\d+|\.parts\.json)?$/u.test(path);

function declaredSkillBundles(tree, packageRoot) {
  const manifestPath = join(packageRoot, 'openplanr.skill.json');
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return (manifest.resources ?? []).flatMap((resource) => {
    if (!['script', 'asset'].includes(resource.kind) || !isSkillBundle(resource.path)) return [];
    if (
      typeof resource.path !== 'string' ||
      resource.path.includes('\\') ||
      resource.path.split('/').some((part) => !part || part === '.' || part === '..') ||
      resource.path.startsWith('/')
    )
      throw new MigrationProofError(
        'E_MIGRATION_SKILL_PATH',
        `Unsafe skill resource: ${String(resource.path)}`,
      );
    return [posix(relative(tree, resolve(packageRoot, resource.path)))];
  });
}

/** Canonical skill closures and their generated suite projections, including shared chunks. */
export function listSkillBundles(tree) {
  const paths = new Set();
  const skills = resolve(tree, 'skills');
  if (existsSync(skills)) {
    for (const entry of readdirSync(skills, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const path of declaredSkillBundles(tree, join(skills, entry.name))) paths.add(path);
    }
  }
  // Host package roots are generated from the same canonical inputs; the runtime directory
  // is deliberately outside each thin skill folder and must receive the same comparison.
  for (const target of ['dist/plugins', 'packages/cli/lib/host-packages']) {
    const directory = resolve(tree, target);
    if (!existsSync(directory)) continue;
    for (const path of walkFiles(directory, isSkillBundle)) paths.add(posix(relative(tree, path)));
  }
  return [...paths].sort();
}

function listProjectedFiles(tree) {
  const directory = resolve(tree, PROJECTION_MANIFESTS);
  if (!existsSync(directory)) return { files: [], sources: new Map() };
  const files = [];
  const sources = new Map();
  for (const name of readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .sort()) {
    const manifestPath = `${PROJECTION_MANIFESTS}/${name}`;
    files.push(manifestPath);
    const manifest = JSON.parse(readFileSync(join(directory, name), 'utf8'));
    for (const entry of manifest.entries ?? []) {
      const target = posix(join('packages/pipeline', entry.target));
      files.push(target);
      sources.set(target, entry.source);
    }
  }
  return { files, sources };
}

const hashAt = (tree, path) => {
  const absolute = resolve(tree, path);
  return existsSync(absolute) ? sha256(readFileSync(absolute)) : null;
};

/**
 * Compare one path across the base and head trees. `isNewDeclaration` marks the generated
 * declaration of a source migrated in this change that had none at the base.
 */
export function classify({ root, baseTree, path, isMigratedDeclaration, isNewDeclaration }) {
  const before = hashAt(baseTree, path);
  const after = hashAt(root, path);
  if (before === after) return { path, status: 'byte-identical', hash: after };
  if (before === null)
    return { path, status: isNewDeclaration ? 'new declaration' : 'added', hash: after };
  if (after === null) return { path, status: 'removed', hash: before };
  if (path.startsWith(`${PROJECTION_MANIFESTS}/`)) return { path, status: 'manifest', hash: after };
  if (isJavaScript(path)) {
    const comparison = compareJavaScript(
      readFileSync(resolve(baseTree, path), 'utf8'),
      readFileSync(resolve(root, path), 'utf8'),
      esbuildFor(root, resolve(root, path)),
      path.endsWith('.mjs') ? { format: 'esm' } : {},
    );
    return {
      path,
      status: comparison.tier,
      hash: after,
      renamed: comparison.renamed,
      reason: comparison.reason,
      firstDifference: comparison.firstDifference,
    };
  }
  if (isDeclaration(path) && isMigratedDeclaration)
    return { path, status: 'regenerated', hash: after };
  return { path, status: 'different', hash: after };
}

const describeDifference = ({ offset, token, before, after }) =>
  `(${token === undefined ? `offset ${offset}` : `token ${token}`}): ${before} vs ${after}`;

/** Proofs 2 and 3 for one migrated source: its compiled module and generated declaration. */
function proveSource(root, entry) {
  const compiledModule = resolve(root, entry.module);
  const compiledDeclaration = resolve(root, entry.declaration);
  for (const [label, path] of [
    ['module', compiledModule],
    ['declaration', compiledDeclaration],
  ])
    if (!existsSync(path))
      throw new MigrationProofError(
        'E_MIGRATION_OUTPUT_MISSING',
        `Compiled ${label} ${posix(relative(root, path))} is missing; run npm run generate first.`,
      );
  const failures = [];
  let module = { path: entry.module, status: 'new module (no predecessor at base)' };
  if (entry.baseModule !== null) {
    const tokens = compareTokens(
      entry.baseModule,
      readFileSync(compiledModule, 'utf8'),
      esbuildFor(root, compiledModule),
      { format: 'esm' },
    );
    module = {
      path: entry.module,
      status: tokens.identical ? 'token-identical' : 'different',
      normalizedBytes: tokens.normalizedBytes,
    };
    if (!tokens.identical)
      failures.push(
        `${entry.module} is not token-identical to the module it replaced ${describeDifference(tokens.firstDifference)}`,
      );
  }
  let declaration = { path: entry.declaration, status: 'new declaration (none at base)' };
  if (entry.baseDeclaration !== null) {
    const result = compareDeclarations({
      root,
      generatedPath: compiledDeclaration,
      baseText: entry.baseDeclaration,
    });
    declaration = {
      path: entry.declaration,
      status: result.failures.length === 0 ? 'equivalent' : 'different',
      exports: result.exports,
      assertions: result.assertions,
      notes: result.notes,
    };
    failures.push(...result.failures.map((failure) => `${entry.declaration}: ${failure}`));
  }
  return { module, declaration, failures };
}

/** Proof 1: hash every bundle and projected file in both trees. */
export function compareTrees(
  root,
  baseTree,
  migratedDeclarations = new Set(),
  newDeclarations = new Set(),
) {
  const bundlePaths = [...new Set([...listBundles(baseTree), ...listBundles(root)])].sort();
  const skillPaths = [
    ...new Set([...listSkillBundles(baseTree), ...listSkillBundles(root)]),
  ].sort();
  const baseProjection = listProjectedFiles(baseTree);
  const headProjection = listProjectedFiles(root);
  const projectedPaths = [...new Set([...baseProjection.files, ...headProjection.files])]
    .filter((path) => !bundlePaths.includes(path) && !skillPaths.includes(path))
    .sort();
  return {
    bundles: bundlePaths.map((path) =>
      classify({ root, baseTree, path, isMigratedDeclaration: false, isNewDeclaration: false }),
    ),
    skillBundles: skillPaths.map((path) =>
      classify({ root, baseTree, path, isMigratedDeclaration: false, isNewDeclaration: false }),
    ),
    projected: projectedPaths.map((path) => {
      const source = headProjection.sources.get(path) ?? baseProjection.sources.get(path) ?? '';
      return classify({
        root,
        baseTree,
        path,
        isMigratedDeclaration: migratedDeclarations.has(source),
        isNewDeclaration: newDeclarations.has(source),
      });
    }),
  };
}

/** Run every proof against `baseRef`; the report's `ok` is false when any proof fails. */
export function verifyMigration({ root = repositoryRoot, baseRef }) {
  const baseSha = git(root, ['rev-parse', '--verify', `${baseRef}^{commit}`]).trim();
  const failures = [];
  const modules = [];
  const declarations = [];
  const migratedDeclarations = new Set();
  const newDeclarations = new Set();
  for (const entry of migratedSources({ root, baseRef: baseSha })) {
    if (entry.migratedBefore) {
      modules.push({ path: entry.module, status: 'migrated before base' });
      continue;
    }
    const proof = proveSource(root, entry);
    modules.push(proof.module);
    declarations.push(proof.declaration);
    if (entry.baseDeclaration !== null) migratedDeclarations.add(entry.declaration);
    else newDeclarations.add(entry.declaration);
    failures.push(...proof.failures);
  }
  const base = regenerateBaseTree({ root, baseSha });
  let trees;
  try {
    trees = compareTrees(root, base.tree, migratedDeclarations, newDeclarations);
  } finally {
    rmSync(base.scratch, { recursive: true, force: true });
  }
  for (const bundle of [...trees.bundles, ...trees.skillBundles])
    if (!ACCEPTED_TIERS.includes(bundle.status))
      failures.push(
        `bundle ${bundle.path} is ${bundle.status}${bundle.reason ? ` (${bundle.reason})` : ''}${bundle.firstDifference ? ` ${describeDifference(bundle.firstDifference)}` : ''}`,
      );
  const reviewed = trees.projected.filter((entry) =>
    ['different', 'added', 'removed'].includes(entry.status),
  );
  return {
    ok: failures.length === 0,
    baseSha,
    baseGeneration: base.summary,
    modules,
    declarations,
    ...trees,
    reviewed,
    failures,
  };
}

const count = (entries, status) => entries.filter((entry) => entry.status === status).length;
const tierCounts = (entries) =>
  [...ACCEPTED_TIERS, 'different'].map((tier) => `${count(entries, tier)} ${tier}`).join(', ');
const row = (entry) => [
  `  ${entry.status.padEnd(21)} ${(entry.hash ?? '').slice(0, 12).padEnd(12)} ${entry.path}`,
  ...(entry.renamed ?? []).map(
    ([before, after]) => `  ${''.padEnd(34)} renamed local ${before} -> ${after}`,
  ),
];

function renderModules(modules) {
  return [
    `Compiled modules (${modules.length}):`,
    ...modules.map(
      (entry) =>
        `  ${entry.status.padEnd(16)} ${entry.path}${entry.normalizedBytes ? ` (${entry.normalizedBytes} normalized bytes)` : ''}`,
    ),
  ];
}

function renderDeclarations(declarations) {
  return [
    `Generated declarations (${declarations.length}):`,
    ...declarations.flatMap((entry) => [
      `  ${entry.status.padEnd(16)} ${entry.path}${entry.exports ? `: ${entry.exports.length} exports, ${entry.assertions} assertions` : ''}`,
      ...(entry.notes ?? []).map((note) => `                   note: ${note}`),
    ]),
  ];
}

function renderBundles(bundles, label = 'Bundles') {
  return [`${label} (${bundles.length}): ${tierCounts(bundles)}`, ...bundles.flatMap(row)];
}

function renderProjected(projected, reviewed) {
  const lines = [
    `Projected files (${projected.length}): ${tierCounts(projected)}, ${count(projected, 'regenerated')} regenerated from migrated sources, ${count(projected, 'new declaration')} new declarations of migrated sources, ${count(projected, 'manifest')} manifests, ${reviewed.length} to review`,
    ...projected.filter((entry) => entry.status !== 'byte-identical').flatMap(row),
  ];
  if (reviewed.length > 0)
    lines.push(
      '',
      'Changed outside the migrated modules; their source diff is the evidence:',
      ...reviewed.map((entry) => `  ${entry.status.padEnd(8)} ${entry.path}`),
    );
  return lines;
}

export function renderReport(report) {
  const lines = [
    `Base ${report.baseSha.slice(0, 8)}: ${report.baseGeneration}`,
    '',
    ...renderModules(report.modules),
    '',
    ...renderDeclarations(report.declarations),
    '',
    ...renderBundles(report.bundles),
    '',
    ...renderBundles(report.skillBundles ?? [], 'Skill bundles and shared chunks'),
    '',
    ...renderProjected(report.projected, report.reviewed),
    '',
  ];
  if (report.ok) lines.push('Migration proofs hold.');
  else
    lines.push('Migration proofs FAILED:', ...report.failures.map((failure) => `  - ${failure}`));
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  let baseRef = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base' && argv[index + 1]) {
      baseRef = argv[index + 1];
      index += 1;
    } else {
      throw new MigrationProofError(
        'E_MIGRATION_ARGUMENT',
        `Unsupported argument ${argv[index]}. Usage: node scripts/typescript/verify-migration.mjs --base <ref>`,
      );
    }
  }
  if (!baseRef)
    throw new MigrationProofError(
      'E_MIGRATION_ARGUMENT',
      'Missing --base <ref>. Usage: node scripts/typescript/verify-migration.mjs --base <ref>',
    );
  return { baseRef };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const report = verifyMigration(parseArgs(process.argv.slice(2)));
    process.stdout.write(renderReport(report));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error?.code ?? 'E_MIGRATION'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
