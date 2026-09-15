import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareScreenedOperateEvidence } from '../../src/services/operate/screened-evidence-service.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('automatic screened Operate evidence preparation', () => {
  it('issues resolver-owned architecture, planning, and CI candidates without repository.read', async () => {
    const root = mkdtempSync(join(tmpdir(), 'operate-screened-evidence-'));
    roots.push(root);
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    mkdirSync(join(root, '.planr', 'specs', 'SPEC-001-hardening'), { recursive: true });
    mkdirSync(join(root, '.planr', 'operate', 'state'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"name":"screened"}\n');
    writeFileSync(join(root, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}\n');
    writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
    writeFileSync(
      join(root, '.planr', 'specs', 'SPEC-001-hardening', 'SPEC-001-hardening.md'),
      '# Acceptance\n',
    );
    writeFileSync(join(root, '.planr', 'operate', 'state', 'private.json'), '{"private":true}\n');
    let issued = 0;

    const prepared = await prepareScreenedOperateEvidence({
      projectDir: root,
      scope: { scopeId: 'workspace', domainId: 'business', domainVersion: '1.0.0' },
      sourceArtifactId: 'art_screened_source_0001',
      issueCandidateId: () => `evc_screened_candidate_${++issued}`,
    });

    expect(prepared.map((entry) => entry.relativePath)).toEqual([
      'package.json',
      'tsconfig.json',
      '.github/workflows/ci.yml',
      '.planr/specs/SPEC-001-hardening/SPEC-001-hardening.md',
    ]);
    expect(prepared.map((entry) => entry.sourceContractId)).toEqual([
      'repository-architecture',
      'repository-architecture',
      'ci-test-evidence',
      'planning-acceptance',
    ]);
    expect(prepared.every((entry) => !Object.hasOwn(entry.candidate, 'sourceContract'))).toBe(true);
    expect(
      prepared.every(
        (entry) =>
          entry.candidate.sourceArtifactId === 'art_screened_source_0001' &&
          !JSON.stringify(entry).includes('repository.read') &&
          !JSON.stringify(entry).includes('private.json'),
      ),
    ).toBe(true);
    expect(prepared.map((entry) => entry.source.sourceContract.id)).toEqual([
      'repository-architecture',
      'repository-architecture',
      'ci-test-evidence',
      'planning-acceptance',
    ]);
  });
});
