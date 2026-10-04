import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { relative, resolve, sep } from 'node:path';
import { Script } from 'node:vm';

/** Ceiling for one readable source unit within supported plugin package limits. */
export const RUNTIME_SOURCE_UNIT_BYTES = 192 * 1024;
export const RUNTIME_SOURCES_KIND = 'openplanr-runtime-asset-sources';

/**
 * Statements of the ReactDOM client factory, grouped by reconciler responsibility.
 * Each group starts at the top-level declaration named here, in source order.
 */
const REACT_DOM_CLIENT_GROUPS = Object.freeze([
  ['fiber-foundations', null],
  ['reconciliation-hooks', 'createChildReconciler'],
  ['render-phases', 'classComponentUpdater'],
  ['commit-effects', 'commitHookEffectListMount'],
  ['work-loop-scheduling', 'executionContext'],
  ['dom-events-properties-hydration', 'coerceFormActionProp'],
  ['public-roots', 'FiberRootNode'],
]);

/** Single statements too large for one unit, split inside their own function body. */
const NESTED_SCOPES = Object.freeze({
  require_react_dom_client_production: Object.freeze({
    id: 'react-dom-client',
    input: 'node_modules/react-dom/cjs/react-dom-client.production.js',
    groups: REACT_DOM_CLIENT_GROUPS,
  }),
});

/** Responsibility of one bundled input, from its repository-relative path. */
function responsibility(input) {
  if (input === null) return 'module-runtime';
  if (/^node_modules\/(?:react|react-dom|scheduler)\//u.test(input)) return 'react';
  if (input.startsWith('node_modules/pako/')) return 'compression';
  if (input.startsWith('node_modules/')) return 'interface-primitives';
  if (input.startsWith('packages/protocol/')) return 'protocol-contracts';
  if (/^packages\/artifact\/lib\/artifact\/ui\/(?:studio-shell|prototype-state)/u.test(input))
    return 'studio-shell';
  if (input.startsWith('packages/artifact/lib/artifact/ui/')) return 'artifact-review-ui';
  if (input.startsWith('packages/artifact/lib/artifact/')) return 'artifact-sharing';
  if (input.startsWith('packages/design/lib/design/ui/studio')) return 'design-studio';
  if (input.startsWith('packages/design/lib/design/')) return 'design-review-experience';
  throw new Error(`Runtime source input has no declared responsibility: ${input}`);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const byteLength = (value) => Buffer.byteLength(value, 'utf8');

function declaredNames(ts, statement) {
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations
      .filter(({ name }) => ts.isIdentifier(name))
      .map(({ name }) => name.text);
  return statement.name && ts.isIdentifier(statement.name) ? [statement.name.text] : [];
}

/** The function body holding a bundle's statements: `(() => {…})()` or `var X = (() => {…})()`. */
function bundleBody(ts, file) {
  for (const statement of file.statements) {
    let call = ts.isExpressionStatement(statement) ? statement.expression : null;
    if (ts.isVariableStatement(statement))
      call = statement.declarationList.declarations[0]?.initializer ?? null;
    if (!call || !ts.isCallExpression(call) || call.arguments.length) continue;
    const callee = ts.isParenthesizedExpression(call.expression)
      ? call.expression.expression
      : call.expression;
    if (ts.isArrowFunction(callee) && ts.isBlock(callee.body)) return callee.body;
  }
  throw new Error('Runtime asset is not one bundled function scope.');
}

function largestBlock(ts, node) {
  let largest = null;
  const visit = (child) => {
    if (ts.isBlock(child) && (!largest || child.end - child.pos > largest.end - largest.pos))
      largest = child;
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  if (!largest?.statements.length) throw new Error('Nested runtime scope has no statements.');
  return largest;
}

/**
 * Split one generated classic script into complete, readable statement units.
 * Units follow statement order and lexical scope; joining scope text and units
 * reproduces the input bytes exactly. Generation-only: this uses the TypeScript parser.
 */
export function splitRuntimeAssetSources({
  asset,
  text,
  packageRoot,
  repoRoot,
  maxUnitBytes = RUNTIME_SOURCE_UNIT_BYTES,
}) {
  if (!/^[a-z0-9][a-z0-9.-]*\.js$/u.test(asset))
    throw new Error(`Runtime asset name is invalid: ${asset}`);
  const ts = createRequire(resolve(repoRoot, 'package.json'))('typescript');
  const file = ts.createSourceFile(asset, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics?.length)
    throw new Error(`${asset} does not parse: ${file.parseDiagnostics[0].messageText}`);
  const inputOf = (comment) => {
    const path = relative(repoRoot, resolve(packageRoot, comment)).split(sep).join('/');
    const dependency = path.lastIndexOf('node_modules/');
    if (dependency !== -1) return path.slice(dependency);
    if (!path.startsWith('../')) return path;
    // A workspace linked from outside the checkout keeps its repository-relative identity.
    const workspace = path.lastIndexOf('/packages/');
    if (workspace === -1)
      throw new Error(`${asset} bundles an input outside the repository: ${path}`);
    return path.slice(workspace + 1);
  };
  const scopes = [];
  const units = [];
  let input = null;

  const addScope = (id, parent, block, outer) => {
    const statements = [...block.statements];
    // A trailing return belongs to its function, so every unit is also a complete script.
    const last = statements.at(-1);
    const end = ts.isReturnStatement(last) ? last.pos : last.end;
    if (ts.isReturnStatement(last)) statements.pop();
    scopes.push({
      id,
      parent,
      open: text.slice(outer.pos, statements[0].pos),
      close: text.slice(end, outer.end),
    });
    return statements;
  };

  const emit = (scope, responsibilityId, statements, inputs) => {
    let start = 0;
    while (start < statements.length) {
      let end = start;
      let bytes = 0;
      // Prefer ending a part where one bundled input ends and the next begins.
      let inputBoundary = null;
      while (end < statements.length) {
        const size = byteLength(text.slice(statements[end].pos, statements[end].end));
        if (bytes + size > maxUnitBytes) break;
        bytes += size;
        end += 1;
        if (end < statements.length && inputs[end] !== inputs[end - 1]) inputBoundary = end;
      }
      if (end === start)
        throw new Error(`${asset} has a statement larger than ${maxUnitBytes} bytes.`);
      if (end < statements.length && inputBoundary !== null && inputBoundary > start)
        end = inputBoundary;
      units.push({
        scope,
        responsibility: responsibilityId,
        inputs: [...new Set(inputs.slice(start, end))].filter((value) => value !== null).sort(),
        text: text.slice(statements[start].pos, statements[end - 1].end),
      });
      start = end;
    }
  };

  const rootStatements = addScope('bundle', null, bundleBody(ts, file), {
    pos: 0,
    end: text.length,
  });
  let group = null;
  const flush = () => {
    if (group) emit('bundle', group.responsibility, group.statements, group.inputs);
    group = null;
  };
  for (const statement of rootStatements) {
    const comments = [
      ...text
        .slice(statement.pos, statement.getStart(file))
        .matchAll(/^[ \t]*\/\/ ((?:\.\.\/)*(?:[\w@.-]+\/)+[\w@.-]+\.[cm]?[jt]s)$/gmu),
    ];
    if (comments.length) input = inputOf(comments.at(-1)[1]);
    const nested = declaredNames(ts, statement)
      .filter((name) => Object.hasOwn(NESTED_SCOPES, name))
      .map((name) => NESTED_SCOPES[name])[0];
    if (nested) {
      flush();
      if (input !== nested.input)
        throw new Error(`${asset} nested scope ${nested.id} does not come from ${nested.input}.`);
      const statements = addScope(nested.id, 'bundle', largestBlock(ts, statement), statement);
      const starts = nested.groups.map(([id, anchor]) => {
        if (anchor === null) return { id, index: 0 };
        const matches = statements
          .map((candidate, index) => (declaredNames(ts, candidate).includes(anchor) ? index : -1))
          .filter((index) => index !== -1);
        if (matches.length !== 1)
          throw new Error(
            `${asset} ${nested.id} anchor ${anchor} matched ${matches.length} times.`,
          );
        return { id, index: matches[0] };
      });
      starts.forEach(({ id, index }, position) => {
        const next = starts[position + 1]?.index ?? statements.length;
        if (next <= index) throw new Error(`${asset} ${nested.id} groups are out of order.`);
        const slice = statements.slice(index, next);
        emit(
          nested.id,
          `${nested.id}-${id}`,
          slice,
          slice.map(() => nested.input),
        );
      });
      continue;
    }
    const size = byteLength(text.slice(statement.pos, statement.end));
    if (size > maxUnitBytes)
      throw new Error(
        `${asset} statement ${declaredNames(ts, statement).join(', ') || '(anonymous)'} is ${size} bytes; declare a nested scope.`,
      );
    const label = responsibility(input);
    if (group?.responsibility !== label) {
      flush();
      group = { responsibility: label, statements: [], inputs: [] };
    }
    group.statements.push(statement);
    group.inputs.push(input);
  }
  flush();

  const width = Math.max(2, String(units.length).length);
  const directory = `${asset}.sources`;
  const sources = units.map((unit, index) => ({
    ...unit,
    path: `${directory}/${String(index + 1).padStart(width, '0')}-${unit.responsibility}.js`,
  }));
  const manifest = {
    kind: RUNTIME_SOURCES_KIND,
    schemaVersion: '1.0.0',
    asset,
    bytes: byteLength(text),
    sha256: sha256(text),
    scopes,
    sources: sources.map(({ path, scope, responsibility: role, inputs, text: unit }) => ({
      path,
      scope,
      responsibility: role,
      inputs,
      bytes: byteLength(unit),
      sha256: sha256(unit),
    })),
  };
  const assembled = assembleRuntimeSources(manifest, (path) =>
    Buffer.from(sources.find((source) => source.path === path).text, 'utf8'),
  );
  if (!assembled.equals(Buffer.from(text, 'utf8')))
    throw new Error(`${asset} source units do not reassemble to the bundled bytes.`);
  for (const source of sources) verifyRuntimeSourceUnit(manifest, source.path, source.text);
  return {
    manifest: `${JSON.stringify(manifest, null, 2)}\n`,
    files: sources.map(({ path, text: unit }) => ({ path, bytes: Buffer.from(unit, 'utf8') })),
  };
}

function scopeChain(manifest, id) {
  const chain = [];
  for (let current = id; current !== null; ) {
    const scope = manifest.scopes.find((candidate) => candidate.id === current);
    if (!scope || chain.includes(scope)) throw new Error(`Runtime scope ${current} is invalid.`);
    chain.unshift(scope);
    current = scope.parent;
  }
  return chain;
}

/** Join units in order, opening and closing their declared scopes; units are never evaluated. */
export function assembleRuntimeSources(manifest, readSource) {
  const parts = [];
  const open = [];
  const closed = new Set();
  for (const source of manifest.sources) {
    const chain = scopeChain(manifest, source.scope);
    while (open.length && !chain.includes(open.at(-1))) {
      const scope = open.pop();
      closed.add(scope.id);
      parts.push(Buffer.from(scope.close, 'utf8'));
    }
    for (const scope of chain.slice(open.length)) {
      if (closed.has(scope.id)) throw new Error(`Runtime scope ${scope.id} is not contiguous.`);
      open.push(scope);
      parts.push(Buffer.from(scope.open, 'utf8'));
    }
    parts.push(readSource(source.path));
  }
  while (open.length) parts.push(Buffer.from(open.pop().close, 'utf8'));
  return Buffer.concat(parts);
}

/** Compile one unit alone and inside its declared scope, without running it. */
export function verifyRuntimeSourceUnit(manifest, path, text) {
  const source = manifest.sources.find((candidate) => candidate.path === path);
  if (!source) throw new Error(`${path} is not a declared runtime source.`);
  const chain = scopeChain(manifest, source.scope);
  new Script(text, { filename: path });
  new Script(
    `${chain.map(({ open }) => open).join('')}${text}${chain
      .reverse()
      .map(({ close }) => close)
      .join('')}`,
    { filename: path },
  );
}
