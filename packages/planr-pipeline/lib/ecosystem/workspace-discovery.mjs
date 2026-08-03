import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

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

export function resolveWorkspaceRoot({ pipelineRoot, argv = [], env = process.env } = {}) {
  const cliValue = optionValue(argv, '--workspace-root');
  if (cliValue === '') {
    throw new Error('`--workspace-root` requires a directory path.');
  }
  if (cliValue) return { path: resolve(cliValue), source: 'cli' };

  if (env.OPENPLANR_ECOSYSTEM_ROOT) {
    return { path: resolve(env.OPENPLANR_ECOSYSTEM_ROOT), source: 'environment' };
  }

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
  const normalized = String(url).trim().replace(/\\/g, '/').replace(/\.git$/i, '');
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
  for (const alias of definition.aliases) {
    const candidate = join(workspaceRoot, alias);
    if (hasSignature(candidate, definition.signature)) {
      return { path: candidate, method: 'alias' };
    }
  }
  return null;
}

function resolveByRemote(candidates, definition) {
  const expected = new Set(definition.remoteNames.map((name) => name.toLowerCase()));
  for (const candidate of candidates) {
    const matches = readRemoteUrls(candidate).some((url) => expected.has(remoteRepositoryName(url)));
    if (matches && hasSignature(candidate, definition.signature)) {
      return { path: candidate, method: 'git-remote' };
    }
  }
  return null;
}

export function discoverEcosystemRepositories({ pipelineRoot, workspaceRoot } = {}) {
  const resolvedPipelineRoot = resolve(pipelineRoot);
  const resolvedWorkspaceRoot = resolve(workspaceRoot ?? dirname(resolvedPipelineRoot));
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

  return { workspaceRoot: resolvedWorkspaceRoot, repositories };
}
