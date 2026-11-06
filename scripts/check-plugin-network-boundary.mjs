#!/usr/bin/env node
/**
 * Holds the generated host plugins to a design-free boundary: no environment, home or browser
 * storage reads, no sends to anything but proven-local destinations, no share or Figma hosts.
 * Rules run on the TypeScript AST of every script, so aliases and computed access are seen.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN_ROOTS = Object.freeze([
  'dist/plugins/claude/openplanr',
  'dist/plugins/openai/openplanr',
  'dist/plugins/cursor/openplanr',
]);
const ALLOWLIST = 'scripts/plugin-network-boundary-allowlist.json';
const BASELINE = 'scripts/plugin-network-boundary-baseline.json';
const SCRIPT = new Set(['.mjs', '.js', '.cjs']);
const CODE = new Set([...SCRIPT, '.json', '.html', '.css']);
const PROSE = new Set([...CODE, '.md', '.mdc', '.yaml', '.yml']);
const SHELL = new Set(['.sh']);
const SCANNED = new Set([...PROSE, ...SHELL]);
const MANIFESTS = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'manifest.json'];

const READS = new Set(['env-read', 'home-read', 'browser-storage']);
const SENDS = new Set(['network-send', 'env-forward']);
const OTHER_RULES =
  'dynamic-code share-host figma-host figma-token credential-forward plugin-anchor';
export const RULES = Object.freeze([...READS, ...SENDS, ...OTHER_RULES.split(' ')]);

const SHARE_HOST = /share\.openplanr\.dev|OPENPLANR_SHARE_BASE/gu;
const FIGMA_HOST = /\b(?:[a-z0-9-]+\.)*figma\.com\b/giu;
const FIGMA_TOKEN = /FIGMA_TOKEN|X-Figma-Token|\bfigd_/giu;
const SHELL_SEND = /\b(?:curl|wget|nc|ncat|socat|ssh|scp|rsync)\b|\/dev\/(?:tcp|udp)\//gu;
const SHELL_HOME = /\$\{?HOME\b|(?:^|[\s"'=])~\//gmu;
const SHELL_ENV =
  /(?:^|[;&|(]\s*)(?:printenv|env)\b|\$\{?[A-Za-z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTH)[A-Za-z_]*/gmu;
const CREDENTIAL_FILE =
  /^~\/|(?:^|[/\\])(?:\.netrc|\.npmrc|\.git-credentials|tokens\.json|credentials\.json|auth\.json)$/u;
const STORAGE = new Set(['localStorage', 'sessionStorage', 'indexedDB', 'cookieStore']);
const GLOBALS = new Set(['globalThis', 'window', 'self']);
const NETWORK_MODULES = new Set(['http', 'https', 'http2', 'net', 'tls', 'dgram']);
const CLIENT_LIBRARIES = new Set(['undici', 'axios', 'node-fetch', 'ws', 'got']);
const NETWORK_CALLS = new Set(['request', 'get', 'connect', 'createConnection', 'Socket']);
const SPAWNS = new Set('spawn spawnSync exec execSync execFile execFileSync fork'.split(' '));
const NUMBER_CALLS = new Set(['Number', 'parseInt', 'Number.parseInt', 'Math.trunc']);

const moduleName = (text) => text.replace(/^node:/u, '');
const lineOf = (file, node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
const literalText = (node) => {
  const parts = node && stringParts(node);
  return parts?.length === 1 ? parts[0] : undefined;
};
/** `a.b.c` for identifiers and property or literal-key element access, else undefined. */
const dotted = (node) => {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return dotted(node.expression);
  const key = ts.isPropertyAccessExpression(node)
    ? node.name.text
    : ts.isElementAccessExpression(node)
      ? literalText(node.argumentExpression)
      : undefined;
  const owner = key === undefined ? undefined : dotted(node.expression);
  return owner && `${owner}.${key}`;
};
/** Drops a `globalThis.`, `window.` or `self.` prefix. */
const bare = (name) => name?.replace(/^(?:(?:globalThis|window|self)\.)+/u, '');

/** True when `node` is a name in a declaration, property key or member name, not a value read. */
function isNameOnly(node) {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) ||
    ((ts.isFunctionDeclaration(parent) || ts.isParameter(parent)) && parent.name === node) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent)
  );
}

const declared = new WeakMap();
/** True when the file declares `name` itself, so the global of that name is shadowed. */
function isShadowed(file, name) {
  if (!declared.has(file)) {
    const names = new Set();
    const visit = (node) => {
      if (ts.isIdentifier(node) && isNameOnly(node) && !ts.isPropertyAccessExpression(node.parent))
        names.add(node.text);
      if (ts.isImportClause(node) && node.name) names.add(node.name.text);
      ts.forEachChild(node, visit);
    };
    visit(file);
    declared.set(file, names);
  }
  return declared.get(file).has(name);
}

function rawParts(node, top) {
  if (ts.isParenthesizedExpression(node)) return rawParts(node.expression, top);
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isTemplateExpression(node))
    return [
      node.head.text,
      ...node.templateSpans.flatMap((span) => [
        ...(rawParts(span.expression, false) ?? [span.expression]),
        span.literal.text,
      ]),
    ];
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.PlusToken)
    return undefined;
  const left = rawParts(node.left, false);
  const right = rawParts(node.right, false);
  return top && !left && !right
    ? undefined
    : [...(left ?? [node.left]), ...(right ?? [node.right])];
}

/** Splits a string, template or `+` chain into `[text, expression, text, …]`, folding literals. */
function stringParts(node) {
  const raw = rawParts(node, true);
  if (!raw) return undefined;
  const parts = [''];
  for (const part of raw)
    if (typeof part === 'string') parts[parts.length - 1] += part;
    else parts.push(part, '');
  return parts;
}

/** A port is proven when it is a number literal, a numeric coercion, or an integer-checked name. */
function isNumericPort(node, file) {
  if (!node || typeof node === 'string') return false;
  if (ts.isNumericLiteral(node)) return true;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.PlusToken) return true;
  if (ts.isCallExpression(node) && NUMBER_CALLS.has(dotted(node.expression))) return true;
  if (!ts.isIdentifier(node)) return false;
  let proven = false;
  const visit = (candidate) => {
    if (proven) return;
    if (
      ts.isVariableDeclaration(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === node.text &&
      candidate.initializer &&
      ts.getCombinedNodeFlags(candidate) & ts.NodeFlags.Const &&
      candidate.initializer !== node
    )
      proven = isNumericPort(candidate.initializer, file);
    if (
      ts.isCallExpression(candidate) &&
      dotted(candidate.expression) === 'Number.isInteger' &&
      candidate.arguments[0] &&
      ts.isIdentifier(candidate.arguments[0]) &&
      candidate.arguments[0].text === node.text
    )
      proven = true;
    ts.forEachChild(candidate, visit);
  };
  let scope = node.parent;
  while (scope && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
  visit(scope ?? file);
  return proven;
}

const LOOPBACK = /^(?:http|ws):\/\/127\.0\.0\.1(?::\d{1,5})?(?:[/?#]|$)/u;
const LOOPBACK_PATH = /^(?:http|ws):\/\/127\.0\.0\.1(?::\d{1,5})?[/?#]/u;
const LOOPBACK_PORT = /^(?:http|ws):\/\/127\.0\.0\.1:$/u;
const sameOrigin = (node, file, names) =>
  names.includes(bare(dotted(node)) ?? '') && !isShadowed(file, bare(dotted(node)).split('.')[0]);

/** Proves a destination local: a relative path, same-origin, or literal 127.0.0.1 with a proven port. */
export function isLocalDestination(node, file) {
  if (!node) return false;
  if (ts.isNewExpression(node) && bare(dotted(node.expression)) === 'URL') {
    const [path, base] = node.arguments ?? [];
    return (
      isLocalDestination(path, file) &&
      sameOrigin(base, file, ['location.href', 'location.origin', 'document.baseURI'])
    );
  }
  const parts = stringParts(node);
  if (!parts) return false;
  const [head, first, rest] = parts;
  const literal = parts.length === 1;
  if (head === '') return sameOrigin(first, file, ['location.origin']) && /^\//u.test(rest);
  if (/^(?:\/(?!\/)|\.\.?\/)/u.test(head))
    return !head.includes('\\') && (literal || /[^/\\]/u.test(head));
  if (literal) return LOOPBACK.test(head);
  return (
    LOOPBACK_PATH.test(head) ||
    (LOOPBACK_PORT.test(head) &&
      isNumericPort(first, file) &&
      (/^[/?#]/u.test(rest) || (rest === '' && parts.length === 3)))
  );
}

function isLocalSocketOptions(node, file) {
  if (!node || !ts.isObjectLiteralExpression(node)) return false;
  const value = (name) =>
    node.properties.find(
      (property) => ts.isPropertyAssignment(property) && property.name.getText(file) === name,
    )?.initializer;
  const host = value('hostname') ?? value('host');
  const port = value('port');
  return (
    Boolean(host && ts.isStringLiteralLike(host) && host.text === '127.0.0.1') &&
    Boolean(port && isNumericPort(port, file))
  );
}

/** Explicit `env` that neither is nor spreads `process.env`; anything else inherits it. */
function hasExplicitEnvironment(call, file) {
  const options = call.arguments.find(ts.isObjectLiteralExpression);
  const env = options?.properties.find(
    (property) => ts.isPropertyAssignment(property) && property.name.getText(file) === 'env',
  )?.initializer;
  return Boolean(
    env &&
      ts.isObjectLiteralExpression(env) &&
      !env.properties.some((property) => ts.isSpreadAssignment(property)),
  );
}

/** The module a literal `import()`, `require()` or `process.getBuiltinModule()` loads. */
function moduleOf(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node)))
    node = node.expression;
  if (!node || !ts.isCallExpression(node)) return undefined;
  const loader =
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    ['require', 'process.getBuiltinModule'].includes(bare(dotted(node.expression)));
  const specifier = loader ? literalText(node.arguments[0]) : undefined;
  return specifier === undefined ? undefined : moduleName(specifier);
}

/** Records `name` as a binding of `imported` (or `*` for the whole module) from `source`. */
function bindingsOf(node, file, bind) {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    const source = moduleName(node.moduleSpecifier.text);
    const clause = node.importClause;
    const named = clause?.namedBindings;
    if (clause?.name) bind(clause.name.text, source, '*');
    if (named && ts.isNamespaceImport(named)) bind(named.name.text, source, '*');
    for (const element of named && ts.isNamedImports(named) ? named.elements : [])
      bind(element.name.text, source, (element.propertyName ?? element.name).text);
    return;
  }
  if (!ts.isVariableDeclaration(node) || !node.initializer) return;
  const source =
    moduleOf(node.initializer) ??
    (bare(dotted(node.initializer)) === 'process' ? 'process' : undefined);
  if (source === undefined) return;
  if (ts.isIdentifier(node.name)) bind(node.name.text, source, '*');
  else if (ts.isObjectBindingPattern(node.name))
    for (const element of node.name.elements)
      bind(
        element.name.getText(file),
        source,
        (element.propertyName ?? element.name).getText(file),
      );
}

function importedSpecifier(node) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
    return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
  const dynamic =
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword || dotted(node.expression) === 'require');
  return dynamic ? literalText(node.arguments[0]) : undefined;
}

const ENV_OWNERS = new Set(['process', 'import.meta', 'Deno', 'Bun']);
const isProcess = (node, member) =>
  ENV_OWNERS.has(
    node.kind === ts.SyntaxKind.MetaProperty ? 'import.meta' : (bare(dotted(node)) ?? ''),
  ) ||
  moduleOf(node) === 'process' ||
  (member(node)?.source === 'process' && member(node).imported === '*');

function envRead(node, file, member) {
  const key = ts.isPropertyAccessExpression(node)
    ? node.name.text
    : ts.isElementAccessExpression(node)
      ? literalText(node.argumentExpression)
      : undefined;
  if (key === 'env' && isProcess(node.expression, member)) return node.getText(file).slice(0, 40);
  if (
    ts.isCallExpression(node) &&
    ['Reflect.get', 'Object.getOwnPropertyDescriptor'].includes(dotted(node.expression)) &&
    node.arguments[0] &&
    isProcess(node.arguments[0], member) &&
    literalText(node.arguments[1]) === 'env'
  )
    return dotted(node.expression);
  if (
    ts.isBindingElement(node) &&
    (node.propertyName ?? node.name).getText(file) === 'env' &&
    ts.isVariableDeclaration(node.parent.parent) &&
    node.parent.parent.initializer &&
    isProcess(node.parent.parent.initializer, member)
  )
    return 'const { env } = process';
  if (
    ts.isImportSpecifier(node) &&
    moduleName(node.parent.parent.parent.moduleSpecifier.text) === 'process' &&
    (node.propertyName ?? node.name).text === 'env'
  )
    return "import { env } from 'process'";
  return undefined;
}

function homeRead(node, file, member) {
  const callee = ts.isCallExpression(node) ? node.expression : undefined;
  const name =
    callee && (dotted(callee) ?? `${member(callee)?.source}.${member(callee)?.imported}`);
  if (name && /(?:^|\.)(?:homedir|userInfo)$/u.test(name)) return `${name}()`;
  if (ts.isStringLiteralLike(node) && CREDENTIAL_FILE.test(node.text))
    return JSON.stringify(node.text).slice(0, 40);
  return undefined;
}

function storageRead(node) {
  if (ts.isIdentifier(node))
    return STORAGE.has(node.text) && !isNameOnly(node) ? node.text : undefined;
  const name = dotted(node);
  const global = name !== undefined && bare(name) !== name;
  return (global && STORAGE.has(bare(name))) || bare(name) === 'document.cookie' ? name : undefined;
}

function webSend(node, file) {
  const name = dotted(node);
  const isFetch =
    (ts.isIdentifier(node) && node.text === 'fetch' && !isNameOnly(node)) ||
    (!ts.isIdentifier(node) && name !== 'fetch' && bare(name) === 'fetch');
  if (isFetch) {
    const call = node.parent;
    if (!ts.isCallExpression(call) || call.expression !== node) return 'fetch reference';
    const [target] = call.arguments;
    return isLocalDestination(target, file)
      ? undefined
      : `fetch(${target?.getText(file).slice(0, 48) ?? ''})`;
  }
  const kind = ts.isNewExpression(node) ? bare(dotted(node.expression)) : undefined;
  if (kind === 'XMLHttpRequest') return 'new XMLHttpRequest';
  if (
    (kind === 'WebSocket' || kind === 'EventSource') &&
    !isLocalDestination(node.arguments?.[0], file)
  )
    return `new ${kind}`;
  if (
    ts.isCallExpression(node) &&
    bare(dotted(node.expression)) === 'navigator.sendBeacon' &&
    !isLocalDestination(node.arguments[0], file)
  )
    return 'navigator.sendBeacon';
  return undefined;
}

function socketSend(node, file, member) {
  const called =
    ts.isCallExpression(node) || ts.isNewExpression(node) ? member(node.expression) : undefined;
  if (!called || !NETWORK_MODULES.has(called.source) || !NETWORK_CALLS.has(called.imported))
    return undefined;
  const [first, second] = node.arguments ?? [];
  const local =
    isLocalDestination(first, file) ||
    isLocalSocketOptions(first, file) ||
    (isNumericPort(first, file) && literalText(second) === '127.0.0.1');
  return local ? undefined : `${called.source}.${called.imported}`;
}

function childProcess(node, file, member) {
  const access = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
  if (!(ts.isIdentifier(node) || access) || isNameOnly(node)) return undefined;
  const spawn = member(node);
  if (spawn?.source !== 'child_process' || !SPAWNS.has(spawn.imported)) return undefined;
  const call = node.parent;
  const explicit =
    ts.isCallExpression(call) && call.expression === node && hasExplicitEnvironment(call, file);
  return explicit ? undefined : `${spawn.imported} inherits the environment`;
}

function dynamicCode(node) {
  const name = bare(dotted(node));
  if (name === 'eval' && !(ts.isIdentifier(node) && isNameOnly(node))) return 'eval';
  if (
    (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
    bare(dotted(node.expression)) === 'Function'
  )
    return 'Function';
  const loader =
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword || dotted(node.expression) === 'require');
  return loader && literalText(node.arguments[0]) === undefined
    ? 'computed module specifier'
    : undefined;
}

function concatenatedShareHost(node) {
  const expression = ts.isBinaryExpression(node) || ts.isTemplateExpression(node);
  const nested =
    expression && (ts.isBinaryExpression(node.parent) || ts.isTemplateSpan(node.parent));
  return expression && !nested && /share\.openplanr\.dev/u.test(literalText(node) ?? '')
    ? 'concatenated share host'
    : undefined;
}

/** Every read and send signal in one script, with its line, and the files it imports. */
export function scriptSignals(text, path) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const bindings = new Map();
  const collect = (node) => {
    bindingsOf(node, file, (name, source, imported) => bindings.set(name, { source, imported }));
    ts.forEachChild(node, collect);
  };
  collect(file);
  const member = (node) => {
    if (ts.isIdentifier(node)) return bindings.get(node.text);
    const key = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node)
        ? literalText(node.argumentExpression)
        : undefined;
    if (key === undefined) return undefined;
    const owner = ts.isIdentifier(node.expression)
      ? bindings.get(node.expression.text)
      : { source: moduleOf(node.expression), imported: '*' };
    return owner?.source && owner.imported === '*'
      ? { source: owner.source, imported: key }
      : undefined;
  };
  const detectors = [
    ['env-read', envRead],
    ['home-read', homeRead],
    ['browser-storage', storageRead],
    ['network-send', webSend],
    ['network-send', socketSend],
    ['env-forward', childProcess],
    ['dynamic-code', dynamicCode],
    ['share-host', concatenatedShareHost],
  ];
  const signals = [];
  const imports = [];
  const visit = (node) => {
    const specifier = importedSpecifier(node);
    if (specifier !== undefined) imports.push(specifier);
    const evidence = [
      ...detectors.map(([rule, detect]) => [rule, detect(node, file, member)]),
      [
        'network-send',
        CLIENT_LIBRARIES.has(moduleName(specifier ?? '')) ? `import ${specifier}` : undefined,
      ],
    ];
    for (const [rule, what] of evidence) {
      if (what === undefined) continue;
      const line = lineOf(file, node);
      signals.push({ rule, line, evidence: `${what} :${line}` });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { signals, imports };
}

function textSignals(text, extension) {
  const found = [];
  const match = (rule, pattern, extensions) => {
    if (!extensions.has(extension)) return;
    for (const hit of text.matchAll(pattern)) {
      const line = text.slice(0, hit.index).split('\n').length;
      found.push({ rule, line, evidence: `${hit[0]} :${line}` });
    }
  };
  match('share-host', SHARE_HOST, CODE);
  match('figma-host', FIGMA_HOST, PROSE);
  match('figma-token', FIGMA_TOKEN, PROSE);
  match('share-host', SHARE_HOST, SHELL);
  match('network-send', SHELL_SEND, SHELL);
  match('home-read', SHELL_HOME, SHELL);
  match('env-read', SHELL_ENV, SHELL);
  return found;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}

/** Files reachable from `entry` through relative imports. */
function closure(entry, graph) {
  const seen = new Set([entry]);
  for (const path of seen) for (const next of graph.get(path) ?? []) seen.add(next);
  return [...seen];
}

/** Scans one plugin root; paths are relative to it. */
export function scanPluginRoot(pluginRoot) {
  if (!existsSync(pluginRoot) || !statSync(pluginRoot).isDirectory())
    throw new Error(`Plugin bundle ${pluginRoot} is missing. Run npm run generate first.`);
  const findings = [];
  const signals = new Map();
  const graph = new Map();
  for (const absolute of walk(pluginRoot)) {
    const path = relative(pluginRoot, absolute).split(sep).join('/');
    const extension = extname(path);
    if (!SCANNED.has(extension)) continue;
    const text = readFileSync(absolute, 'utf8');
    const found = textSignals(text, extension);
    if (SCRIPT.has(extension)) {
      const script = scriptSignals(text, path);
      found.push(...script.signals);
      signals.set(path, script.signals);
      graph.set(
        path,
        script.imports
          .filter((specifier) => specifier.startsWith('.'))
          .map((specifier) => posix.normalize(posix.join(posix.dirname(path), specifier))),
      );
    }
    for (const rule of new Set(found.map((signal) => signal.rule)))
      findings.push({
        path,
        rule,
        evidence: found
          .filter((signal) => signal.rule === rule)
          .map((signal) => signal.evidence)
          .slice(0, 3),
      });
  }
  const imported = new Set([...graph.values()].flat());
  for (const entry of [...graph.keys()].filter((path) => !imported.has(path))) {
    const members = closure(entry, graph).filter((path) => signals.has(path));
    const of = (kinds) =>
      members.flatMap((path) =>
        signals
          .get(path)
          .filter(({ rule }) => kinds.has(rule))
          .slice(0, 1)
          .map(({ rule, line }) => `${rule} ${path}:${line}`),
      );
    const reads = of(READS);
    const sends = of(SENDS);
    if (reads.length && sends.length)
      findings.push({
        path: entry,
        rule: 'credential-forward',
        evidence: [reads[0], sends[0]],
        closure: members,
      });
  }
  return findings;
}

function globPattern(pattern) {
  const segment = (part) => part.replace(/[.+^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '[^/]*');
  return new RegExp(`^${pattern.split('**').map(segment).join('.*')}$`, 'u');
}

/** Digest of the permanent entries in canonical order; the baseline pins it. */
export function allowlistDigest(entries) {
  const canonical = entries
    .map(({ path, rule, reason }) => ({ path, rule, reason }))
    .sort((a, b) => `${a.path}\u0000${a.rule}`.localeCompare(`${b.path}\u0000${b.rule}`));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Reads the permanent allowlist and refuses any change its committed baseline does not pin. */
export function readAllowlist(workspace = root) {
  const value = JSON.parse(readFileSync(join(workspace, ALLOWLIST), 'utf8'));
  const unknown = Object.keys(value).filter((key) => !['$comment', 'permanent'].includes(key));
  if (unknown.length)
    throw new Error(
      `${ALLOWLIST} has unsupported keys: ${unknown.join(', ')}. Only permanent entries are allowed.`,
    );
  const permanent = value.permanent ?? [];
  for (const entry of permanent)
    if (
      typeof entry.path !== 'string' ||
      !RULES.includes(entry.rule) ||
      typeof entry.reason !== 'string' ||
      !entry.reason.trim()
    )
      throw new Error(`${ALLOWLIST} has an invalid permanent entry: ${JSON.stringify(entry)}`);
  const baseline = JSON.parse(readFileSync(join(workspace, BASELINE), 'utf8'));
  const sha256 = allowlistDigest(permanent);
  if (permanent.length > baseline.count)
    throw new Error(
      `${ALLOWLIST} grew from ${baseline.count} to ${permanent.length} permanent entries. The allowlist may only shrink; remove the finding instead.`,
    );
  if (permanent.length < baseline.count || sha256 !== baseline.sha256)
    throw new Error(
      `${ALLOWLIST} no longer matches ${BASELINE} (${baseline.count} entries, ${baseline.sha256}). If entries were only removed, set the baseline to {"count": ${permanent.length}, "sha256": "${sha256}"}.`,
    );
  return { permanent };
}

/**
 * Refuses any permanent entry ({path, rule}) the allowlist at `ref`, the pull request's base, lacks.
 * Before the base pins a baseline, its allowlist uses retired rules and nothing is compared.
 */
export function assertBaselineNotGrown(ref, workspace = root) {
  const git = (...args) => spawnSync('git', args, { cwd: workspace, encoding: 'utf8' });
  if (git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`).status !== 0)
    throw new Error(
      `Cannot resolve ${ref} to compare ${ALLOWLIST} with the base branch; fetch it first. The check fails closed without it.`,
    );
  if (git('show', `${ref}:${BASELINE}`).status !== 0) return { base: null };
  const base = git('show', `${ref}:${ALLOWLIST}`);
  if (base.status !== 0) throw new Error(`${ref} pins ${BASELINE} but has no ${ALLOWLIST}.`);
  const key = ({ path, rule }) => `${path} [${rule}]`;
  const before = new Set((JSON.parse(base.stdout).permanent ?? []).map(key));
  const after = JSON.parse(readFileSync(join(workspace, ALLOWLIST), 'utf8')).permanent ?? [];
  const added = after.map(key).filter((entry) => !before.has(entry));
  if (added.length)
    throw new Error(
      `${ALLOWLIST} has entries ${ref} does not: ${added.join(', ')}. The allowlist may only shrink.`,
    );
  return { base: before.size };
}

/** Splits findings into allowed and blocking ones, and lists allowlist entries nothing matched. */
export function classifyFindings(findings, allowlist) {
  const entries = allowlist.permanent.map((entry) => ({
    ...entry,
    pattern: globPattern(entry.path),
    used: false,
  }));
  const blocking = [];
  const allowed = [];
  for (const finding of findings) {
    const entry = entries.find(
      (candidate) => candidate.rule === finding.rule && candidate.pattern.test(finding.path),
    );
    if (entry) {
      entry.used = true;
      allowed.push(finding);
    } else blocking.push(finding);
  }
  const stale = entries.filter((entry) => !entry.used).map(({ path, rule }) => ({ path, rule }));
  return { blocking, allowed, stale };
}

/** Scans plugin roots and anchors any blocking finding on the root's manifest, as the directory does. */
export function checkPluginRoots(pluginRoots, allowlist) {
  const results = pluginRoots.map((pluginRoot) => {
    const result = classifyFindings(scanPluginRoot(pluginRoot), allowlist);
    const manifest = MANIFESTS.find((path) => existsSync(join(pluginRoot, path)));
    if (manifest && result.blocking.length)
      result.blocking.push({
        path: manifest,
        rule: 'plugin-anchor',
        evidence: [`${result.blocking.length} blocking findings`],
      });
    return { pluginRoot, ...result };
  });
  const matched = new Set(
    results.flatMap(({ allowed }) => allowed.map(({ path, rule }) => `${rule}\u0000${path}`)),
  );
  const stale = allowlist.permanent
    .filter(({ path, rule }) => {
      const pattern = globPattern(path);
      return ![...matched].some(
        (key) => key.startsWith(`${rule}\u0000`) && pattern.test(key.slice(rule.length + 1)),
      );
    })
    .map(({ path, rule }) => ({ path, rule }));
  return { results, stale };
}

/** Release check: every finding the allowlist does not cover blocks. */
export function assertReleasablePlugin({
  workspace = root,
  pluginRoots = PLUGIN_ROOTS.map((path) => join(workspace, path)),
} = {}) {
  const { results } = checkPluginRoots(pluginRoots, readAllowlist(workspace));
  const blocking = results.flatMap(({ pluginRoot, blocking }) =>
    blocking.map(
      ({ path, rule, evidence }) =>
        `  ${relative(workspace, pluginRoot) || pluginRoot}/${path} [${rule}] ${evidence.join(', ')}`,
    ),
  );
  if (blocking.length)
    throw new Error(
      `The plugin bundle reads credentials or sends beyond loopback; no release ships until it is clean:\n${blocking.join('\n')}`,
    );
}

function main(argv) {
  const baseRef = argv[argv.indexOf('--baseline-base') + 1];
  if (argv.includes('--baseline-base')) {
    const { base } = assertBaselineNotGrown(baseRef);
    console.log(
      base === null
        ? `${BASELINE} does not exist at ${baseRef} yet; nothing to compare.`
        : `${BASELINE} has not grown since ${baseRef}.`,
    );
    return;
  }
  const roots = argv.flatMap((value, index) =>
    argv[index - 1] === '--plugin-root' ? [resolve(value)] : [],
  );
  const pluginRoots = roots.length ? roots : PLUGIN_ROOTS.map((path) => join(root, path));
  const { results, stale } = checkPluginRoots(pluginRoots, readAllowlist());
  if (argv.includes('--report')) {
    process.stdout.write(
      `${JSON.stringify(
        results.map(({ pluginRoot, blocking, allowed }) => ({ pluginRoot, blocking, allowed })),
        null,
        2,
      )}\n`,
    );
    process.exitCode = results.some(({ blocking }) => blocking.length) ? 1 : 0;
    return;
  }
  for (const { pluginRoot, blocking } of results)
    for (const { path, rule, evidence } of blocking)
      console.error(
        `plugin network boundary: ${relative(root, pluginRoot)}/${path} [${rule}] ${evidence.join(', ')}`,
      );
  if (!roots.length)
    for (const { path, rule } of stale)
      console.error(
        `plugin network boundary: allowlist entry ${path} [${rule}] matches nothing; remove it from ${ALLOWLIST}.`,
      );
  if (results.some(({ blocking }) => blocking.length) || (!roots.length && stale.length)) {
    process.exitCode = 1;
    return;
  }
  console.log('Plugin network boundary holds.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
