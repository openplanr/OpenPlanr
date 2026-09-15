import { validateProtocolArtifact } from '@openplanr/protocol/contracts';

import {
  assertAuthorityNarrows,
  assertHostOverlayIsPresentational,
  resolveModuleGraph,
  validateSourceMap,
} from '../compiler/index.mjs';
import { buildGeneratedAssetManifest } from '../manifests/index.mjs';
import { linkSkillProjections } from '../linker/index.mjs';
import {
  compileHostProjections,
  flattenCompiledAssets,
  inspectGeneratedOutput,
} from './compiled-assets.mjs';
import { describeAuthoringGraph } from './command-contract.mjs';
import { loadComposedSkill } from './loader.mjs';
import { SkillAuthoringError } from './diagnostics.mjs';
import { runOperation } from './operation-result.mjs';

function profileLabel(profile) {
  return `${profile.hostProfileId}@${profile.hostProfileVersion}`;
}

function distinctOwners(sourceMap) {
  const seen = new Map();
  for (const range of sourceMap) {
    const key = `${range.owner.ownerKind}:${range.owner.pointer}@${range.owner.version}`;
    if (!seen.has(key)) {
      seen.set(key, { ownerKind: range.owner.ownerKind, pointer: range.owner.pointer, version: range.owner.version });
    }
  }
  return [...seen.values()];
}

function declaredCapabilityDecision(profile) {
  if (!Array.isArray(profile.interactionBindings) || profile.interactionBindings.length === 0) return null;
  const [preferred, ...fallbacks] = profile.interactionBindings;
  return Object.freeze({
    status: 'declared',
    preferred: Object.freeze({
      surface: preferred.surface,
      capabilityId: preferred.capabilityId ?? null,
    }),
    fallbacks: Object.freeze(fallbacks.map((binding) => Object.freeze({
      surface: binding.surface,
      capabilityId: binding.capabilityId ?? null,
    }))),
    declaredCapabilities: Object.freeze([...(profile.runtimeCapabilities ?? [])]),
    repair: null,
  });
}

/** Resolve the graph and prove authority narrows without rendering output. */
export function lintSkill({ skillDir }) {
  return runOperation('lint', () => {
    const loaded = loadComposedSkill({ skillDir });
    const { skillSource, modules, declaredProfiles } = loaded;
    // resolveModuleGraph validates authority at every real module edge (skill and
    // dependsOn) plus versions, digests, and cycles across the whole reachable
    // graph. Passing each host profile additionally validates that profile's
    // overlay-module edges (existence, version, authority relative to the profile).
    const graph = resolveModuleGraph({ skillSource, modules });
    const skillNode = `skill:${skillSource.skillId}@${skillSource.skillVersion}`;
    for (const profile of declaredProfiles) {
      const hostGraph = resolveModuleGraph({ skillSource, modules, hostProfile: profile });
      assertHostOverlayIsPresentational(
        profile,
        hostGraph.overlayModules,
        ({ entry }) => loaded.readSource(entry.source.path),
      );
      assertAuthorityNarrows(skillSource.authorityCeiling, profile.authorityCeiling, {
        edge: { from: skillNode, to: `host-profile:${profileLabel(profile)}`, field: 'authorityCeiling' },
      });
    }
    const content = linkSkillProjections(compileHostProjections(loaded));
    return {
      skillId: skillSource.skillId,
      skillVersion: skillSource.skillVersion,
      sourceFormat: skillSource.sourceFormat,
      graph: describeAuthoringGraph(loaded),
      modules: graph.selectedIds,
      hostProfiles: declaredProfiles.map((profile) => ({ id: profile.hostProfileId, version: profile.hostProfileVersion, host: profile.host })),
      content,
    };
  });
}

/** Name every inline module, routed reference, host overlay, and narrowed authority. */
export function previewSkill({ skillDir }) {
  return runOperation('preview', () => {
    const loaded = loadComposedSkill({ skillDir });
    const { skillSource, declaredProfiles } = loaded;
    const skillNode = `skill:${skillSource.skillId}@${skillSource.skillVersion}`;
    const projections = compileHostProjections(loaded);
    const content = linkSkillProjections(projections);
    const hosts = declaredProfiles.map((hostProfile, index) => {
      const result = projections[index];
      const narrowed = assertAuthorityNarrows(skillSource.authorityCeiling, hostProfile.authorityCeiling, {
        edge: { from: skillNode, to: `host-profile:${profileLabel(hostProfile)}`, field: 'authorityCeiling' },
      });
      return {
        host: result.host,
        hostProfile: profileLabel(hostProfile),
        inline: result.preview.inline.map(({ moduleId, moduleVersion, source }) => ({ moduleId, moduleVersion, source })),
        overlayModules: result.preview.overlay.map(({ moduleId, moduleVersion, source }) => ({ moduleId, moduleVersion, source })),
        routed: result.preview.routed.map(({ moduleId, moduleVersion, path }) => ({ moduleId, moduleVersion, path })),
        overlay: { hostProfile: profileLabel(hostProfile), authority: narrowed },
        capabilityDecision: declaredCapabilityDecision(hostProfile),
        owners: distinctOwners(result.primary.sourceMap),
        outputs: [
          { kind: 'primary', path: result.primary.path, byteLength: result.primary.byteLength },
          ...result.references.map((reference) => ({
            kind: 'reference',
            path: reference.path,
            byteLength: reference.byteLength,
          })),
        ],
        repairs: [],
      };
    });
    return {
      skillId: skillSource.skillId,
      skillVersion: skillSource.skillVersion,
      graph: describeAuthoringGraph(loaded),
      hosts,
      content,
    };
  });
}

/** Compile in memory, prove determinism and byte coverage, never mutate. */
export function checkSkill({ skillDir }) {
  return runOperation('check', () => {
    const loaded = loadComposedSkill({ skillDir });
    const firstProjections = compileHostProjections(loaded);
    const first = flattenCompiledAssets(firstProjections);
    const secondProjections = compileHostProjections(loaded);
    const second = flattenCompiledAssets(secondProjections);
    const mismatch = first.find((asset, index) => {
      const candidate = second[index];
      return !candidate
        || candidate.host !== asset.host
        || candidate.path !== asset.path
        || candidate.digest !== asset.digest;
    }) ?? (first.length === second.length ? null : first.at(-1));
    if (mismatch) {
      throw new SkillAuthoringError(
        'E_SKILL_CHECK_NONDETERMINISTIC',
        `Recompiling ${loaded.skillSource.skillId} produced a different asset set.`,
        {
          host: mismatch.host,
          path: mismatch.path,
          repair: 'Remove nondeterministic compiler input and rerun the check.',
        },
      );
    }
    const content = linkSkillProjections(firstProjections);
    const output = inspectGeneratedOutput({ skillDir: loaded.skillDir, assets: first });
    return {
      skillId: loaded.skillSource.skillId,
      graph: describeAuthoringGraph(loaded),
      output,
      content,
      assets: first.map(({ bytes: _bytes, sourceMap: _sourceMap, ...asset }) => asset),
    };
  });
}

/** Diagnostic pass/fail over every declared host projection. Not a governance gate. */
export function evaluateSkill({ skillDir }) {
  return runOperation('evaluate', () => {
    const loaded = loadComposedSkill({ skillDir });
    const { skillSource, declaredProfiles } = loaded;
    const firstProjections = compileHostProjections(loaded);
    const secondProjections = compileHostProjections(loaded);
    const content = linkSkillProjections(firstProjections);
    const hosts = declaredProfiles.map((hostProfile, index) => {
      const reasons = [];
      const first = firstProjections[index];
      const second = secondProjections[index];
      const idempotent = first.primary.digest === second.primary.digest;
      if (!idempotent) reasons.push('recompilation produced a different digest');

      let sourceMapComplete = true;
      try {
        validateSourceMap(first.primary.sourceMap, first.primary.byteLength);
        for (const reference of first.references) validateSourceMap(reference.sourceMap, reference.byteLength);
      } catch (error) {
        sourceMapComplete = false;
        reasons.push(`source map incomplete: ${error.message}`);
      }

      const manifestAssets = [
        { path: first.primary.path, host: first.host, byteLength: first.primary.byteLength, digest: first.primary.digest, sourceMap: first.primary.sourceMap },
        ...first.references.map((reference) => ({ path: reference.path, host: first.host, byteLength: reference.byteLength, digest: reference.digest, sourceMap: reference.sourceMap })),
      ];
      const manifest = buildGeneratedAssetManifest({ assets: manifestAssets, sourceFormat: 'composed-v1' });
      const manifestValid = validateProtocolArtifact('generated-asset-manifest', manifest, { protocolVersion: '1.6.0' }).length === 0;
      if (!manifestValid) reasons.push('generated-asset-manifest did not round-trip through the Protocol 1.6 contract');

      const pass = idempotent && sourceMapComplete && manifestValid;
      return {
        host: first.host,
        hostProfile: profileLabel(hostProfile),
        pass,
        digest: first.primary.digest,
        byteLength: first.primary.byteLength,
        inlineModules: first.preview.inline.length,
        routedReferences: first.references.length,
        checks: { idempotent, sourceMapComplete, manifestValid },
        reasons,
      };
    });
    const failing = hosts.filter((host) => !host.pass);
    if (failing.length > 0) {
      throw new SkillAuthoringError('E_SKILL_EVALUATION_FAILED', `${skillSource.skillId} failed evaluation for ${failing.map((host) => host.host).join(', ')}.`, { hosts: failing });
    }
    return { skillId: skillSource.skillId, graph: describeAuthoringGraph(loaded), hosts, content };
  });
}
