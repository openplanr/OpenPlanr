import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  discoverEcosystemRepositories,
  resolveWorkspaceRoot,
} from '../../lib/ecosystem/workspace-discovery.mjs';

function makeWorkspace() {
  return mkdtempSync(join(tmpdir(), 'openplanr-workspace-'));
}

function write(path, content = '') {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function addRepo(workspace, name, signature, remote) {
  const repo = join(workspace, name);
  write(join(repo, signature), signature.endsWith('.json') ? '{}\n' : '---\nname: openplanr\n---\n');
  if (remote) {
    write(join(repo, '.git', 'config'), `[remote "origin"]\n  url = ${remote}\n`);
  }
  return repo;
}

test('discovers the ecosystem using the real short checkout names', () => {
  const workspace = makeWorkspace();
  const pipeline = addRepo(workspace, 'planr-pipeline', '.claude-plugin/plugin.json');
  const marketplace = addRepo(workspace, 'marketplace', '.claude-plugin/marketplace.json');
  const skills = addRepo(workspace, 'skills', 'skills/openplanr/SKILL.md');
  const cli = addRepo(workspace, 'OpenPlanr', 'package.json');

  const result = discoverEcosystemRepositories({ pipelineRoot: pipeline, workspaceRoot: workspace });

  assert.equal(result.repositories.pipeline.path, pipeline);
  assert.equal(result.repositories.marketplace.path, marketplace);
  assert.equal(result.repositories.skills.path, skills);
  assert.equal(result.repositories.cli.path, cli);
});

test('keeps compatibility with legacy prefixed checkout names', () => {
  const workspace = makeWorkspace();
  const pipeline = addRepo(workspace, 'planr-pipeline', '.claude-plugin/plugin.json');
  const marketplace = addRepo(workspace, 'openplanr-marketplace', '.claude-plugin/marketplace.json');
  const skills = addRepo(workspace, 'openplanr-skills', 'skills/openplanr/SKILL.md');

  const result = discoverEcosystemRepositories({ pipelineRoot: pipeline, workspaceRoot: workspace });

  assert.equal(result.repositories.marketplace.path, marketplace);
  assert.equal(result.repositories.skills.path, skills);
});

test('discovers arbitrarily named checkouts from OpenPlanr git remotes', () => {
  const workspace = makeWorkspace();
  const pipeline = addRepo(workspace, 'planr-pipeline', '.claude-plugin/plugin.json');
  const marketplace = addRepo(
    workspace,
    'distribution-metadata',
    '.claude-plugin/marketplace.json',
    'git@github.com:openplanr/marketplace.git',
  );
  const skills = addRepo(
    workspace,
    'agent-workflows',
    'skills/openplanr/SKILL.md',
    'https://github.com/openplanr/skills.git',
  );

  const result = discoverEcosystemRepositories({ pipelineRoot: pipeline, workspaceRoot: workspace });

  assert.equal(result.repositories.marketplace.path, marketplace);
  assert.equal(result.repositories.marketplace.method, 'git-remote');
  assert.equal(result.repositories.skills.path, skills);
  assert.equal(result.repositories.skills.method, 'git-remote');
});

test('workspace root precedence is CLI, environment, then pipeline parent', () => {
  const pipelineRoot = resolve('/workspace/repos/planr-pipeline');
  const cliRoot = resolve('/cli-root');
  const environmentRoot = resolve('/env-root');

  assert.deepEqual(
    resolveWorkspaceRoot({
      pipelineRoot,
      argv: ['--workspace-root', cliRoot],
      env: { OPENPLANR_ECOSYSTEM_ROOT: environmentRoot },
    }),
    { path: cliRoot, source: 'cli' },
  );
  assert.deepEqual(
    resolveWorkspaceRoot({
      pipelineRoot,
      env: { OPENPLANR_ECOSYSTEM_ROOT: environmentRoot },
    }),
    { path: environmentRoot, source: 'environment' },
  );
  assert.deepEqual(resolveWorkspaceRoot({ pipelineRoot, env: {} }), {
    path: dirname(pipelineRoot),
    source: 'default',
  });
});

test('rejects a missing --workspace-root value', () => {
  assert.throws(
    () => resolveWorkspaceRoot({ pipelineRoot: '/workspace/planr-pipeline', argv: ['--workspace-root'] }),
    /requires a directory path/,
  );
});
