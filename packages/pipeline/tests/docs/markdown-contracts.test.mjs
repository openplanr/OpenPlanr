import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const PIPELINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKSPACE_ROOT = resolve(PIPELINE_ROOT, '../..');
const readPipeline = (path) => readFileSync(join(PIPELINE_ROOT, path), 'utf8');
const readWorkspace = (path) => readFileSync(join(WORKSPACE_ROOT, path), 'utf8');

test('canonical skill references resolve within their standard packages', () => {
  const catalog = JSON.parse(readWorkspace('adapters/manifests/canonical-skills.json'));
  const missing = [];
  for (const skill of catalog.skills) {
    const skillRoot = join(WORKSPACE_ROOT, 'skills', skill.id);
    const markdown = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8');
    for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      const target = match[1];
      if (/^(?:https?:|#)/u.test(target) || target.includes('<')) continue;
      if (!existsSync(resolve(skillRoot, target))) missing.push(`${skill.id} -> ${target}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('active pipeline docs do not carry stale release-version claims', () => {
  const activeDocs = [
    'README.md',
    'docs/protocol/README.md',
    'docs/compatibility-matrix.md',
    'docs/protocol/spec-artifacts.md',
    'input/tech/stack.md',
    'schemas/v1.0.0/pipeline-shipped.schema.json',
  ];
  const stale = [
    ['planr-pipeline v0.6.0', /planr-pipeline v0\.6\.0/u],
    ['planr-pipeline v0.13.0', /planr-pipeline v0\.13\.0/u],
    ['pinned model v0.10.0 note', /v0\.10\.0/u],
    ['stack/schema example 0.7.3', /\b0\.7\.3\b/u],
    ['uppercase qa_gate_status PASS', /qa_gate_status:\s*PASS\b/u],
  ];
  const hits = [];
  for (const file of activeDocs) {
    const text = readPipeline(file);
    for (const [label, pattern] of stale) {
      if (pattern.test(text)) hits.push(`${file}: ${label}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('semantic skills execute in-session without model-backed CLI delegation', () => {
  const forbidden =
    /`planr\s+(?:plan|spec\s+decompose)(?:\s|`)|`planr-pipeline(?:\s|`)|ANTHROPIC_API_KEY|OPENAI_API_KEY|OLLAMA_HOST/u;
  for (const skillId of [
    'planr-plan',
    'planr-spec',
    'planr-ship',
    'planr-operate',
    'planr-design',
    'planr-design-loop',
    'planr-design-review',
    'planr-plan-review',
    'planr-investigate',
    'planr-browser-qa',
    'planr-land',
  ]) {
    const skill = readWorkspace(`skills/${skillId}/SKILL.md`);
    assert.doesNotMatch(skill, forbidden, skillId);
  }
});

test('design skills keep sharing and Plan or Ship transitions explicit', () => {
  const transitionBoundaries = {
    'planr-design': /Plan, Ship, creating a share link and deployment are separate user actions/iu,
    'planr-design-loop':
      /Selection does not start Plan or Ship or authorize creating or sending a review link or deployment/iu,
    'planr-design-review':
      /never auto-starts Plan, Ship, publication, deployment, review-link creation or review-URL import/iu,
  };
  for (const [skillId, boundary] of Object.entries(transitionBoundaries)) {
    const skill = readWorkspace(`skills/${skillId}/SKILL.md`).replace(/\s+/gu, ' ');
    assert.match(
      skill,
      boundary,
      `${skillId} must preserve its transition and publication boundary`,
    );
    assert.doesNotMatch(skill, /planr-pipeline/iu, skillId);
  }
});

test('runtime compatibility schema stays valid without leaking release machinery into Ship', () => {
  const schema = JSON.parse(readPipeline('schemas/v1.0.0/pipeline-shipped.schema.json'));
  const ship = readWorkspace('skills/planr-ship/SKILL.md');
  assert.deepEqual(schema.properties.qa_gate_status.enum, ['passed', 'failed', 'skipped']);
  assert.doesNotMatch(ship, /qa_gate_status:|compatibility manifest|receipt|digest/iu);
  assert.match(ship, /Next: planr-land/u);
});

test('Claude role agents inherit the host model and are generated only for Claude', () => {
  const roles = JSON.parse(readWorkspace('adapters/manifests/role-assets.json'));
  assert.equal(roles.roleIds.length, 9);
  for (const role of roles.roles) {
    const source = readWorkspace(role.source);
    const generated = readWorkspace(role.path);
    assert.doesNotMatch(source, /^model:/mu, role.id);
    assert.doesNotMatch(generated, /^model:/mu, role.id);
    assert.doesNotMatch(generated, /claude-[a-z0-9-]+\[[^\]]+\]/iu, role.id);
  }
  assert.equal(existsSync(join(WORKSPACE_ROOT, 'dist/plugins/openai/openplanr/agents')), false);
});

test('ownership map names every consolidated domain and the external web boundary', () => {
  const ownership = readPipeline('docs/ownership-map.md');
  for (const domain of [
    'packages/cli',
    'packages/pipeline',
    'packages/protocol',
    'packages/operate',
    'packages/artifact',
    'packages/design',
    'packages/skill-runtime',
  ]) {
    assert.match(ownership, new RegExp(domain.replace('/', '\\/'), 'u'));
  }
  assert.match(ownership, /external hosted service/u);
  assert.doesNotMatch(ownership, /five OpenPlanr repositories/u);
});

test('release checklist covers the consolidated public release train and external web', () => {
  const checklist = readPipeline('docs/release-checklist.md');
  assert.match(checklist, /complete OpenPlanr workspace/u);
  assert.match(checklist, /pack both public packages/u);
  assert.match(checklist, /Publish `planr-pipeline`/u);
  assert.match(checklist, /Publish `openplanr`/u);
  assert.match(checklist, /do not publish packages or deploy services/u);
});

test('doctor and ecosystem docs describe the prompt-free consolidated boundary', () => {
  const doctor = readPipeline('docs/doctor.md');
  const guide = readPipeline('docs/ecosystem-guide.md');
  assert.match(doctor, /--strict/u);
  assert.match(doctor, /--release/u);
  assert.match(doctor, /--json/u);
  assert.match(doctor, /prompt-free runtime package/u);
  assert.match(guide, /`packages\/pipeline` is the public delivery package/u);
  assert.match(
    guide,
    /`skills\/`, `agents\/`, and `packages\/skill-runtime` own workflow sources/u,
  );
  assert.match(guide, /The hosted service is the independently deployed surface/u);
});
