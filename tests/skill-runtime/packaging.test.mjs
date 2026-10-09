import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSkillReleaseTree,
  createDeterministicZip,
  readDeterministicZip,
  renderOpenAiSkillMetadata,
} from '../../packages/skill-runtime/src/packaging/index.mjs';

const skill = (id, body = '# Example\n') => [
  {
    path: 'SKILL.md',
    bytes: Buffer.from(
      `---\nname: ${id}\ndescription: Review an example. Use when an example needs review.\n---\n\n${body}`,
    ),
  },
  {
    path: 'agents/openai.yaml',
    bytes: Buffer.from(`interface:\n  default_prompt: "Use $${id} to review this example"\n`),
  },
];

test('Codex metadata is concise, quoted, implicitly discoverable, and explicitly invokable', () => {
  const metadata = renderOpenAiSkillMetadata({
    skillId: 'planr-example',
    description:
      'Review an example workflow with precise, actionable recommendations. Use when the user asks for an example review.',
  });
  assert.match(metadata, /display_name: "OpenPlanr Example"/u);
  assert.match(metadata, /short_description: ".{25,64}"/u);
  assert.match(metadata, /default_prompt: "Use \$planr-example to /u);
  assert.match(metadata, /allow_implicit_invocation: true/u);
  assert.equal(metadata.endsWith('\n'), true);
});

test('Codex metadata keeps a user-only skill out of implicit invocation', () => {
  const metadata = renderOpenAiSkillMetadata({
    skillId: 'planr-share',
    description: 'Share an update.',
    invocation: '$planr:share',
    allowImplicitInvocation: false,
  });
  assert.match(metadata, /^policy:\n {2}allow_implicit_invocation: false$/mu);
  assert.throws(
    () =>
      renderOpenAiSkillMetadata({
        skillId: 'planr-share',
        description: 'Share an update.',
        allowImplicitInvocation: 'no',
      }),
    (error) => error.code === 'E_SKILL_OPENAI_METADATA_INVALID',
  );
});

test('Codex metadata accepts a short namespaced plugin invocation', () => {
  const metadata = renderOpenAiSkillMetadata({
    skillId: 'planr-example',
    description: 'Review an example.',
    invocation: '$planr:example',
  });
  assert.match(metadata, /default_prompt: "Use \$planr:example to review an example\."/u);
});

test('skill cards use product branding and preserve role acronyms without changing invocation', () => {
  for (const [skillId, label] of [
    ['planr-ceo-review', 'OpenPlanr CEO Review'],
    ['planr-cto-review', 'OpenPlanr CTO Review'],
    ['planr-cpo-review', 'OpenPlanr CPO Review'],
    ['planr-cmo-review', 'OpenPlanr CMO Review'],
    ['planr-coo-review', 'OpenPlanr COO Review'],
    ['planr-browser-qa', 'OpenPlanr Browser QA'],
    ['planr-openplanr', 'OpenPlanr Router'],
  ]) {
    const invocation = `$planr:${skillId.slice('planr-'.length)}`;
    const metadata = renderOpenAiSkillMetadata({
      skillId,
      description: 'Review the selected context.',
      invocation,
    });
    assert.ok(metadata.includes(`display_name: "${label}"`), skillId);
    assert.ok(metadata.includes(`Use ${invocation} to review the selected context.`), skillId);
    assert.match(metadata, /allow_implicit_invocation: true/u);
  }
});

test('metadata preserves unbranded skill identities, including object property names', () => {
  const metadata = renderOpenAiSkillMetadata({
    skillId: 'constructor-review',
    description: 'Review a constructor.',
  });
  assert.match(metadata, /display_name: "Constructor Review"/u);
  assert.match(metadata, /default_prompt: "Use \$constructor-review to review a constructor\."/u);
});

test('deterministic ZIPs are byte-stable, sorted, readable, and corruption-aware', () => {
  const input = [
    { path: 'planr-example/references/guide.md', bytes: '# Guide\n' },
    {
      path: 'planr-example/SKILL.md',
      bytes: '---\nname: planr-example\ndescription: Example\n---\n\n# Example\n',
    },
  ];
  const first = createDeterministicZip(input);
  const second = createDeterministicZip([...input].reverse());
  assert.deepEqual(first, second);
  assert.deepEqual(
    readDeterministicZip(first).map(({ path, bytes }) => ({ path, bytes: bytes.toString('utf8') })),
    [...input].sort((left, right) => left.path.localeCompare(right.path)),
  );

  const corrupt = Buffer.from(first);
  const contentOffset = corrupt.indexOf(Buffer.from('# Example\n'));
  corrupt[contentOffset] ^= 0xff;
  assert.throws(() => readDeterministicZip(corrupt), { code: 'E_SKILL_ARCHIVE_CRC' });
});

test('deterministic ZIPs reject traversal and duplicate paths', () => {
  assert.throws(() => createDeterministicZip([{ path: '../secret', bytes: '' }]), {
    code: 'E_SKILL_ARCHIVE_PATH_INVALID',
  });
  assert.throws(
    () =>
      createDeterministicZip([
        { path: 'skill/SKILL.md', bytes: 'first' },
        { path: 'skill/SKILL.md', bytes: 'second' },
      ]),
    { code: 'E_SKILL_ARCHIVE_PATH_DUPLICATE' },
  );
});

test('one typed release packager owns canonical skill and suite units without aliases', () => {
  const canonical = skill('planr-example');
  const products = new Map([
    ['dist/plugins/openai/openplanr/skills/planr-example', canonical],
    [
      'dist/plugins/openai/openplanr',
      [
        { path: '.codex-plugin/plugin.json', bytes: Buffer.from('{"name":"openplanr"}\n') },
        ...canonical.map(({ path, bytes }) => ({ path: `skills/planr-example/${path}`, bytes })),
      ],
    ],
  ]);
  const input = {
    workspaceVersion: '0.1.0',
    sourceRegistry: {
      skills: [{ skillId: 'planr-example', skillVersion: '1.2.3' }],
      aliases: [],
    },
    contentManifest: {
      pluginRoot: 'dist/plugins/openai/openplanr',
      skillRoot: './skills/',
      skills: [{ skillId: 'planr-example', classification: 'canonical' }],
    },
    readProductEntries: (source) =>
      products.get(source).map(({ path, bytes }) => ({ path, bytes: Buffer.from(bytes) })),
    licenseBytes: Buffer.from('MIT\n'),
    hostProducts: [],
  };
  const first = buildSkillReleaseTree(input);
  const second = buildSkillReleaseTree(input);
  assert.equal(first.index.canonicalSkillCount, 1);
  assert.equal(first.index.compatibilityAliasCount, 0);
  assert.equal(first.index.productCount, 2);
  assert.deepEqual([...first.tree], [...second.tree]);
  assert.equal(first.tree.has('archives/planr-example-1.2.3.zip'), true);
  assert.equal(first.tree.has('archives/openplanr-example-0.1.0.zip'), false);
});
