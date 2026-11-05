#!/usr/bin/env node
/**
 * Keeps credential reads and OpenPlanr-host requests out of the generated host plugins.
 * Sharing runs in the `openplanr` CLI; plugin code may only talk to loopback.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN_ROOTS = Object.freeze([
  'dist/plugins/claude/openplanr',
  'dist/plugins/openai/openplanr',
  'dist/plugins/cursor/openplanr',
]);
const ALLOWLIST = 'scripts/plugin-network-boundary-allowlist.json';
const CODE = new Set(['.mjs', '.js', '.cjs', '.json', '.html', '.css']);

const SHARE_MODULES = [
  'share',
  'share-status',
  'owner-custody',
  'encrypted-workspace-client',
  'chunked-workspace-client',
  'upload-spool',
  'share-client',
  'hosted-viewer',
  'share-dialog',
  'durable-paste-share',
  'live-room',
  'live-room-v3',
  'live-room-integrity',
  'sharing-security-contracts',
  'workspace-contracts',
];

const HOME_READ =
  /(?:\benv(?:\?\.|\.)(?:HOME|PLANR_HOME|OPENPLANR_HOME)\b|\bhomedir\(|tokens\.json|artifact-daemon)/u;
const NETWORK = /(?:\bfetch\(|\bfetchImpl\(|\bhttps?\.(?:request|get)\()/u;
const OPENPLANR_URL = /https?:\/\/(?:[a-z0-9-]+\.)*openplanr\.dev[^\s"'`)<>\\]*/gu;
// A JSON-Schema identifier names a schema; nothing fetches it.
const SCHEMA_IDENTIFIER = /(?:["']?\$(?:id|schema)["']?\s*:|\.\$(?:id|schema)\s*=)\s*["'`]$/u;

/** Rules, each `(text, file) => evidence[]`; evidence is a short excerpt per finding. */
export const RULES = Object.freeze({
  'share-host': (text) =>
    [...text.matchAll(/share\.openplanr\.dev|OPENPLANR_SHARE_BASE/gu)].map((match) => match[0]),
  'openplanr-request-url': (text) =>
    [...text.matchAll(OPENPLANR_URL)]
      .filter(
        (match) => !SCHEMA_IDENTIFIER.test(text.slice(Math.max(0, match.index - 24), match.index)),
      )
      .map((match) => match[0]),
  'owner-key': (text) =>
    [
      ...text.matchAll(
        /\b(?:ownerAuth|ownerPrivateKey|custodyToken|deletionToken)\b|design-shares|diagram-shares/gu,
      ),
    ].map((match) => match[0]),
  'home-read-with-network': (text) => {
    const home = text.match(HOME_READ);
    const network = text.match(NETWORK);
    return home && network ? [`${home[0]} + ${network[0]}`] : [];
  },
  authorization: (text) =>
    [...text.matchAll(/\bAuthorization\b|\bBearer \$\{/gu)].map((match) => match[0]),
  'share-module': (text) =>
    [
      ...text.matchAll(
        new RegExp(
          `^\\s*// (?:\\.\\./)*(?:packages/[a-z-]+/)?(?:lib|src)/\\S*?/(?:${SHARE_MODULES.join('|')})\\.m?[jt]s$`,
          'gmu',
        ),
      ),
    ].map((match) => match[0].trim()),
});

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}

function skillScriptRoots(workspace) {
  const skills = join(workspace, 'skills');
  return readdirSync(skills, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('planr-'))
    .map((entry) => join(skills, entry.name, 'scripts'))
    .filter((path) => existsSync(path));
}

function globPattern(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '[^/]*');
  return new RegExp(`^${escaped}$`, 'u');
}

/** Reads the allowlist; each entry names a file glob, a rule and why it is still there. */
export function readAllowlist(workspace = root) {
  const path = join(workspace, ALLOWLIST);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  for (const entry of value.shrinking ?? [])
    if (typeof entry.path !== 'string' || !Object.hasOwn(RULES, entry.rule))
      throw new Error(`${ALLOWLIST} has an invalid shrinking entry: ${JSON.stringify(entry)}`);
  for (const entry of value.permanent ?? [])
    if (
      typeof entry.path !== 'string' ||
      !Object.hasOwn(RULES, entry.rule) ||
      typeof entry.reason !== 'string' ||
      !entry.reason.trim()
    )
      throw new Error(`${ALLOWLIST} has an invalid permanent entry: ${JSON.stringify(entry)}`);
  return { permanent: value.permanent ?? [], shrinking: value.shrinking ?? [] };
}

/**
 * Scans each plugin root and the skill script sources.
 * Paths are reported relative to their plugin root, or to the workspace for skill sources.
 */
export function scanPluginNetworkBoundary({
  workspace = root,
  pluginRoots = PLUGIN_ROOTS.map((path) => join(workspace, path)),
  includeSkillSources = true,
} = {}) {
  for (const pluginRoot of pluginRoots)
    if (!existsSync(pluginRoot) || !statSync(pluginRoot).isDirectory())
      throw new Error(
        `Plugin bundle ${relative(workspace, pluginRoot) || pluginRoot} is missing. Run npm run generate first.`,
      );
  const sources = [
    ...pluginRoots.map((pluginRoot) => ({ base: pluginRoot, files: walk(pluginRoot) })),
    ...(includeSkillSources
      ? skillScriptRoots(workspace).map((path) => ({ base: workspace, files: walk(path) }))
      : []),
  ];
  const findings = [];
  for (const { base, files } of sources)
    for (const file of files) {
      if (!CODE.has(extname(file))) continue;
      const text = readFileSync(file, 'utf8');
      const path = relative(base, file).split(sep).join('/');
      for (const [rule, check] of Object.entries(RULES)) {
        const evidence = check(text, path);
        if (evidence.length)
          findings.push({ path, rule, evidence: [...new Set(evidence)].slice(0, 3) });
      }
    }
  return findings;
}

/** Splits findings into allowed and blocking ones, and lists allowlist entries nothing matched. */
export function classifyFindings(findings, allowlist) {
  const entries = [
    ...allowlist.permanent.map((entry) => ({ ...entry, kind: 'permanent' })),
    ...allowlist.shrinking.map((entry) => ({ ...entry, kind: 'shrinking' })),
  ].map((entry) => ({ ...entry, pattern: globPattern(entry.path), used: false }));
  const blocking = [];
  const allowed = [];
  for (const finding of findings) {
    const entry = entries.find(
      (candidate) => candidate.rule === finding.rule && candidate.pattern.test(finding.path),
    );
    if (entry) {
      entry.used = true;
      allowed.push({ ...finding, kind: entry.kind });
    } else blocking.push(finding);
  }
  const stale = entries
    .filter((entry) => !entry.used)
    .map(({ path, rule, kind }) => ({ path, rule, kind }));
  return { blocking, allowed, stale };
}

/** Release check: every finding blocks, whatever the allowlist says, except permanent entries. */
export function assertReleasablePlugin({ workspace = root, pluginRoots } = {}) {
  const { permanent } = readAllowlist(workspace);
  const findings = scanPluginNetworkBoundary({
    workspace,
    ...(pluginRoots ? { pluginRoots } : {}),
    includeSkillSources: false,
  });
  const { blocking } = classifyFindings(findings, { permanent, shrinking: [] });
  if (blocking.length)
    throw new Error(
      `The plugin bundle still reads credentials or contacts OpenPlanr hosts; no release ships until it is clean:\n${blocking
        .map(({ path, rule, evidence }) => `  ${path} [${rule}] ${evidence.join(', ')}`)
        .join('\n')}`,
    );
}

function main() {
  const allowlist = readAllowlist();
  const { blocking, allowed, stale } = classifyFindings(scanPluginNetworkBoundary(), allowlist);
  const shrinking = allowed.filter(({ kind }) => kind === 'shrinking').length;
  if (blocking.length || stale.length) {
    for (const { path, rule, evidence } of blocking)
      console.error(`plugin network boundary: ${path} [${rule}] ${evidence.join(', ')}`);
    for (const { path, rule, kind } of stale)
      console.error(
        `plugin network boundary: ${kind} allowlist entry ${path} [${rule}] matches nothing; remove it from ${ALLOWLIST}.`,
      );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Plugin network boundary holds (${shrinking} allowlisted findings left before a release can ship).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
