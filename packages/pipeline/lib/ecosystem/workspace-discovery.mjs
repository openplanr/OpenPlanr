import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

const CONSOLIDATED_WORKSPACE_NAME = 'openplanr-workspace';
const CONSOLIDATED_PIPELINE_PATH = 'packages/pipeline';

export const ECOSYSTEM_REPOSITORIES = {
  pipeline: {
    label: 'planr-pipeline',
    aliases: ['planr-pipeline'],
    remoteNames: ['planr-pipeline'],
    signature: '.claude-plugin/plugin.json',
  },
  marketplace: {
    label: 'marketplace',
    aliases: ['marketplace', 'openplanr-marketplace'],
    remoteNames: ['marketplace'],
    signature: '.claude-plugin/marketplace.json',
  },
  skills: {
    label: 'skills',
    aliases: ['skills', 'openplanr-skills'],
    remoteNames: ['skills'],
    signature: 'skills/openplanr/SKILL.md',
  },
  cli: {
    label: 'OpenPlanr',
    aliases: ['OpenPlanr', 'openplanr'],
    remoteNames: ['openplanr'],
    signature: 'package.json',
  },
  web: {
    label: 'openplanr-web',
    aliases: ['openplanr-web', 'OpenPlanr-web'],
    remoteNames: ['openplanr-web'],
    signature: 'package.json',
  },
};

function optionValue(argv, name) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

function readPackageJson(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function workspaceEntries(pkg) {
  if (Array.isArray(pkg?.workspaces)) return pkg.workspaces;
  return Array.isArray(pkg?.workspaces?.packages) ? pkg.workspaces.packages : [];
}

function isConsolidatedWorkspace(candidate, pipelineRoot) {
  const pkg = readPackageJson(candidate);
  return (
    pkg?.name === CONSOLIDATED_WORKSPACE_NAME &&
    workspaceEntries(pkg).includes(CONSOLIDATED_PIPELINE_PATH) &&
    resolve(candidate, CONSOLIDATED_PIPELINE_PATH) === resolve(pipelineRoot)
  );
}

function containsPath(boundary, candidate) {
  const path = relative(resolve(boundary), resolve(candidate));
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

export function findConsolidatedWorkspaceRoot(pipelineRoot) {
  const resolvedPipelineRoot = resolve(pipelineRoot);
  let candidate = resolvedPipelineRoot;
  while (true) {
    if (isConsolidatedWorkspace(candidate, resolvedPipelineRoot)) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
}

export function resolveWorkspaceRoot({ pipelineRoot, argv = [], env = process.env } = {}) {
  const cliValue = optionValue(argv, '--workspace-root');
  if (cliValue === '') {
    throw new Error('`--workspace-root` requires a directory path.');
  }
  if (cliValue) return { path: resolve(cliValue), source: 'cli' };

  if (env.OPENPLANR_ECOSYSTEM_ROOT) {
    return { path: resolve(env.OPENPLANR_ECOSYSTEM_ROOT), source: 'environment' };
  }

  const consolidatedRoot = findConsolidatedWorkspaceRoot(pipelineRoot);
  if (consolidatedRoot) return { path: consolidatedRoot, source: 'monorepo' };

  return { path: resolve(pipelineRoot, '..'), source: 'default' };
}

function gitDirFor(repoRoot) {
  const dotGit = join(repoRoot, '.git');
  if (!existsSync(dotGit)) return null;

  try {
    const content = readFileSync(dotGit, 'utf8').trim();
    const match = content.match(/^gitdir:\s*(.+)$/i);
    return match ? resolve(repoRoot, match[1]) : dotGit;
  } catch {
    return dotGit;
  }
}

export function readRemoteUrls(repoRoot) {
  const gitDir = gitDirFor(repoRoot);
  if (!gitDir) return [];

  try {
    const config = readFileSync(join(gitDir, 'config'), 'utf8');
    return [...config.matchAll(/^\s*url\s*=\s*(.+?)\s*$/gm)].map((match) => match[1]);
  } catch {
    return [];
  }
}

function remoteRepositoryName(url) {
  const normalized = String(url)
    .trim()
    .replace(/\\/g, '/')
    .replace(/\.git$/i, '');
  const match = normalized.match(/(?:^|[/:])openplanr\/([^/]+)$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function childDirectories(workspaceRoot) {
  if (!existsSync(workspaceRoot)) return [];
  try {
    return readdirSync(workspaceRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(workspaceRoot, entry.name));
  } catch {
    return [];
  }
}

function hasSignature(repoRoot, signature) {
  return existsSync(join(repoRoot, signature));
}

function resolveByAlias(workspaceRoot, definition) {
  const children = childDirectories(workspaceRoot);
  for (const alias of definition.aliases) {
    const candidate =
      children.find((path) => basename(path) === alias) ??
      children.find((path) => basename(path).toLowerCase() === alias.toLowerCase()) ??
      join(workspaceRoot, alias);
    if (hasSignature(candidate, definition.signature)) {
      return { path: candidate, method: 'alias' };
    }
  }
  return null;
}

function resolveByRemote(candidates, definition) {
  const expected = new Set(definition.remoteNames.map((name) => name.toLowerCase()));
  for (const candidate of candidates) {
    const matches = readRemoteUrls(candidate).some((url) =>
      expected.has(remoteRepositoryName(url)),
    );
    if (matches && hasSignature(candidate, definition.signature)) {
      return { path: candidate, method: 'git-remote' };
    }
  }
  return null;
}

export function discoverEcosystemRepositories({ pipelineRoot, workspaceRoot } = {}) {
  const resolvedPipelineRoot = resolve(pipelineRoot);
  const resolvedWorkspaceRoot = resolve(workspaceRoot ?? dirname(resolvedPipelineRoot));
  const consolidatedRoot = findConsolidatedWorkspaceRoot(resolvedPipelineRoot);

  // An explicit workspace root is a real discovery boundary. This keeps
  // fixture/consumer workspaces inspectable even when the verifier itself is
  // executed from the consolidated OpenPlanr checkout.
  if (consolidatedRoot && containsPath(resolvedWorkspaceRoot, consolidatedRoot)) {
    const webSearchRoots = [resolvedWorkspaceRoot, dirname(consolidatedRoot)]
      .filter((candidate) => containsPath(resolvedWorkspaceRoot, candidate))
      .filter((value, index, all) => all.indexOf(value) === index);
    const webCandidates = webSearchRoots
      .flatMap((candidate) => childDirectories(candidate))
      .filter((value, index, all) => all.indexOf(value) === index);
    const webDefinition = ECOSYSTEM_REPOSITORIES.web;
    const web =
      webSearchRoots.map((candidate) => resolveByAlias(candidate, webDefinition)).find(Boolean) ??
      resolveByRemote(webCandidates, webDefinition) ??
      null;

    return {
      layout: 'consolidated-monorepo',
      workspaceRoot: consolidatedRoot,
      repositories: {
        pipeline: { path: resolvedPipelineRoot, method: 'current-package' },
        marketplace: { path: consolidatedRoot, method: 'workspace-domain' },
        skills: { path: consolidatedRoot, method: 'workspace-domain' },
        cli: { path: join(consolidatedRoot, 'packages', 'cli'), method: 'workspace-package' },
        web,
      },
    };
  }

  const candidates = [resolvedPipelineRoot, ...childDirectories(resolvedWorkspaceRoot)]
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort((left, right) => basename(left).localeCompare(basename(right)));

  const repositories = {};
  for (const [key, definition] of Object.entries(ECOSYSTEM_REPOSITORIES)) {
    if (key === 'pipeline' && hasSignature(resolvedPipelineRoot, definition.signature)) {
      repositories[key] = { path: resolvedPipelineRoot, method: 'current-repo' };
      continue;
    }

    repositories[key] =
      resolveByAlias(resolvedWorkspaceRoot, definition) ??
      resolveByRemote(candidates, definition) ??
      null;
  }

  return { layout: 'multi-repository', workspaceRoot: resolvedWorkspaceRoot, repositories };
}
