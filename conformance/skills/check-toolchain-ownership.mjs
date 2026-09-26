#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const expectedRoles = Object.freeze(['prompt-writer', 'runtime-installer']);
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']);
const excludedDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'fixtures',
  'test',
  'tests',
  'vendor',
]);
const mutationCall = /\b(?:appendFile|copyFile|rename|writeFile)(?:Sync)?\s*\(/u;
const promptCompilerApi =
  /\b(?:buildCompiledManifests|compileComposedV1|compileHostProjections|flattenCompiledAssets|readStandardSkillPackage|renderSkillForHost|writeOutputTree)\b/u;
const roleSignatures = Object.freeze({
  'prompt-writer': (bytes) =>
    promptCompilerApi.test(bytes) &&
    (/\bdist\/plugins\/(?:claude|openai|cursor)(?:\/|\b)/u.test(bytes) ||
      /\b(?:buildCompiledManifests|compileComposedV1|compileHostProjections|flattenCompiledAssets|writeOutputTree)\b/u.test(
        bytes,
      )),
  'runtime-installer': (bytes) =>
    /['"]\.codex['"]/u.test(bytes) &&
    /['"]skills['"]/u.test(bytes) &&
    /\bcodexSkillsRoot\b/u.test(bytes),
});

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function safeRepositoryPath(path, label, repositoryRoot = root) {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path) || path.includes('\\')) {
    fail('E_SKILL_TOOLCHAIN_OWNER_PATH_INVALID', `${label} must be a repository-relative path.`, {
      path,
    });
  }
  const absolute = resolve(repositoryRoot, ...path.split('/'));
  const within = relative(repositoryRoot, absolute);
  if (within === '..' || within.startsWith(`..${sep}`)) {
    fail('E_SKILL_TOOLCHAIN_OWNER_PATH_INVALID', `${label} escapes the repository.`, { path });
  }
  return absolute;
}

function sourceFiles(repositoryRoot) {
  const files = [];
  const pending = ['scripts', 'packages']
    .map((path) => join(repositoryRoot, path))
    .filter((path) => existsSync(path));
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) pending.push(path);
      } else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
        files.push(path);
      }
    }
  }
  return files.sort();
}

/** Discover executable sources that both mutate files and name an owned surface. */
export function discoverToolchainImplementations(repositoryRoot = root) {
  const discovered = Object.fromEntries(expectedRoles.map((role) => [role, []]));
  for (const absolute of sourceFiles(repositoryRoot)) {
    const bytes = readFileSync(absolute, 'utf8');
    if (!mutationCall.test(bytes)) continue;
    for (const role of expectedRoles) {
      if (roleSignatures[role](bytes)) {
        discovered[role].push(relative(repositoryRoot, absolute).split(sep).join('/'));
      }
    }
  }
  return Object.freeze(
    Object.fromEntries(expectedRoles.map((role) => [role, Object.freeze(discovered[role])])),
  );
}

export function validateToolchainOwners(document, { repositoryRoot = root } = {}) {
  if (
    document?.kind !== 'openplanr-skill-toolchain-owners' ||
    document.schemaVersion !== '1.0.0' ||
    !Array.isArray(document.owners)
  ) {
    fail(
      'E_SKILL_TOOLCHAIN_OWNERS_INVALID',
      'Skill toolchain ownership document has an invalid kind, version, or owners list.',
    );
  }

  const byRole = new Map();
  const ownerIds = new Set();
  for (const owner of document.owners) {
    if (!expectedRoles.includes(owner?.role)) {
      fail(
        'E_SKILL_TOOLCHAIN_ROLE_INVALID',
        `Unknown skill toolchain role ${String(owner?.role)}.`,
        { owner },
      );
    }
    if (!/^[a-z][a-z0-9-]*$/u.test(owner.ownerId ?? '') || ownerIds.has(owner.ownerId)) {
      fail(
        'E_SKILL_TOOLCHAIN_OWNER_ID_INVALID',
        `Owner id ${String(owner.ownerId)} is invalid or duplicated.`,
        { owner },
      );
    }
    ownerIds.add(owner.ownerId);
    const roleOwners = byRole.get(owner.role) ?? [];
    roleOwners.push(owner);
    byRole.set(owner.role, roleOwners);

    const absolute = safeRepositoryPath(owner.path, `${owner.role} owner path`, repositoryRoot);
    if (
      !existsSync(absolute) ||
      lstatSync(absolute).isSymbolicLink() ||
      !lstatSync(absolute).isFile()
    ) {
      fail(
        'E_SKILL_TOOLCHAIN_OWNER_MISSING',
        `${owner.role} owner ${owner.ownerId} does not resolve to one regular repository file.`,
        { path: owner.path },
      );
    }
    if (
      !Array.isArray(owner.controls) ||
      owner.controls.length === 0 ||
      new Set(owner.controls).size !== owner.controls.length
    ) {
      fail(
        'E_SKILL_TOOLCHAIN_CONTROLS_INVALID',
        `${owner.role} owner ${owner.ownerId} must declare distinct controlled surfaces.`,
        { owner },
      );
    }
    if (
      !Array.isArray(owner.implementationPaths) ||
      owner.implementationPaths.length === 0 ||
      new Set(owner.implementationPaths).size !== owner.implementationPaths.length ||
      !owner.implementationPaths.includes(owner.path)
    ) {
      fail(
        'E_SKILL_TOOLCHAIN_IMPLEMENTATIONS_INVALID',
        `${owner.role} owner ${owner.ownerId} must declare distinct implementation paths including its owner path.`,
        { owner },
      );
    }
    for (const path of owner.implementationPaths) {
      const implementation = safeRepositoryPath(
        path,
        `${owner.role} implementation path`,
        repositoryRoot,
      );
      if (
        !existsSync(implementation) ||
        lstatSync(implementation).isSymbolicLink() ||
        !lstatSync(implementation).isFile()
      ) {
        fail(
          'E_SKILL_TOOLCHAIN_OWNER_MISSING',
          `${owner.role} implementation does not resolve to one regular repository file.`,
          { path },
        );
      }
    }
  }

  for (const role of expectedRoles) {
    const owners = byRole.get(role) ?? [];
    if (owners.length !== 1) {
      fail(
        'E_SKILL_TOOLCHAIN_OWNER_CONFLICT',
        `Skill toolchain role ${role} must have exactly one owner; found ${owners.length}.`,
        { role, owners: owners.map(({ ownerId, path }) => ({ ownerId, path })) },
      );
    }
  }
  const discovered = discoverToolchainImplementations(repositoryRoot);
  for (const role of expectedRoles) {
    const declared = [...byRole.get(role)[0].implementationPaths].sort();
    const undeclared = discovered[role].filter((path) => !declared.includes(path));
    const stale = declared.filter((path) => !discovered[role].includes(path));
    if (undeclared.length > 0 || stale.length > 0) {
      fail(
        'E_SKILL_TOOLCHAIN_IMPLEMENTATION_CONFLICT',
        `Discovered ${role} implementations do not match the one declared owner.`,
        { role, undeclared, stale, discovered: discovered[role], declared },
      );
    }
  }
  return Object.freeze(
    Object.fromEntries(
      expectedRoles.map((role) => [role, Object.freeze({ ...byRole.get(role)[0] })]),
    ),
  );
}

function registryPath(argv) {
  if (argv.length === 0) return 'conformance/skills/toolchain-owners.json';
  if (argv.length === 2 && argv[0] === '--registry') return argv[1];
  fail(
    'E_USAGE',
    'Usage: node conformance/skills/check-toolchain-ownership.mjs [--registry <repository-relative-path>]',
  );
}

function main() {
  const path = registryPath(process.argv.slice(2));
  const absolute = safeRepositoryPath(path, 'ownership registry', root);
  const owners = validateToolchainOwners(JSON.parse(readFileSync(absolute, 'utf8')), {
    repositoryRoot: root,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        registry: path,
        owners,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          ok: false,
          code: error.code ?? 'E_SKILL_TOOLCHAIN_OWNERS_UNEXPECTED',
          message: error.message,
          details: error.details ?? {},
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = error.code === 'E_USAGE' ? 2 : 1;
  }
}
