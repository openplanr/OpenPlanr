import assert from 'node:assert/strict';
import test from 'node:test';

import {
  linkSkillProjection,
  parseSkillContentLinks,
} from '../../packages/skill-runtime/src/linker/index.mjs';

const primary = (bytes) => ({ path: 'SKILL.md', bytes });
const reference = (path, bytes = '# Supporting guidance\n') => ({ path, bytes });

test('content linker resolves packaged Markdown references into one closed release unit', () => {
  const result = linkSkillProjection({
    skillId: 'planr-example',
    host: 'codex',
    primary: primary('# Example\n\nRead the [supporting guide](references/guide.md).\n'),
    references: [reference('references/guide.md')],
  });

  assert.deepEqual(result.assets, ['SKILL.md', 'references/guide.md']);
  assert.deepEqual(result.links, [{ from: 'SKILL.md', to: 'references/guide.md', line: 3 }]);
  assert.deepEqual(result.linkedSupport, ['references/guide.md']);
});

test('content linker reports the source line and repair for a missing reference', () => {
  assert.throws(
    () => linkSkillProjection({
      skillId: 'planr-example',
      host: 'codex',
      primary: primary('# Example\n\nRead [the guide](references/missing.md).\n'),
    }),
    (error) => {
      assert.equal(error.code, 'E_SKILL_CONTENT_LINK_MISSING');
      assert.equal(error.details.path, 'SKILL.md');
      assert.equal(error.details.line, 3);
      assert.equal(error.details.target, 'references/missing.md');
      assert.match(error.details.repair, /Declare and generate/u);
      return true;
    },
  );
});

test('content linker rejects opaque inline-code dependencies', () => {
  assert.throws(
    () => linkSkillProjection({
      skillId: 'planr-dashboard',
      host: 'codex',
      primary: primary('Run `procedures/dashboard-preflight.md` before starting.\n'),
    }),
    (error) => {
      assert.equal(error.code, 'E_SKILL_CONTENT_REFERENCE_AMBIGUOUS');
      assert.equal(error.details.target, 'procedures/dashboard-preflight.md');
      assert.match(error.details.repair, /Markdown link/u);
      return true;
    },
  );
});

test('content linker rejects orphaned, case-mismatched, and unsafe support content', () => {
  assert.throws(
    () => linkSkillProjection({
      skillId: 'planr-example',
      host: 'claude-code',
      primary: primary('# Example\n'),
      references: [reference('references/unused.md')],
    }),
    { code: 'E_SKILL_CONTENT_ASSET_ORPHANED' },
  );

  assert.throws(
    () => linkSkillProjection({
      skillId: 'planr-example',
      host: 'cursor',
      primary: primary('[Guide](references/Guide.md)\n'),
      references: [reference('references/guide.md')],
    }),
    { code: 'E_SKILL_CONTENT_LINK_CASE' },
  );

  assert.throws(
    () => parseSkillContentLinks({
      skillId: 'planr-example',
      host: 'codex',
      path: 'SKILL.md',
      bytes: '[Escape](../private.md)\n',
    }),
    { code: 'E_SKILL_CONTENT_LINK_UNSAFE' },
  );
});
