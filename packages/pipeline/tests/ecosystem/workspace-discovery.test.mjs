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
  write(
    join(repo, signature),
    signature.endsWith('.json') ? '{}\n' : '---\nname: openplanr\n---\n',
  );
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
  const web = addRepo(workspace, 'openplanr-web', 'package.json');

  const result = discoverEcosystemRepositories({
    pipelineRoot: pipeline,
    workspaceRoot: workspace,
  });

  assert.equal(result.repositories.pipeline.path, pipeline);
  assert.equal(result.repositories.marketplace.path, marketplace);
  assert.equal(result.repositories.skills.path, skills);
  assert.equal(result.repositories.cli.path, cli);
  assert.equal(result.repositories.web.path, web);
});

test('keeps compatibility with legacy prefixed checkout names', () => {
  const workspace = makeWorkspace();
  const pipeline = addRepo(workspace, 'planr-pipeline', '.claude-plugin/plugin.json');
  const marketplace = addRepo(
    workspace,
    'openplanr-marketplace',
    '.claude-plugin/marketplace.json',
  );
  const skills = addRepo(workspace, 'openplanr-skills', 'skills/openplanr/SKILL.md');
  const web = addRepo(workspace, 'OpenPlanr-web', 'package.json');

  const result = discoverEcosystemRepositories({
    pipelineRoot: pipeline,
    workspaceRoot: workspace,
  });

  assert.equal(result.repositories.marketplace.path, marketplace);
  assert.equal(result.repositories.skills.path, skills);
  assert.equal(result.repositories.web.path, web);
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
  const web = addRepo(
    workspace,
    'hosted-review-service',
    'package.json',
    'https://github.com/openplanr/openplanr-web.git',
  );

  const result = discoverEcosystemRepositories({
    pipelineRoot: pipeline,
    workspaceRoot: workspace,
  });

  assert.equal(result.repositories.marketplace.path, marketplace);
  assert.equal(result.repositories.marketplace.method, 'git-remote');
  assert.equal(result.repositories.skills.path, skills);
  assert.equal(result.repositories.skills.method, 'git-remote');
  assert.equal(result.repositories.web.path, web);
  assert.equal(result.repositories.web.method, 'git-remote');
});

test('discovers canonical domains inside the consolidated OpenPlanr workspace', () => {
  const workspace = join(makeWorkspace(), 'OpenPlanr');
  const pipeline = join(workspace, 'packages', 'pipeline');
  write(
    join(workspace, 'package.json'),
    `${JSON.stringify({ name: 'openplanr-workspace', private: true, workspaces: ['packages/cli', 'packages/pipeline'] })}\n`,
  );
  write(join(workspace, 'ecosystem.json'), '{}\n');
  write(join(workspace, '.claude-plugin', 'marketplace.json'), '{}\n');
  write(join(workspace, 'skills', 'planr-plan', 'SKILL.md'));
  write(join(workspace, 'packages', 'cli', 'package.json'), '{}\n');
  write(join(pipeline, '.claude-plugin', 'plugin.json'), '{}\n');

  const root = resolveWorkspaceRoot({ pipelineRoot: pipeline, env: {} });
  const result = discoverEcosystemRepositories({
    pipelineRoot: pipeline,
    workspaceRoot: root.path,
  });

  assert.deepEqual(root, { path: workspace, source: 'monorepo' });
  assert.equal(result.layout, 'consolidated-monorepo');
  assert.equal(result.workspaceRoot, workspace);
  assert.equal(result.repositories.pipeline.path, pipeline);
  assert.equal(result.repositories.marketplace.path, workspace);
  assert.equal(result.repositories.skills.path, workspace);
  assert.equal(result.repositories.cli.path, join(workspace, 'packages', 'cli'));
  assert.equal(result.repositories.web, null);
});

test('recognizes a consolidated workspace before generated assets exist', () => {
  const workspace = join(makeWorkspace(), 'OpenPlanr');
  const pipeline = join(workspace, 'packages', 'pipeline');
  write(
    join(workspace, 'package.json'),
    `${JSON.stringify({ name: 'openplanr-workspace', private: true, workspaces: ['packages/cli', 'packages/pipeline'] })}\n`,
  );
  write(join(pipeline, '.claude-plugin', 'plugin.json'), '{}\n');

  assert.deepEqual(resolveWorkspaceRoot({ pipelineRoot: pipeline, env: {} }), {
    path: workspace,
    source: 'monorepo',
  });
});

test('an ancestor workspace boundary retains consolidated domains and discovers external web within that boundary', () => {
  const boundary = makeWorkspace();
  const parent = join(boundary, 'AsemDevs');
  const workspace = join(parent, 'OpenPlanr');
  const pipeline = join(workspace, 'packages', 'pipeline');
  const web = addRepo(parent, 'openplanr-web', 'package.json');
  write(
    join(workspace, 'package.json'),
    `${JSON.stringify({ name: 'openplanr-workspace', private: true, workspaces: ['packages/cli', 'packages/pipeline'] })}\n`,
  );
  write(join(workspace, 'ecosystem.json'), '{}\n');
  write(join(workspace, '.claude-plugin', 'marketplace.json'), '{}\n');
  write(join(workspace, 'skills', 'planr-plan', 'SKILL.md'));
  write(join(workspace, 'packages', 'cli', 'package.json'), '{}\n');
  write(join(pipeline, '.claude-plugin', 'plugin.json'), '{}\n');

  const result = discoverEcosystemRepositories({ pipelineRoot: pipeline, workspaceRoot: boundary });

  assert.equal(result.layout, 'consolidated-monorepo');
  assert.equal(result.repositories.pipeline.path, pipeline);
  assert.equal(result.repositories.marketplace.path, workspace);
  assert.equal(result.repositories.skills.path, workspace);
  assert.equal(result.repositories.cli.path, join(workspace, 'packages', 'cli'));
  assert.equal(result.repositories.web.path, web);
  assert.equal(result.repositories.web.method, 'alias');
});

test('an unrelated workspace boundary does not inherit consolidated domains', () => {
  const parent = makeWorkspace();
  const workspace = join(parent, 'OpenPlanr');
  const pipeline = join(workspace, 'packages', 'pipeline');
  const unrelated = join(parent, 'consumer-workspace');
  write(
    join(workspace, 'package.json'),
    `${JSON.stringify({ name: 'openplanr-workspace', private: true, workspaces: ['packages/cli', 'packages/pipeline'] })}\n`,
  );
  write(join(pipeline, '.claude-plugin', 'plugin.json'), '{}\n');
  write(join(unrelated, '.keep'), '');

  const result = discoverEcosystemRepositories({
    pipelineRoot: pipeline,
    workspaceRoot: unrelated,
  });

  assert.equal(result.layout, 'multi-repository');
  assert.equal(result.repositories.pipeline.path, pipeline);
  assert.equal(result.repositories.marketplace, null);
  assert.equal(result.repositories.skills, null);
  assert.equal(result.repositories.cli, null);
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
    () =>
      resolveWorkspaceRoot({
        pipelineRoot: '/workspace/planr-pipeline',
        argv: ['--workspace-root'],
      }),
    /requires a directory path/,
  );
});
