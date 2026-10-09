import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const REGENERATE = '.github/workflows/dependabot-regenerate.yml';
const PUSH = '.github/workflows/dependabot-regenerate-push.yml';
const regenerate = readFileSync(resolve(root, REGENERATE), 'utf8');
const push = readFileSync(resolve(root, PUSH), 'utf8');
const MANIFESTS = [
  'adapters/manifests/canonical-skills.json',
  'adapters/manifests/codex-plugin-content.json',
];

// The repository declares no YAML parser for its tests, so these read the fixed layout.
function topLevel(text, key) {
  const match = new RegExp(`^${key}:.*\\n(?:(?: .*)?\\n)*`, 'mu').exec(text);
  assert.ok(match, `the workflow must declare ${key}`);
  return match[0].trimEnd();
}

function jobKey(text, key) {
  const match = new RegExp(`^ {4}${key}:(.*)\\n((?: {6}.*\\n)*)`, 'mu').exec(text);
  assert.ok(match, `the job must declare ${key}`);
  return `${match[1].trim()}\n${match[2]}`.trim();
}

function runScripts(text) {
  const lines = text.split('\n');
  return lines.flatMap((line, index) => {
    const match = /^(\s*)(- )?run: (.*)$/u.exec(line);
    if (!match) return [];
    if (match[3] !== '|') return [match[3]];
    const indent = match[1].length + (match[2] ? 2 : 0);
    const end = lines.findIndex(
      (next, at) => at > index && next.trim() !== '' && next.search(/\S/u) <= indent,
    );
    return [lines.slice(index + 1, end === -1 ? lines.length : end).join('\n')];
  });
}

function listedPaths(text) {
  const match = /^ {2}REGENERATED_PATHS: \|-\n((?: {4}\S.*\n)+)/mu.exec(text);
  assert.ok(match, 'the workflow must list the paths it regenerates');
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

test('both halves list exactly the custody manifests', () => {
  assert.deepEqual(listedPaths(regenerate), MANIFESTS);
  assert.deepEqual(listedPaths(push), MANIFESTS);
});

test('regeneration runs Dependabot npm pull requests with a read-only token and no secrets', () => {
  assert.match(topLevel(regenerate, 'on'), /^ {2}pull_request:$/mu);
  assert.doesNotMatch(topLevel(regenerate, 'on'), /^ {2}(?!pull_request:)\S/mu);
  assert.equal(topLevel(regenerate, 'permissions'), 'permissions:\n  contents: read');
  assert.equal(regenerate.match(/permissions:/gu).length, 1, 'no job may widen the token');
  assert.doesNotMatch(regenerate, /secrets\.|github\.token/u);
  assert.match(regenerate, /persist-credentials: false/u);
  const gate = jobKey(regenerate, 'if');
  for (const condition of [
    "github.actor == 'dependabot[bot]'",
    "github.event.pull_request.user.login == 'dependabot[bot]'",
    'github.event.pull_request.head.repo.full_name == github.repository',
    "startsWith(github.head_ref, 'dependabot/npm_and_yarn/')",
  ])
    assert.ok(gate.includes(condition), `the regeneration job must require ${condition}`);
  assert.ok(runScripts(regenerate).includes('npm run generate'));
});

test('the push runs from main after a Dependabot regeneration and never runs its code', () => {
  const name = /^name: (.+)$/mu.exec(regenerate)[1];
  assert.match(
    topLevel(push, 'on'),
    new RegExp(`^ {2}workflow_run:\\n {4}workflows: \\['${name}'\\]`, 'mu'),
  );
  assert.doesNotMatch(topLevel(push, 'on'), /^ {2}(?!workflow_run:)\S/mu);
  assert.equal(topLevel(push, 'permissions'), 'permissions: {}');
  assert.equal(
    jobKey(push, 'permissions'),
    'actions: read\n      contents: write\n      pull-requests: read',
  );
  const gate = jobKey(push, 'if');
  for (const condition of [
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'pull_request'",
    `github.event.workflow_run.path == '${REGENERATE}'`,
    "github.event.workflow_run.actor.login == 'dependabot[bot]'",
    'github.event.workflow_run.head_repository.full_name == github.repository',
    "startsWith(github.event.workflow_run.head_branch, 'dependabot/npm_and_yarn/')",
  ])
    assert.ok(gate.includes(condition), `the push job must require ${condition}`);
  for (const uses of push.match(/uses: \S+/gu))
    assert.match(uses, /^uses: actions\/checkout@/u, 'the push may use no action but checkout');
  assert.doesNotMatch(push, /cache:|setup-node|secrets\./u);
  const scripts = runScripts(push).join('\n');
  assert.doesNotMatch(scripts, /\b(?:npm|npx|node|yarn|pnpm|bash|sh|source|eval)\b|\.\//u);
  assert.deepEqual(
    scripts
      .split('\n')
      .filter((line) => line.includes('git push'))
      .map((line) => line.trim()),
    ['git push origin "HEAD:refs/heads/$HEAD_BRANCH"'],
    'the push must fast-forward the Dependabot branch and never force it',
  );
  assert.match(scripts, /\[dependabot skip\]/u);
});

test('the push takes each manifest once and caps the bytes it writes', () => {
  const scripts = runScripts(push).join('\n');
  assert.match(scripts, /\| sort \| uniq -d\)"/u, 'the push must reject a repeated member');
  assert.match(
    scripts,
    /unzip -p "\$ARCHIVE" "\$path" > "\$path"\n\s+size="\$\(wc -c < "\$path"\)"\n\s+if \[ "\$size" -gt "\$MANIFEST_BYTE_LIMIT" \]/u,
    'the push must measure each manifest it writes against the limit',
  );
  assert.match(push, /^ {10}MANIFEST_BYTE_LIMIT: [1-9]\d*$/mu, 'the push must set a byte limit');
});

test('no run script interpolates an expression', () => {
  for (const [file, text] of [
    [REGENERATE, regenerate],
    [PUSH, push],
  ])
    for (const script of runScripts(text))
      assert.doesNotMatch(script, /\$\{\{/u, `${file} must pass values through env`);
});
