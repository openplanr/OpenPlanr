import { SEMVER_REGEX } from '@openplanr/protocol/semver';

import { SkillRuntimeError } from '../errors.mjs';
import { assertAuthorityNarrows } from './authority.mjs';
import { assertHostOverlayIsPresentational } from './host-overlay.mjs';

const EXACT_SEMVER = SEMVER_REGEX;
const FLOATING = /(?:^latest$|^\*$|[\^~]|\bx\b|\|\||\s-\s|>=|<=|[<>])/u;

const moduleKey = (moduleId, moduleVersion) => `${moduleId}@${moduleVersion}`;
const moduleNode = (ref) => `module:${ref.moduleId}@${ref.moduleVersion}`;
const frozenRef = (ref) =>
  Object.freeze({ moduleId: ref.moduleId, moduleVersion: ref.moduleVersion, digest: ref.digest });

function assertExactVersion(ref, edge) {
  if (
    typeof ref.moduleVersion !== 'string' ||
    FLOATING.test(ref.moduleVersion) ||
    !EXACT_SEMVER.test(ref.moduleVersion)
  ) {
    throw new SkillRuntimeError(
      'E_SKILL_MODULE_VERSION_FLOATING',
      `Module ${ref.moduleId} must be pinned to an exact version; got ${String(ref.moduleVersion)}.`,
      {
        edge,
        moduleId: ref.moduleId,
        moduleVersion: ref.moduleVersion,
        repair: `Pin ${ref.moduleId} to an exact published moduleVersion (no ranges, ^, ~, or latest).`,
      },
    );
  }
}

function resolve(index, ref, edge) {
  assertExactVersion(ref, edge);
  const entry = index.get(moduleKey(ref.moduleId, ref.moduleVersion));
  if (!entry) {
    throw new SkillRuntimeError(
      'E_SKILL_MODULE_VERSION_MISSING',
      `Module ${ref.moduleId}@${ref.moduleVersion} referenced by ${edge.from} is not in the module registry.`,
      {
        edge,
        repair: `Add ${ref.moduleId}@${ref.moduleVersion} to skill-modules.json, or pin ${edge.from} to a registered version.`,
      },
    );
  }
  if (typeof ref.digest !== 'string' || ref.digest !== entry.source.digest) {
    throw new SkillRuntimeError(
      'E_SKILL_MODULE_DIGEST_MISMATCH',
      `Pinned digest for ${ref.moduleId}@${ref.moduleVersion} does not match the registry source digest.`,
      {
        edge,
        expected: entry.source.digest,
        actual: ref.digest,
        repair: `Repin ${ref.moduleId}@${ref.moduleVersion} to the registry source digest ${entry.source.digest}.`,
      },
    );
  }
  return entry;
}

function topologicalOrder(keys, adjacency) {
  const selected = new Set(keys);
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map([...selected].map((key) => [key, WHITE]));
  const result = [];
  const stack = [];
  const dfs = (key) => {
    color.set(key, GREY);
    stack.push(key);
    for (const dep of [...(adjacency.get(key) ?? [])]
      .filter((candidate) => selected.has(candidate))
      .sort()) {
      if (color.get(dep) === GREY) {
        const cycleStart = stack.indexOf(dep);
        const cycle = [...stack.slice(cycleStart), dep].map((entry) => `module:${entry}`);
        throw new SkillRuntimeError(
          'E_SKILL_MODULE_CYCLE',
          `Module graph contains a cycle: ${cycle.join(' -> ')}.`,
          {
            cycle,
            repair: `Break the graph cycle between ${cycle[0]} and ${cycle[cycle.length - 2]}.`,
          },
        );
      }
      if (color.get(dep) === WHITE) dfs(dep);
    }
    color.set(key, BLACK);
    stack.pop();
    result.push(key);
  };
  for (const key of [...selected].sort()) if (color.get(key) === WHITE) dfs(key);
  return result;
}

/**
 * Resolve every real module edge. `dependsOn` stays in the current render group;
 * `references` starts a progressive-disclosure support group. Host overlays are
 * resolved separately and must satisfy the typed presentation-only boundary.
 */
export function resolveModuleGraph({ skillSource, modules, hostProfile }) {
  const index = new Map();
  for (const entry of modules) {
    const key = moduleKey(entry.moduleId, entry.moduleVersion);
    if (index.has(key))
      throw new SkillRuntimeError(
        'E_SKILL_MODULE_DUPLICATE',
        `Module ${key} is declared twice in the registry.`,
        { moduleId: entry.moduleId, moduleVersion: entry.moduleVersion },
      );
    index.set(key, entry);
  }

  const skillNode = `skill:${skillSource.skillId}@${skillSource.skillVersion}`;
  const profileNode = hostProfile
    ? `host-profile:${hostProfile.hostProfileId}@${hostProfile.hostProfileVersion}`
    : null;
  const nodes = new Map();
  const graphAdjacency = new Map();
  const dependencyAdjacency = new Map();
  const authorityEdges = [];
  const edges = [];
  const inlineKeys = new Set();
  const overlayKeys = new Set();
  const routedRoots = new Map();
  const routedGroups = new Map();

  const ensureNode = (key, ref, entry) => {
    if (!nodes.has(key)) nodes.set(key, { ref: frozenRef(ref), entry });
    if (!graphAdjacency.has(key)) graphAdjacency.set(key, []);
    if (!dependencyAdjacency.has(key)) dependencyAdjacency.set(key, []);
  };

  const resolveEdge = (ref, parent, field) => {
    const edge = Object.freeze({ from: parent.node, to: moduleNode(ref), field });
    const entry = resolve(index, ref, edge);
    const key = moduleKey(ref.moduleId, ref.moduleVersion);
    ensureNode(key, ref, entry);
    if (parent.key !== null) {
      graphAdjacency.get(parent.key).push(key);
      if (field === 'dependsOn') dependencyAdjacency.get(parent.key).push(key);
    }
    authorityEdges.push({ base: parent.authority, overlay: entry.authorityCeiling, edge });
    edges.push(edge);
    return { key, ref: frozenRef(ref), entry };
  };

  const routedProcessing = new Set();
  const walkRoutedRoot = (ref, parent, field = 'references') => {
    const resolved = resolveEdge(ref, parent, field);
    if (!routedRoots.has(resolved.key)) routedRoots.set(resolved.key, resolved);
    if (routedGroups.has(resolved.key) || routedProcessing.has(resolved.key)) return;
    routedProcessing.add(resolved.key);
    const group = new Set();
    const seen = new Set();
    const walkGroup = (node) => {
      group.add(node.key);
      if (seen.has(node.key)) return;
      seen.add(node.key);
      const currentParent = {
        key: node.key,
        node: moduleNode(node.ref),
        authority: node.entry.authorityCeiling,
      };
      for (const dep of node.entry.dependsOn ?? [])
        walkGroup(resolveEdge(dep, currentParent, 'dependsOn'));
      for (const reference of node.entry.references ?? [])
        walkRoutedRoot(reference, currentParent, 'references');
    };
    walkGroup(resolved);
    routedGroups.set(resolved.key, group);
    routedProcessing.delete(resolved.key);
  };

  const walkInline = (resolved, bucket, seen) => {
    bucket.add(resolved.key);
    if (seen.has(resolved.key)) return;
    seen.add(resolved.key);
    const parent = {
      key: resolved.key,
      node: moduleNode(resolved.ref),
      authority: resolved.entry.authorityCeiling,
    };
    for (const dep of resolved.entry.dependsOn ?? [])
      walkInline(resolveEdge(dep, parent, 'dependsOn'), bucket, seen);
    for (const reference of resolved.entry.references ?? [])
      walkRoutedRoot(reference, parent, 'references');
  };

  const inlineSeen = new Set();
  for (const ref of skillSource.modules ?? [])
    walkInline(
      resolveEdge(
        ref,
        { key: null, node: skillNode, authority: skillSource.authorityCeiling },
        'modules',
      ),
      inlineKeys,
      inlineSeen,
    );
  const overlaySeen = new Set();
  if (hostProfile) {
    for (const ref of hostProfile.overlayModules ?? [])
      walkInline(
        resolveEdge(
          ref,
          { key: null, node: profileNode, authority: hostProfile.authorityCeiling },
          'overlayModules',
        ),
        overlayKeys,
        overlaySeen,
      );
  }
  for (const { module: ref } of skillSource.references ?? [])
    walkRoutedRoot(
      ref,
      { key: null, node: skillNode, authority: skillSource.authorityCeiling },
      'references',
    );

  topologicalOrder(nodes.keys(), graphAdjacency);
  for (const { base, overlay, edge } of authorityEdges)
    assertAuthorityNarrows(base, overlay, { edge });

  const inlineOrder = topologicalOrder(inlineKeys, dependencyAdjacency);
  const overlayOrder = topologicalOrder(overlayKeys, dependencyAdjacency);
  const primaryVersions = new Map();
  for (const key of [...inlineOrder, ...overlayOrder]) {
    const { ref } = nodes.get(key);
    const prior = primaryVersions.get(ref.moduleId);
    if (prior && prior !== ref.moduleVersion) {
      throw new SkillRuntimeError(
        'E_SKILL_PRIMARY_MODULE_VERSION_CONFLICT',
        `Primary output selects ${ref.moduleId} at both ${prior} and ${ref.moduleVersion}.`,
        {
          moduleId: ref.moduleId,
          versions: [prior, ref.moduleVersion],
          repair: `Select one version of ${ref.moduleId} for the primary host projection.`,
        },
      );
    }
    primaryVersions.set(ref.moduleId, ref.moduleVersion);
  }

  const inlineModules = Object.freeze(inlineOrder.map((key) => Object.freeze(nodes.get(key))));
  const overlayModules = Object.freeze(
    overlayOrder.filter((key) => !inlineKeys.has(key)).map((key) => Object.freeze(nodes.get(key))),
  );
  if (hostProfile) assertHostOverlayIsPresentational(hostProfile, overlayModules);
  const routed = Object.freeze(
    [...routedRoots.keys()].sort().map((key) => {
      const root = routedRoots.get(key);
      const moduleOrder = topologicalOrder(routedGroups.get(key), dependencyAdjacency);
      return Object.freeze({
        ...root,
        routed: true,
        modules: Object.freeze(moduleOrder.map((moduleId) => Object.freeze(nodes.get(moduleId)))),
      });
    }),
  );
  const allSelectedModules = Object.freeze(
    [...nodes.keys()].sort().map((key) => Object.freeze(nodes.get(key))),
  );
  const selectedIds = Object.freeze([
    ...inlineModules.map(({ ref }) =>
      Object.freeze({ moduleId: ref.moduleId, moduleVersion: ref.moduleVersion, mode: 'inline' }),
    ),
    ...overlayModules.map(({ ref }) =>
      Object.freeze({ moduleId: ref.moduleId, moduleVersion: ref.moduleVersion, mode: 'overlay' }),
    ),
    ...routed.map(({ ref }) =>
      Object.freeze({ moduleId: ref.moduleId, moduleVersion: ref.moduleVersion, mode: 'routed' }),
    ),
  ]);

  return Object.freeze({
    skillId: skillSource.skillId,
    skillVersion: skillSource.skillVersion,
    inlineOrder: Object.freeze(inlineOrder),
    inlineModules,
    overlayModules,
    routedReferences: routed,
    routedGroups: routed,
    allSelectedModules,
    edges: Object.freeze(edges),
    selectedIds,
  });
}
