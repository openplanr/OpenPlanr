import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { selectLanes } from '../../scripts/ci/browser-lanes.mjs';
import {
  FILE_LIMIT,
  JOBS,
  jobsFor,
  matchesPath,
  RULES,
  SKILL_PROJECTIONS,
  selectJobs,
  VERSION_BRANCH,
} from '../../scripts/ci/workspace-jobs.mjs';
import { changedFiles, suitesFor } from '../../scripts/hooks/pre-push.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

for (const scenario of ['safe-fix warning', 'partially staged source', 'formatting error']) {
  test(`pre-commit preserves source and pins with ${scenario}`, () => {
    const repo = mkdtempSync(join(tmpdir(), 'pre-commit-'));
    const git = (...args) =>
      execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        encoding: 'utf8',
      });
    const sourcePath = 'packages/pipeline/lib/source.mjs';
    const pinPath = 'packages/pipeline/lib/pins.json';
    const digest = (source) => createHash('sha256').update(source).digest('hex');
    const writeSourceAndPin = (source) => {
      writeFileSync(join(repo, sourcePath), source);
      writeFileSync(join(repo, pinPath), `{ "sha256": "${digest(source)}" }\n`);
    };
    try {
      git('init', '-q');
      git('config', 'core.hooksPath', '/dev/null');
      mkdirSync(join(repo, 'packages/pipeline/lib'), { recursive: true });
      for (const file of ['.lintstagedrc.mjs', 'biome.jsonc'])
        copyFileSync(join(root, file), join(repo, file));
      writeSourceAndPin('export const hasPreserve = () => false;\n');
      git('add', '.');
      git('commit', '-q', '-m', 'fixture');
      symlinkSync(join(root, 'node_modules'), join(repo, 'node_modules'), 'dir');
      symlinkSync(join(root, 'scripts'), join(repo, 'scripts'), 'dir');
      writeSourceAndPin(
        scenario === 'formatting error'
          ? 'export const hasPreserve=(value)=>Object.hasOwn(value,"preserve")\n'
          : "export const hasPreserve = (value) => Object.prototype.hasOwnProperty.call(value, 'preserve');\n",
      );
      git('add', sourcePath, pinPath);
      if (scenario === 'partially staged source')
        writeFileSync(
          join(repo, sourcePath),
          readFileSync(join(repo, sourcePath), 'utf8') + "export const note = 'unstaged';\n",
        );
      const staged = git('diff', '--cached', '--binary');
      const unstaged = git('diff', '--binary');
      const source = readFileSync(join(repo, sourcePath), 'utf8');
      const pin = readFileSync(join(repo, pinPath), 'utf8');
      const result = spawnSync('sh', [join(root, '.husky/pre-commit')], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${join(root, 'node_modules/.bin')}:${process.env.PATH}` },
      });
      assert.ifError(result.error);
      assert.equal(
        result.status,
        scenario === 'formatting error' ? 1 : 0,
        result.stdout + result.stderr,
      );
      assert.equal(git('diff', '--cached', '--binary'), staged);
      assert.equal(git('diff', '--binary'), unstaged);
      assert.equal(readFileSync(join(repo, sourcePath), 'utf8'), source);
      assert.equal(readFileSync(join(repo, pinPath), 'utf8'), pin);
      assert.equal(
        JSON.parse(git('show', `:${pinPath}`)).sha256,
        digest(git('show', `:${sourcePath}`)),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
}

test('Browser selects only the lanes a change reaches', () => {
  assert.deepEqual(selectLanes(['docs/README.md']), {
    canvas: false,
    dashboard: false,
    artifact: false,
  });
  assert.deepEqual(selectLanes(['packages/canvas/src/camera.ts']), {
    canvas: true,
    dashboard: false,
    artifact: false,
  });
  assert.deepEqual(selectLanes(['packages/protocol/src/index.mjs']), {
    canvas: false,
    dashboard: true,
    artifact: false,
  });
  assert.deepEqual(selectLanes(['packages/pipeline/tests/artifact/codec.test.mjs']), {
    canvas: false,
    dashboard: false,
    artifact: true,
  });
  for (const shared of ['package-lock.json', '.github/workflows/browser.yml'])
    assert.deepEqual(selectLanes([shared]), { canvas: true, dashboard: true, artifact: true });
  for (const editor of [
    'packages/artifact/lib/artifact/ui/diagram-editor-canvas.mts',
    'packages/artifact/lib/artifact/ui/stage.mjs',
    'packages/artifact/tests/diagram-editor-canvas.browser.test.mjs',
    'packages/artifact/tests/fixtures/diagram-editor-canvas.mjs',
  ])
    assert.deepEqual(selectLanes([editor]), { canvas: true, dashboard: false, artifact: true });
  assert.equal(selectLanes(['packages/artifact/tests/diagram-studio.test.mjs']).canvas, false);
  assert.equal(selectLanes(['packages/artifact/tests/fixtures/other.mjs']).canvas, false);
  assert.equal(selectLanes(['packages/canvas-extra/x.ts']).canvas, false);
  assert.equal(selectLanes(['packages/cli/package.json']).canvas, false);
});

test('pre-push runs the small suites of the changed workspaces only', () => {
  assert.deepEqual(suitesFor(['docs/README.md', 'packages/pipeline/lib/x.mjs']), []);
  assert.deepEqual(suitesFor(['tests/protocol/a.test.mjs', 'apps/dashboard/src/a.ts']), [
    '@openplanr/protocol',
    '@openplanr/dashboard-app',
  ]);
  assert.equal(suitesFor(['package-lock.json']).length, 6);
  assert.deepEqual(suitesFor(['packages/cli/src/a.ts', 'packages/design/a.mjs']), []);
});

test('pre-push diffs an existing branch against its remote and a new one against origin/main', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pre-push-'));
  const git = (...args) =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      encoding: 'utf8',
    }).trim();
  try {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'base.txt'), 'base');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    writeFileSync(join(repo, 'first.txt'), 'first');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    const first = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'second.txt'), 'second');
    git('add', '.');
    git('commit', '-q', '-m', 'second');
    const second = git('rev-parse', 'HEAD');
    const zero = '0'.repeat(40);
    const cwd = process.cwd();
    process.chdir(repo);
    try {
      assert.deepEqual(changedFiles([`refs/heads/x ${second} refs/heads/x ${zero}`]).sort(), [
        'first.txt',
        'second.txt',
      ]);
      assert.deepEqual(changedFiles([`refs/heads/x ${second} refs/heads/x ${first}`]), [
        'second.txt',
      ]);
      assert.deepEqual(changedFiles([`(delete) ${zero} refs/heads/x ${first}`]), []);
    } finally {
      process.chdir(cwd);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
const pullRequest = { event: 'pull_request', repo: 'openplanr/OpenPlanr' };
const fromBranch = (headRef, headRepo = pullRequest.repo) => ({
  ...pullRequest,
  headRef,
  headRepo,
});
const only = (...selected) => Object.fromEntries(JOBS.map((job) => [job, selected.includes(job)]));
const [DESIGN, SUPPORTING, SKILL_RUNTIME, PIPELINE, CLI] = JOBS;

test('Workspace CI selects the test jobs each kind of change reaches', () => {
  const cases = [
    [['docs/getting-started.md', 'README.md', '.changeset/x.md'], only()],
    [['tests/ci/ci-selection.test.mjs', 'scripts/hooks/pre-push.mjs', '.husky/pre-commit'], only()],
    [['skills/planr-ship/SKILL.md'], only(SUPPORTING, SKILL_RUNTIME, PIPELINE, CLI)],
    [['agents/qa/planr-qa/AGENT.md'], only(SUPPORTING, SKILL_RUNTIME, PIPELINE, CLI)],
    [['packages/protocol/registries/skills.json'], only(SUPPORTING, SKILL_RUNTIME, PIPELINE, CLI)],
    [['examples/skills/minimal-composed/SKILL.md'], only(SKILL_RUNTIME)],
    [['docs/maintainers/pipeline/x.md'], only(PIPELINE)],
    [['tests/skill-runtime/generation.test.mjs'], only(SKILL_RUNTIME)],
    [['tests/protocol/catalogs-and-routing.test.mjs'], only(SUPPORTING)],
    [['tests/protocol/fixtures/a.json'], only(SUPPORTING, SKILL_RUNTIME, CLI)],
    [['packages/cli/src/a.ts'], only(SUPPORTING, SKILL_RUNTIME, PIPELINE, CLI)],
    [['packages/pipeline/lib/a.mjs'], only(SUPPORTING, SKILL_RUNTIME, PIPELINE, CLI)],
    [['packages/integrations/lib/a.mjs'], only(SUPPORTING, CLI)],
    [['apps/dashboard/src/a.tsx'], only(SUPPORTING, PIPELINE, CLI)],
    [['packages/design/lib/a.mjs'], only(...JOBS)],
    [['packages/protocol/src/index.mjs'], only(...JOBS)],
    [['docs/assets/brand/README.md'], only(...JOBS)],
    [['package-lock.json'], only(...JOBS)],
    [['.github/workflows/nightly.yml'], only(...JOBS)],
    [['scripts/ci/workspace-jobs.mjs'], only(...JOBS)],
    [['tsconfig.declarations.json'], only(...JOBS)],
    [['new-top-level/file.txt'], only(...JOBS)],
    [['docs/x.md', 'packages/integrations/a.mjs'], only(SUPPORTING, CLI)],
  ];
  for (const [files, expected] of cases)
    assert.deepEqual(selectJobs(files, pullRequest), expected, files.join(', '));
});

test('Workspace CI runs every job outside a complete pull request file list', () => {
  const all = only(...JOBS);
  assert.deepEqual(selectJobs(['docs/x.md'], { event: 'merge_group' }), all);
  assert.deepEqual(selectJobs([], pullRequest), all);
  const many = Array.from({ length: FILE_LIMIT }, (_, index) => `docs/${index}.md`);
  assert.deepEqual(selectJobs(many, pullRequest), all);
  assert.deepEqual(selectJobs(many.slice(1), pullRequest), only());
  assert.deepEqual(
    selectJobs(['docs/x.md'], { event: 'merge_group', headRef: VERSION_BRANCH }),
    all,
  );
});

test('the version pull request from this repository runs only the always-on jobs', () => {
  const release = ['package-lock.json', 'packages/cli/package.json', '.changeset/a.md'];
  assert.deepEqual(selectJobs(release, fromBranch(VERSION_BRANCH)), only());
  assert.deepEqual(selectLanes(release, fromBranch(VERSION_BRANCH)), {
    canvas: false,
    dashboard: false,
    artifact: false,
  });
  for (const context of [fromBranch(VERSION_BRANCH, 'fork/OpenPlanr'), fromBranch('main')])
    assert.deepEqual(selectJobs(release, context), only(...JOBS));
});

test('recorded pull requests select the jobs their changes reach', () => {
  const skillTrigger = [
    '.changeset/skill-trigger-investigate-ship.md',
    'adapters/manifests/canonical-skills.json',
    'adapters/manifests/codex-plugin-content.json',
    'docs/generated/skills.md',
    'evaluation/skills/routing-corpus.json',
    'packages/pipeline/lib/generated/protocol-projection.json',
    'packages/protocol/registries/commands.json',
    'packages/protocol/registries/skills.json',
    'packages/protocol/src/generated/canonical-registries.mjs',
    'skills/planr-investigate/SKILL.md',
    'skills/planr-investigate/agents/openai.yaml',
    'skills/planr-investigate/openplanr.skill.json',
    'skills/registry.json',
  ];
  assert.deepEqual(
    selectJobs(skillTrigger, pullRequest),
    only(SUPPORTING, SKILL_RUNTIME, PIPELINE, CLI),
  );
  assert.deepEqual(selectLanes(skillTrigger), { canvas: false, dashboard: false, artifact: false });
  const specValidate = [
    '.changeset/spec-validate.md',
    'docs/generated/utility-command-catalog.json',
    'packages/cli/docs/CLI.md',
    'packages/cli/src/cli/commands/spec.ts',
    'packages/cli/tests/integration/spec-validate-command.test.ts',
    'packages/pipeline/lib/generated/protocol-projection.json',
    'packages/protocol/registries/commands.json',
    'packages/protocol/src/generated/canonical-registries.mjs',
  ];
  assert.deepEqual(
    selectJobs(specValidate, pullRequest),
    only(SUPPORTING, SKILL_RUNTIME, PIPELINE, CLI),
  );
  assert.deepEqual(selectLanes(specValidate), { canvas: false, dashboard: false, artifact: false });
  const dependabot = ['package-lock.json', 'packages/canvas/package.json', 'biome.jsonc'];
  assert.deepEqual(selectJobs(dependabot, fromBranch('dependabot/npm_and_yarn/x')), only(...JOBS));
});

test('Browser runs every lane outside a pull request and ignores the skill projections', () => {
  assert.deepEqual(selectLanes([], { event: 'merge_group' }), {
    canvas: true,
    dashboard: true,
    artifact: true,
  });
  for (const projection of ['packages/protocol/registries/skills.json', 'docs/generated/skills.md'])
    assert.equal(selectLanes([projection]).dashboard, false, projection);
  assert.equal(selectLanes(['packages/protocol/registries/roles.json']).dashboard, true);
});

test('selector path patterns match prefixes, segment wildcards and exact paths', () => {
  assert.ok(matchesPath('packages/cli/src/a.ts', 'packages/cli/'));
  assert.ok(!matchesPath('packages/cli-extra/a.ts', 'packages/cli/'));
  assert.ok(matchesPath('README.md', '*.md'));
  assert.ok(!matchesPath('docs/README.md', '*.md'));
  assert.ok(matchesPath('tsconfig.declarations.json', 'tsconfig*'));
  assert.ok(
    matchesPath(
      'packages/artifact/tests/diagram-editor-x.mjs',
      'packages/artifact/tests/diagram-editor*',
    ),
  );
  assert.ok(!matchesPath('package.json.bak', 'package.json'));
});

test('every tracked file matches an explicit Workspace CI rule', () => {
  const unmatched = tracked.filter(
    (file) => !RULES.some(({ paths }) => paths.some((pattern) => matchesPath(file, pattern))),
  );
  assert.deepEqual(unmatched, []);
});

const LANE_DIRECTORIES = Object.freeze({
  [DESIGN]: ['packages/design/'],
  [SUPPORTING]: [
    'packages/protocol/',
    'tests/protocol/',
    'packages/canvas/',
    'packages/operate/',
    'packages/artifact/',
    'packages/integrations/',
    'apps/dashboard/',
  ],
  [SKILL_RUNTIME]: ['packages/skill-runtime/', 'tests/skill-runtime/'],
  [PIPELINE]: ['packages/pipeline/'],
  [CLI]: ['packages/cli/'],
});
// Ignored outputs a lane runs, and the tracked sources the build derives them from.
const EMBEDDED_SOURCES = Object.freeze({
  [PIPELINE]: [
    'packages/protocol/',
    'packages/canvas/',
    'packages/artifact/',
    'packages/operate/',
    'packages/design/',
  ],
  [CLI]: [
    'skills/',
    'agents/',
    'packages/skill-runtime/',
    'packages/integrations/',
    'apps/dashboard/',
    'packages/pipeline/',
  ],
  [SKILL_RUNTIME]: ['skills/', 'agents/'],
});
const WORKSPACES = Object.freeze(
  Object.fromEntries(
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).workspaces.map((path) => [
      JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8')).name,
      `${path}/`,
    ]),
  ),
);
const inLane = (lane, file) => LANE_DIRECTORIES[lane].some((prefix) => file.startsWith(prefix));
const under = (path) =>
  tracked.filter((file) => file === path || file.startsWith(`${path.replace(/\/$/u, '')}/`));
// Lanes that read no skill registry may skip the skill projections of a dependency.
const projection = (file) => SKILL_PROJECTIONS.some((pattern) => matchesPath(file, pattern));
const REGISTRY_READ = /registries\/(?:skills|commands)|canonical-registries|CANONICAL_REGISTRIES/u;
const missedBy = (lane, files, { exemptProjections = false } = {}) =>
  files.filter(
    (file) =>
      !inLane(lane, file) &&
      !(exemptProjections && projection(file)) &&
      !jobsFor(file).includes(lane),
  );

test('every file of a lane and of the sources it embeds selects that lane', () => {
  for (const lane of JOBS) {
    const own = tracked.filter((file) => inLane(lane, file));
    assert.deepEqual(
      own.filter((file) => !jobsFor(file).includes(lane)),
      [],
      lane,
    );
    const embedded = (EMBEDDED_SOURCES[lane] ?? []).flatMap(under);
    assert.deepEqual(missedBy(lane, embedded), [], `${lane} embedded sources`);
  }
});

test('a lane runs when a workspace it depends on changes', () => {
  for (const lane of JOBS) {
    const readsRegistries = tracked.some(
      (file) =>
        inLane(lane, file) &&
        /\.(?:[cm]?[jt]sx?|mts)$/u.test(file) &&
        REGISTRY_READ.test(readFileSync(join(root, file), 'utf8')),
    );
    const manifests = tracked.filter(
      (file) =>
        inLane(lane, file) && /(^|\/)package\.json$/u.test(file) && !file.includes('/fixtures/'),
    );
    const dependencies = manifests.flatMap((file) => {
      const manifest = JSON.parse(readFileSync(join(root, file), 'utf8'));
      return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
        .flatMap((field) => Object.keys(manifest[field] ?? {}))
        .flatMap((name) => (WORKSPACES[name] ? [WORKSPACES[name]] : []));
    });
    const files = [...new Set(dependencies)].flatMap(under);
    assert.deepEqual(missedBy(lane, files, { exemptProjections: !readsRegistries }), [], lane);
  }
});

const TOP_LEVEL = [...new Set(tracked.map((file) => file.split('/')[0]))].filter((name) =>
  tracked.some((file) => file.startsWith(`${name}/`)),
);
const escaped = TOP_LEVEL.map((name) => name.replace(/[.]/gu, '\\.')).join('|');
const SPECIFIER = /(?:\bfrom|\bimport\(?|\brequire\()\s*['"]([^'"]+)['"]/gu;
const URL_LITERAL = /new URL\(\s*['"`]([^'"`$]+)['"`]\s*,\s*import\.meta\.url/gu;
const PATH_LITERAL = new RegExp(`['"\`]((?:\\.\\./)*)((?:${escaped})/[^'"\`$\\s]*)`, 'gu');
// join(root, 'skills', ...) where the first argument names the repository root.
const ROOT_JOIN = new RegExp(
  `(?:join|resolve)\\(\\s*\\w*root\\w*\\s*,\\s*['"](${escaped})['"]((?:\\s*,\\s*['"][^'"]+['"])*)`,
  'giu',
);

// Strings that name a path in a fixture tree or a coverage label rather than read this one.
const NAMED_ELSEWHERE = new Set([
  'packages/cli/tests/unit/ship-checks.test.ts .husky/pre-commit',
  'packages/cli/tests/unit/ship-checks.test.ts .husky/pre-push',
  'packages/protocol/scripts/protocol-definitions.mjs tests/ecosystem-root/ecosystem-generation.test.mjs',
  'packages/protocol/src/generated/canonical-registries.mjs tests/ecosystem-root/ecosystem-generation.test.mjs',
]);

/**
 * Repository paths a source file imports or names, resolved from the repository root. A bare
 * top-level directory is a path convention, not a read; EMBEDDED_SOURCES covers whole trees.
 */
function references(file) {
  const text = readFileSync(join(root, file), 'utf8');
  const found = new Set();
  const add = (path) => {
    const resolved = normalize(path).replace(/\/$/u, '');
    if (resolved.startsWith('..') || !resolved.includes('/')) return;
    if (!NAMED_ELSEWHERE.has(`${file} ${resolved}`)) found.add(resolved);
  };
  for (const [, specifier] of text.matchAll(SPECIFIER)) {
    if (specifier.startsWith('.')) add(join(dirname(file), specifier));
    else {
      const name = specifier
        .split('/')
        .slice(0, specifier.startsWith('@') ? 2 : 1)
        .join('/');
      if (WORKSPACES[name]) add(WORKSPACES[name] + specifier.slice(name.length));
    }
  }
  for (const [, path] of text.matchAll(URL_LITERAL)) add(join(dirname(file), path));
  for (const [, up, path] of text.matchAll(PATH_LITERAL))
    add(up ? join(dirname(file), up, path) : path);
  for (const [, first, rest] of text.matchAll(ROOT_JOIN))
    add([first, ...[...rest.matchAll(/['"]([^'"]+)['"]/gu)].map(([, part]) => part)].join('/'));
  return found;
}

test('a lane runs when a tracked file its code or tests read changes', () => {
  const missed = {};
  for (const lane of JOBS) {
    const code = tracked.filter(
      (file) =>
        inLane(lane, file) && /\.(?:[cm]?[jt]sx?|mts)$/u.test(file) && !file.includes('/fixtures/'),
    );
    const read = new Set();
    for (const file of code)
      for (const path of references(file)) {
        const targets = under(path);
        const exact = targets.length
          ? targets
          : tracked.filter((candidate) => candidate.startsWith(`${path}.`));
        for (const target of exact) read.add(target);
      }
    const files = missedBy(lane, [...read]);
    if (files.length) missed[lane] = files.sort();
  }
  assert.deepEqual(missed, {});
});

const selectorStep = (workflow, job, id) =>
  load(readFileSync(join(root, '.github/workflows', workflow), 'utf8')).jobs[job].steps.find(
    (step) => step.id === id,
  );
// Runs the workflow's own jq filter over a pull request files API page.
const changedPaths = (step, page) => {
  const filter = /--jq '([^']+)'/u.exec(step.run)?.[1];
  assert.ok(filter, `${step.name} must list files with gh api --jq`);
  const result = spawnSync('jq', ['-r', filter], { input: JSON.stringify(page), encoding: 'utf8' });
  assert.ok(!result.error, `jq is required to run the workflow's filter: ${result.error?.message}`);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\n').filter(Boolean);
};

test('a renamed file selects by its old path as well as its new one', () => {
  const moved = [
    {
      filename: 'docs/a.mjs',
      previous_filename: 'packages/skill-runtime/lib/a.mjs',
      status: 'renamed',
    },
    { filename: 'docs/b.md', status: 'modified' },
  ];
  const workspace = changedPaths(selectorStep('ci.yml', 'changes', 'select'), moved);
  assert.deepEqual(
    selectJobs(workspace, pullRequest),
    only(SUPPORTING, SKILL_RUNTIME, PIPELINE, CLI),
  );
  const canvas = [
    { filename: 'docs/x.ts', previous_filename: 'packages/canvas/src/x.ts', status: 'renamed' },
  ];
  const lanes = changedPaths(selectorStep('browser.yml', 'changes', 'lanes'), canvas);
  assert.equal(selectLanes(lanes).canvas, true);
});

test('code on the version branch selects as on any other branch', () => {
  const version = fromBranch(VERSION_BRANCH);
  const release = [
    '.changeset/spec-validate.md',
    '.claude-plugin/marketplace.json',
    'adapters/manifests/canonical-skills.json',
    'apps/dashboard/CHANGELOG.md',
    'apps/dashboard/package.json',
    'docs/generated/ecosystem.md',
    'package-lock.json',
    'packages/cli/CHANGELOG.md',
    'packages/cli/package.json',
  ];
  assert.deepEqual(selectJobs(release, version), only());
  for (const extra of ['packages/cli/src/a.ts', 'skills/planr-ship/SKILL.md', 'package.json']) {
    assert.deepEqual(
      selectJobs([...release, extra], version),
      selectJobs([...release, extra], pullRequest),
      extra,
    );
    assert.deepEqual(
      selectLanes([...release, extra], version),
      selectLanes([...release, extra]),
      extra,
    );
  }
});

test('the selectors never print a changed path where the runner reads workflow commands', () => {
  for (const script of ['scripts/ci/workspace-jobs.mjs', 'scripts/ci/browser-lanes.mjs']) {
    const result = spawnSync(process.execPath, [script, '--event', 'pull_request'], {
      cwd: root,
      input: '::error::injected\n  ::add-mask::secret\n',
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    for (const line of `${result.stdout}\n${result.stderr}`.split('\n'))
      assert.doesNotMatch(line.trimStart(), /^::/u, `${script}: ${line}`);
  }
});

test('a container job that runs the selector test installs jq before it', () => {
  const needsJq = (run = '') => /test:focused|tests\/ci\//u.test(run);
  const installsJq = (run = '') =>
    /\bjq-linux/u.test(run) && /sha256sum --check/u.test(run) && /GITHUB_PATH/u.test(run);
  const missing = [];
  for (const file of readdirSync(join(root, '.github/workflows')).filter((f) =>
    f.endsWith('.yml'),
  )) {
    const { jobs = {} } = load(readFileSync(join(root, '.github/workflows', file), 'utf8'));
    for (const [name, job] of Object.entries(jobs)) {
      if (!job.container) continue;
      const steps = job.steps ?? [];
      const first = steps.findIndex((step) => needsJq(step.run));
      if (first === -1) continue;
      if (!steps.slice(0, first).some((step) => installsJq(step.run)))
        missing.push(`${file}:${name}`);
    }
  }
  assert.deepEqual(missing, []);
});
