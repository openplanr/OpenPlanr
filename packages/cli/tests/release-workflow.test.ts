import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isPathInside,
  resolvePipelineCandidateSourceRoot,
} from '../scripts/release-package-input.mjs';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(cliRoot, '..', '..');
const workflowRoot = join(workspaceRoot, '.github', 'workflows');
const releaseProofWorkflow = readFileSync(join(workflowRoot, 'release-proof.yml'), 'utf8');
const releaseArtifactVerifier = readFileSync(
  join(cliRoot, 'scripts', 'verify-release-artifact.mjs'),
  'utf8',
);
const releaseJourneyVerifier = readFileSync(
  join(cliRoot, 'scripts', 'verify-release-journey.mjs'),
  'utf8',
);
const releasePackageInput = readFileSync(
  join(cliRoot, 'scripts', 'release-package-input.mjs'),
  'utf8',
);
const packedWorkspaceVerifier = readFileSync(
  join(workspaceRoot, 'scripts', 'verify-packed-workspace.mjs'),
  'utf8',
);
const strictPackedWorkspaceVerifier = readFileSync(
  join(workspaceRoot, 'scripts', 'verify-packed-workspace-strict.mjs'),
  'utf8',
);
const pinnedOperateVerifier = readFileSync(
  join(cliRoot, 'scripts', 'create-pinned-legacy-operate-replay-proof.mjs'),
  'utf8',
);
const packageScripts = (
  JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;
const workspaceScripts = (
  JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;
const packageManifest = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>;
  files: string[];
};

describe('root release proof and public package artifacts', () => {
  it('keeps the consolidation release proof manual, read-only, and publication-free', () => {
    expect(releaseProofWorkflow).toContain('workflow_dispatch: {}');
    expect(releaseProofWorkflow).toContain('contents: read');
    expect(releaseProofWorkflow).not.toMatch(/^\s{2}(?:push|release|schedule):/mu);
    for (const forbidden of [
      'NPM_TOKEN',
      'NODE_AUTH_TOKEN',
      'npm publish',
      'npm run release',
      'changesets/action',
      'gh release',
      'id-token: write',
    ]) {
      expect(releaseProofWorkflow).not.toContain(forbidden);
    }
  });

  it('runs the root verification graph against all supported Node lines', () => {
    expect(releaseProofWorkflow).toContain('node: [20, 22, 24]');
    expect(releaseProofWorkflow).toContain(
      'npm exec --workspace=@openplanr/protocol -- playwright install --with-deps chromium',
    );
    expect(releaseProofWorkflow).toContain('run: npm ci');
    expect(releaseProofWorkflow).toContain('run: npm run verify');
    expect(workspaceScripts.verify).toContain('npm run verify:packed:strict');
    expect(workspaceScripts['verify:packed:strict']).toBe(
      'node scripts/verify-packed-workspace-strict.mjs',
    );
    expect(strictPackedWorkspaceVerifier).toContain(
      'packages/pipeline/scripts/ecosystem-conformance.mjs',
    );
    expect(strictPackedWorkspaceVerifier).toContain("'--strict'");
    expect(strictPackedWorkspaceVerifier).not.toMatch(/(?:execSync|shell:\s*true|>\s*\/tmp)/u);
    expect(packageScripts['verify:release-artifact']).toBe(
      'node scripts/verify-release-artifact.mjs',
    );
    expect(packageScripts.prepack).toBe('npm run build');
  });

  it('certifies one frozen build through deterministic packs and installed bytes', () => {
    const build = releaseArtifactVerifier.indexOf("run('npm', ['run', 'build']");
    const firstPack = releaseArtifactVerifier.indexOf(
      "const first = packCandidate(join(workspace, 'pack-one'), environment)",
    );
    const secondPack = releaseArtifactVerifier.indexOf(
      "const second = packCandidate(join(workspace, 'pack-two'), environment)",
    );

    expect(build).toBeGreaterThan(-1);
    expect(firstPack).toBeGreaterThan(build);
    expect(secondPack).toBeGreaterThan(firstPack);
    expect(releaseArtifactVerifier).toContain(
      "['pack', '--json', '--ignore-scripts', '--pack-destination', destination]",
    );
    expect(releaseArtifactVerifier).toContain(
      'JSON.stringify(firstInventory) === JSON.stringify(secondInventory)',
    );
    expect(releaseArtifactVerifier).toContain(
      'sha256File(first.tarball) === sha256File(second.tarball)',
    );
    expect(releaseArtifactVerifier).toContain('validateExportTargets');
    expect(releaseArtifactVerifier).toContain('validatePackagedMarkdownLinks');
    expect(releaseArtifactVerifier).toContain('payloadBytesEqual(firstInventory');
    expect(releaseArtifactVerifier).toContain('payloadBytesEqual(pipelineInventory');
  });

  it('packages one repository-bound pipeline candidate and resolves all exports as an installed consumer', () => {
    expect(releaseArtifactVerifier).toContain('resolvePipelineCandidateSourceRoot');
    expect(releaseArtifactVerifier).toContain('pipelineCandidate.root');
    expect(releaseArtifactVerifier).toContain('verifyPackedSourceParity');
    expect(releaseArtifactVerifier).toContain('runInstalledExportProbes');
    expect(releaseArtifactVerifier).not.toContain('resolveOptionalPipelineTarball');
    expect(releasePackageInput).not.toContain('process.env');
    expect(releaseArtifactVerifier).toContain("require.resolve('openplanr/dashboard')");
    expect(releaseArtifactVerifier).toContain("require.resolve('openplanr/dashboard-verifier')");
    expect(releaseArtifactVerifier).toContain(
      "openPlanrRequire.resolve('planr-pipeline/package.json')",
    );
    expect(releaseArtifactVerifier).toContain('verifier.verifyDashboardAssets()');
    expect(releaseArtifactVerifier).toContain('delete environment[key]');
    expect(releaseArtifactVerifier).toContain("'OPENPLANR_PIPELINE_ROOT'");
    expect(releaseArtifactVerifier).toContain("'PLANR_PIPELINE_VERIFIER_SOURCE_ROOT'");
  });

  it('packs the repository-owned pipeline workspace without external checkout authority', () => {
    expect(releaseProofWorkflow).not.toContain('repository: openplanr/planr-pipeline');
    expect(releaseProofWorkflow).not.toContain('OPENPLANR_PIPELINE_ROOT');
    expect(packedWorkspaceVerifier).toContain(
      "const pipelineSourceRoot = path.join(repositoryRoot, 'packages', 'pipeline')",
    );
    expect(packedWorkspaceVerifier).not.toContain(
      "path.join(repositoryRoot, '..', 'planr-pipeline')",
    );
    expect(packedWorkspaceVerifier).toContain("'OPENPLANR_PIPELINE_TARBALL'");
    expect(packedWorkspaceVerifier).toContain('delete environment[key]');
    expect(packedWorkspaceVerifier).not.toContain('process.env.OPENPLANR_PIPELINE_TARBALL');
  });

  it('ships the dashboard verifier as an installed-byte export', () => {
    expect(packageManifest.exports['./dashboard-verifier']).toEqual({
      import: './lib/dashboard-verifier.mjs',
      types: './lib/dashboard-verifier.d.mts',
      default: './lib/dashboard-verifier.mjs',
    });
    expect(packageManifest.files).toContain('lib/');
  });

  it('ships every local guide referenced by the package entry points', () => {
    expect(packageManifest.files).toEqual(
      expect.arrayContaining([
        'CONTRIBUTING.md',
        'docs/ARTIFACT_REVIEW.md',
        'docs/CLI.md',
        'docs/CROSS_RUNTIME_SETUP.md',
      ]),
    );
  });

  it('ships one real pinned Operate verifier without sibling repository discovery', () => {
    const asset = 'scripts/create-pinned-legacy-operate-replay-proof.mjs';
    expect(packageManifest.files).toContain(asset);
    expect(lstatSync(join(cliRoot, asset)).isSymbolicLink()).toBe(false);
    expect(pinnedOperateVerifier).toContain('OPENPLANR_VERIFIER_SOURCE_ROOT');
    expect(pinnedOperateVerifier).toContain('PLANR_PIPELINE_VERIFIER_SOURCE_ROOT');
    expect(pinnedOperateVerifier).not.toContain("path.resolve(scriptRoot, '..', 'planr-pipeline')");
  });

  it('probes the packed Node CLI through the current read-only Operate contract', () => {
    for (const verifier of [releaseArtifactVerifier, releaseJourneyVerifier]) {
      expect(verifier).toContain("['operate', 'recovery', 'inspect', '--json']");
      expect(verifier).toContain("inspection.operation === 'operate.recovery.inspect'");
      expect(verifier).toContain("inspection.data?.status === 'empty'");
      expect(verifier).toContain(
        "inspection.data?.integrityBoundary?.model === 'project-local-integrity'",
      );
      expect(verifier).not.toContain("['operate', 'inspect', '--json']");
      expect(verifier).not.toContain("protocolVersion === '1.4.0'");
    }
  });

  it('accepts exactly one fixed repository-bound pipeline candidate', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openplanr-release-input-'));
    try {
      const openPlanrRoot = join(directory, 'packages', 'cli');
      const sibling = join(directory, 'packages', 'pipeline');
      mkdirSync(openPlanrRoot, { recursive: true });
      mkdirSync(sibling, { recursive: true });
      writeFileSync(
        join(sibling, 'package.json'),
        '{"name":"planr-pipeline","version":"0.44.0"}\n',
      );
      const candidate = resolvePipelineCandidateSourceRoot({ openPlanrRoot });
      expect(candidate.kind).toBe('workspace-package');
      expect(candidate.root).toBe(realpathSync(sibling));
      expect(isPathInside(directory, sibling)).toBe(true);
      expect(isPathInside(directory, directory)).toBe(false);

      const ciCandidate = join(directory, 'ci-candidate');
      mkdirSync(ciCandidate, { recursive: true });
      writeFileSync(
        join(ciCandidate, 'package.json'),
        '{"name":"planr-pipeline","version":"0.44.0"}\n',
      );
      expect(() =>
        resolvePipelineCandidateSourceRoot({
          openPlanrRoot,
          candidateLocations: [
            { kind: 'workspace-package', path: realpathSync(sibling) },
            { kind: 'test-second-candidate', path: realpathSync(ciCandidate) },
          ],
        }),
      ).toThrow(
        'More than one bounded planr-pipeline candidate exists; candidate custody is ambiguous.',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
