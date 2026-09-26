import { SkillRuntimeError } from '../errors.mjs';
import { assertAuthorityNarrows } from './authority.mjs';
import {
  composeIncludes,
  renderSkillForHost,
  skillPrimaryPath,
  skillSupportPath,
} from './composition.mjs';
import { resolveModuleGraph } from './graph.mjs';
import { assertHostOverlayIsPresentational } from './host-overlay.mjs';
import {
  assertPortableAsset,
  assertSafeSourcePath,
  HOST_SUBSTITUTIONS,
  parseMarkdownAsset,
  serializeYamlScalarFragments,
  sha256,
} from './render-primitives.mjs';
import { byteLength, owner, SourceMapBuilder, sha256Bytes } from './source-map.mjs';

const TOKEN = /\{\{([A-Z][A-Z0-9_]*)\}\}/gu;
const MARKDOWN_V1_COMPILER_VERSION = '1.0.0';
const COMPOSED_V1_COMPILER_VERSION = '1.0.0';
const CURSOR_TEMPLATE_PATH = 'packages/skill-runtime/templates/cursor-rule.md';

function templateOwner(pointer, version, digest) {
  return owner('template', pointer, version, digest);
}

function compilerOwner(pointer, version, digestSeed) {
  return owner('compiler', pointer, version, sha256(digestSeed));
}

function hostSubstitutionOwner(host, version = COMPOSED_V1_COMPILER_VERSION) {
  return compilerOwner(
    `packages/skill-runtime/src/compiler/render-primitives.mjs#/HOST_SUBSTITUTIONS/${host}`,
    version,
    JSON.stringify(HOST_SUBSTITUTIONS[host]),
  );
}

function lineEndingOwner(version = COMPOSED_V1_COMPILER_VERSION) {
  return compilerOwner(
    'packages/skill-runtime/src/compiler/render-primitives.mjs#/canonicalText/crlf-to-lf',
    version,
    'openplanr-canonical-text@1.0.0:CRLF->LF',
  );
}

/**
 * Read each source once, hash its actual bytes, and bind every later use to that
 * verified snapshot. A path cannot be presented under two different digests.
 */
function createVerifiedReader(readSource) {
  const cache = new Map();
  return (path, declaredDigest) => {
    assertSafeSourcePath(path);
    const prior = cache.get(path);
    if (prior) {
      if (prior.digest !== declaredDigest) {
        throw new SkillRuntimeError(
          'E_SKILL_SOURCE_DIGEST_CONFLICT',
          `Source ${path} is selected with conflicting declared digests.`,
          {
            path,
            first: prior.digest,
            second: declaredDigest,
            repair: `Use one exact source digest for ${path}.`,
          },
        );
      }
      return prior.bytes;
    }
    const bytes = String(readSource(path));
    const actual = sha256Bytes(bytes);
    if (actual !== declaredDigest) {
      throw new SkillRuntimeError(
        'E_SKILL_SOURCE_DIGEST_STALE',
        `Live bytes for ${path} do not match the declared source digest.`,
        {
          path,
          expected: declaredDigest,
          actual,
          repair: `Recompute the digest for ${path} or restore the bytes that produced ${declaredDigest}.`,
        },
      );
    }
    cache.set(path, Object.freeze({ bytes, digest: declaredDigest }));
    return bytes;
  };
}

function assertSelectedHostProfile(skillSource, hostProfile) {
  const selected = (skillSource.hostProfiles ?? []).some(
    ({ id, version }) =>
      id === hostProfile.hostProfileId && version === hostProfile.hostProfileVersion,
  );
  if (!selected) {
    throw new SkillRuntimeError(
      'E_SKILL_HOST_PROFILE_UNDECLARED',
      `Host profile ${hostProfile.hostProfileId}@${hostProfile.hostProfileVersion} is not selected by ${skillSource.skillId}@${skillSource.skillVersion}.`,
      {
        hostProfileId: hostProfile.hostProfileId,
        hostProfileVersion: hostProfile.hostProfileVersion,
        selected: skillSource.hostProfiles ?? [],
        repair: `Select ${hostProfile.hostProfileId}@${hostProfile.hostProfileVersion} in the skill source or compile with one of its declared profiles.`,
      },
    );
  }
}

function appendNormalized(builder, text, baseOwner, lfOwner) {
  const raw = String(text);
  let last = 0;
  for (const match of raw.matchAll(/\r\n/gu)) {
    builder.append(raw.slice(last, match.index), baseOwner);
    builder.append('\n', lfOwner);
    last = match.index + match[0].length;
  }
  builder.append(raw.slice(last), baseOwner);
}

function appendTokenized(
  builder,
  text,
  baseOwner,
  host,
  { hostOwner, hostValues, hostValueOwners, lfOwner, skillId, skillIdOwner, allowSkillId = false },
) {
  const values = hostValues ?? HOST_SUBSTITUTIONS[host];
  if (!values) throw new SkillRuntimeError('E_HOST_INVALID', `Unknown adapter host ${host}.`);
  const raw = String(text);
  let last = 0;
  for (const match of raw.matchAll(TOKEN)) {
    appendNormalized(builder, raw.slice(last, match.index), baseOwner, lfOwner);
    const key = match[1];
    if (key === 'SKILL_ID' && allowSkillId) {
      builder.append(skillId, skillIdOwner);
    } else if (Object.hasOwn(values, key)) {
      builder.append(values[key], hostValueOwners?.[key] ?? hostOwner);
    } else {
      throw new SkillRuntimeError(
        'E_TEMPLATE_TOKEN_UNRESOLVED',
        `No value was supplied for {{${key}}}.`,
        {
          token: match[0],
          repair: `Declare ${key} in the skill identity or compiler host table, or remove the token.`,
        },
      );
    }
    last = match.index + match[0].length;
  }
  appendNormalized(builder, raw.slice(last), baseOwner, lfOwner);
}

function appendModuleSequence(
  builder,
  selected,
  sourceBytes,
  host,
  context,
  assetPath,
  { appendFinalLineEnding = true } = {},
) {
  selected.forEach(({ ref, entry }, index) => {
    if (index > 0) builder.append('\n', context.separatorOwner);
    const key = `${ref.moduleId}@${ref.moduleVersion}`;
    const moduleOwner = owner('source', entry.source.path, ref.moduleVersion, entry.source.digest);
    const moduleBuilder = new SourceMapBuilder();
    appendTokenized(moduleBuilder, sourceBytes.get(key).trimEnd(), moduleOwner, host, context);
    assertPortableAsset(
      `${assetPath}#module=${key}`,
      moduleBuilder.text,
      host,
      entry.authorityCeiling,
    );
    for (const segment of sourceMapSegments(moduleBuilder.text, moduleBuilder.build())) {
      builder.append(segment.text, segment.owner);
    }
    if (index < selected.length - 1 || appendFinalLineEnding) {
      builder.append('\n', context.separatorOwner);
    }
  });
}

function appendSourceMapSlice(builder, segments, start, end) {
  let cursor = 0;
  for (const segment of segments) {
    const next = cursor + segment.text.length;
    if (next > start && cursor < end) {
      const localStart = Math.max(0, start - cursor);
      const localEnd = Math.min(segment.text.length, end - cursor);
      builder.append(segment.text.slice(localStart, localEnd), segment.owner);
    }
    cursor = next;
    if (cursor >= end) break;
  }
}

function sourceMapSegments(text, sourceMap) {
  const buffer = Buffer.from(text, 'utf8');
  return sourceMap.map((range) =>
    Object.freeze({
      text: buffer.subarray(range.startByte, range.endByte).toString('utf8'),
      owner: range.owner,
    }),
  );
}

function ownerAt(segments, offset) {
  let cursor = 0;
  for (const segment of segments) {
    const next = cursor + segment.text.length;
    if (offset < next) return segment.owner;
    cursor = next;
  }
  return segments.at(-1)?.owner;
}

function projectCodexMap(text, segments) {
  const separator = text.indexOf('\n---\n\n', 4);
  if (!text.startsWith('---\n') || separator < 0) {
    throw new SkillRuntimeError(
      'E_MARKDOWN_FRONTMATTER_INVALID',
      'Markdown asset requires one closed YAML frontmatter block.',
    );
  }
  const builder = new SourceMapBuilder();
  appendSourceMapSlice(builder, segments, 0, 4);
  let cursor = 4;
  while (cursor <= separator) {
    const lineEnd = text.indexOf('\n', cursor);
    const end = lineEnd < 0 || lineEnd > separator ? separator : lineEnd;
    const line = text.slice(cursor, end);
    if (!line.startsWith('allowed-tools:')) {
      appendSourceMapSlice(builder, segments, cursor, end);
      appendSourceMapSlice(builder, segments, end, end + 1);
    }
    if (end === separator) break;
    cursor = end + 1;
  }
  appendSourceMapSlice(builder, segments, separator + 1, text.length);
  return builder;
}

function replaceMapped(builder, search, replacement, replacementOwner) {
  const text = builder.text;
  if (!text.includes(search)) return builder;
  const segments = sourceMapSegments(text, builder.build());
  const next = new SourceMapBuilder();
  let cursor = 0;
  let index = text.indexOf(search);
  while (index >= 0) {
    appendSourceMapSlice(next, segments, cursor, index);
    next.append(replacement, replacementOwner);
    cursor = index + search.length;
    index = text.indexOf(search, cursor);
  }
  appendSourceMapSlice(next, segments, cursor, text.length);
  return next;
}

function projectCursorMap(
  text,
  segments,
  skillId,
  cursorTemplate,
  supportPaths,
  compilerVersion,
  quoteDescription,
) {
  const parsed = parseMarkdownAsset(text, { expectedName: skillId });
  const separator = text.indexOf('\n---\n\n', 4);
  const bodyStart = separator + '\n---\n\n'.length;
  const bodyEnd = bodyStart + parsed.body.trimEnd().length;
  const descriptionLine = text.match(/^description:\s*(.*)$/mu);
  const descriptionOffset = descriptionLine?.index ?? 4;
  const descriptionOwner = ownerAt(segments, descriptionOffset);
  const cursorOwner = templateOwner(CURSOR_TEMPLATE_PATH, compilerVersion, sha256(cursorTemplate));
  const lfOwner = lineEndingOwner(compilerVersion);
  const descriptionEncodingOwner = compilerOwner(
    'packages/skill-runtime/src/compiler/render-primitives.mjs#/serializeYamlScalar',
    compilerVersion,
    'cursor-description-yaml-scalar@1.0.0',
  );
  const builder = new SourceMapBuilder();
  const template = String(cursorTemplate);
  let last = 0;
  for (const match of template.matchAll(TOKEN)) {
    appendNormalized(builder, template.slice(last, match.index), cursorOwner, lfOwner);
    if (match[1] === 'DESCRIPTION') {
      if (quoteDescription) {
        for (const fragment of serializeYamlScalarFragments(parsed.fields.description)) {
          builder.append(
            fragment.text,
            fragment.generated ? descriptionEncodingOwner : descriptionOwner,
          );
        }
      } else {
        builder.append(parsed.fields.description, descriptionOwner);
      }
    } else if (match[1] === 'BODY') {
      appendSourceMapSlice(builder, segments, bodyStart, bodyEnd);
    } else {
      throw new SkillRuntimeError(
        'E_TEMPLATE_TOKEN_UNRESOLVED',
        `Cursor template token {{${match[1]}}} is unresolved.`,
        { token: match[0] },
      );
    }
    last = match.index + match[0].length;
  }
  appendNormalized(builder, template.slice(last), cursorOwner, lfOwner);

  let projected = builder;
  const replacementOwner = compilerOwner(
    'packages/skill-runtime/src/compiler/composition.mjs#/cursor-support-path-rewrite',
    compilerVersion,
    'cursor-support-path-rewrite@1.0.0',
  );
  for (const supportPath of supportPaths) {
    projected = replaceMapped(
      projected,
      `references/${supportPath}`,
      `references/${skillId}/${supportPath}`,
      replacementOwner,
    );
  }
  return projected;
}

/** Compile a markdown-v1 skill without changing its frozen output bytes. */
export function compileMarkdownV1({
  skillId,
  skillVersion = '1.0.0',
  canonicalBytes,
  host,
  cursorTemplate,
  supportPaths = [],
  readSource,
  sourcePath,
}) {
  const composed = composeIncludes(canonicalBytes, { sourcePath, readSource });
  const intermediate = new SourceMapBuilder();
  const hostOwner = hostSubstitutionOwner(host, MARKDOWN_V1_COMPILER_VERSION);
  const lfOwner = lineEndingOwner(MARKDOWN_V1_COMPILER_VERSION);
  for (const fragment of composed.compositionFragments) {
    const fragmentOwner = owner(
      fragment.ownerKind,
      fragment.pointer,
      fragment.ownerKind === 'compiler' ? MARKDOWN_V1_COMPILER_VERSION : skillVersion,
      fragment.digest,
    );
    appendTokenized(intermediate, fragment.text, fragmentOwner, host, { hostOwner, lfOwner });
  }

  const hostBytes = intermediate.text;
  const segments = sourceMapSegments(hostBytes, intermediate.build());
  let builder;
  if (host === 'claude-code' || host === 'pipeline') {
    builder = intermediate;
  } else if (host === 'codex') {
    builder = projectCodexMap(hostBytes, segments);
  } else if (host === 'cursor') {
    builder = projectCursorMap(
      hostBytes,
      segments,
      skillId,
      cursorTemplate,
      supportPaths,
      MARKDOWN_V1_COMPILER_VERSION,
      false,
    );
  } else {
    throw new SkillRuntimeError(
      'E_SKILL_HOST_INVALID',
      `Unsupported skill projection host ${host}.`,
    );
  }

  const bytes = renderSkillForHost(composed.bytes, skillId, host, cursorTemplate, supportPaths);
  if (builder.text !== bytes) {
    throw new SkillRuntimeError(
      'E_SOURCE_MAP_PROJECTION_MISMATCH',
      `Source-map projection for ${skillId} on ${host} did not reproduce the rendered bytes.`,
      { host, expected: sha256(bytes), actual: sha256(builder.text) },
    );
  }
  return Object.freeze({
    skillId,
    host,
    composed,
    bytes,
    digest: sha256(bytes),
    byteLength: byteLength(bytes),
    sourceMap: builder.build(),
  });
}

/** Compile a composed-v1 graph into one host projection and routed assets. */
export function compileComposedV1({
  skillSource,
  skillSourceCustody,
  modules,
  hostProfile,
  readSource,
  cursorTemplate,
}) {
  if (skillSource.sourceFormat !== 'composed-v1') {
    throw new SkillRuntimeError(
      'E_SKILL_SOURCE_FORMAT_INVALID',
      `compileComposedV1 requires a composed-v1 source; got ${skillSource.sourceFormat}.`,
    );
  }
  const host = hostProfile.host;
  if (!Object.hasOwn(HOST_SUBSTITUTIONS, host)) {
    throw new SkillRuntimeError(
      'E_SKILL_HOST_PROFILE_INCOMPATIBLE',
      `Host profile ${hostProfile.hostProfileId}@${hostProfile.hostProfileVersion} targets unsupported host ${String(host)}.`,
      {
        host,
        hostProfileId: hostProfile.hostProfileId,
        supported: Object.keys(HOST_SUBSTITUTIONS),
        repair: `Retarget the host profile to one of ${Object.keys(HOST_SUBSTITUTIONS).join(', ')}.`,
      },
    );
  }
  if (host === 'cursor' && (typeof cursorTemplate !== 'string' || cursorTemplate.length === 0)) {
    throw new SkillRuntimeError(
      'E_SKILL_CURSOR_TEMPLATE_MISSING',
      `Composed Cursor projection for ${skillSource.skillId} requires the canonical Cursor rule template.`,
      { host, repair: 'Pass packages/skill-runtime/templates/cursor-rule.md as cursorTemplate.' },
    );
  }
  assertSelectedHostProfile(skillSource, hostProfile);

  const skillNode = `skill:${skillSource.skillId}@${skillSource.skillVersion}`;
  assertAuthorityNarrows(skillSource.authorityCeiling, hostProfile.authorityCeiling, {
    edge: {
      from: skillNode,
      to: `host-profile:${hostProfile.hostProfileId}@${hostProfile.hostProfileVersion}`,
      field: 'authorityCeiling',
    },
  });
  const graph = resolveModuleGraph({ skillSource, modules, hostProfile });
  const readVerified = createVerifiedReader(readSource);

  // Verify every selected source before rendering any bytes, including authored
  // skill identity, profile material, and routed dependencies that stay outside
  // the primary body.
  if (
    !skillSourceCustody ||
    typeof skillSourceCustody.path !== 'string' ||
    typeof skillSourceCustody.digest !== 'string'
  ) {
    throw new SkillRuntimeError(
      'E_SKILL_SOURCE_CUSTODY_MISSING',
      `Compilation of ${skillSource.skillId}@${skillSource.skillVersion} requires exact authored skill-source custody.`,
      {
        repair:
          'Pass the authored skill.json path and its exact raw-byte digest as skillSourceCustody.',
      },
    );
  }
  readVerified(skillSourceCustody.path, skillSourceCustody.digest);
  const templateBytes = readVerified(skillSource.template.path, skillSource.template.digest);
  readVerified(hostProfile.source.path, hostProfile.source.digest);
  const sourceBytes = new Map();
  for (const { ref, entry } of graph.allSelectedModules) {
    sourceBytes.set(
      `${ref.moduleId}@${ref.moduleVersion}`,
      readVerified(entry.source.path, entry.source.digest),
    );
  }
  const presentation = assertHostOverlayIsPresentational(
    hostProfile,
    graph.overlayModules,
    ({ ref }) => sourceBytes.get(`${ref.moduleId}@${ref.moduleVersion}`),
  );

  const referencePaths = new Map();
  for (const { ref } of graph.routedReferences) {
    const path = `references/${ref.moduleId}.md`;
    const identity = `${ref.moduleId}@${ref.moduleVersion}`;
    const collision = referencePaths.get(path);
    if (collision && collision !== identity) {
      throw new SkillRuntimeError(
        'E_SKILL_ROUTED_OUTPUT_COLLISION',
        `Routed references ${collision} and ${identity} both render to ${path}.`,
        {
          path,
          first: collision,
          second: identity,
          repair: `Declare only one version of ${ref.moduleId} as a routed reference per skill+host.`,
        },
      );
    }
    referencePaths.set(path, identity);
  }

  const templatePath = skillSource.template.path;
  const tmplOwner = templateOwner(
    templatePath,
    skillSource.skillVersion,
    skillSource.template.digest,
  );
  const skillIdOwner = owner(
    'source',
    `${skillSourceCustody.path}#/skillId`,
    skillSource.skillVersion,
    skillSourceCustody.digest,
  );
  const hostOwner = hostSubstitutionOwner(host);
  const lfOwner = lineEndingOwner();
  const separatorOwner = compilerOwner(
    'packages/skill-runtime/src/compiler/compile.mjs#/MODULE_SEPARATOR',
    COMPOSED_V1_COMPILER_VERSION,
    'openplanr-module-separator@1.0.0:\n',
  );
  const markerParts = templateBytes.split('{{MODULES}}');
  if (markerParts.length !== 2) {
    throw new SkillRuntimeError(
      'E_SKILL_TEMPLATE_MODULES_MARKER_INVALID',
      'A composed-v1 template must contain exactly one {{MODULES}} insertion point.',
      { templatePath },
    );
  }

  const hostValues = Object.freeze({ ...HOST_SUBSTITUTIONS[host], ...presentation.substitutions });
  const hostValueOwners = Object.freeze(
    Object.fromEntries(
      Object.entries(presentation.sources).map(([token, source]) => [
        token,
        owner(
          'host-profile',
          `${source.path}#/substitutions/${token}`,
          source.version,
          source.digest,
        ),
      ]),
    ),
  );
  const context = {
    hostOwner,
    hostValues,
    hostValueOwners,
    lfOwner,
    separatorOwner,
    skillId: skillSource.skillId,
    skillIdOwner,
    allowSkillId: true,
  };
  const intermediate = new SourceMapBuilder();
  appendTokenized(intermediate, markerParts[0], tmplOwner, host, context);
  const primaryPath = skillPrimaryPath(host, skillSource.skillId);
  appendModuleSequence(intermediate, graph.inlineModules, sourceBytes, host, context, primaryPath, {
    appendFinalLineEnding: !markerParts[1].startsWith('\n'),
  });
  appendTokenized(intermediate, markerParts[1], tmplOwner, host, context);

  const intermediateBytes = intermediate.text;
  const segments = sourceMapSegments(intermediateBytes, intermediate.build());
  const supportPaths = [...referencePaths.keys()].map((path) => path.slice('references/'.length));
  let projected;
  if (host === 'claude-code' || host === 'pipeline') {
    projected = intermediate;
  } else if (host === 'codex') {
    projected = projectCodexMap(intermediateBytes, segments);
  } else {
    projected = projectCursorMap(
      intermediateBytes,
      segments,
      skillSource.skillId,
      cursorTemplate,
      supportPaths,
      COMPOSED_V1_COMPILER_VERSION,
      true,
    );
  }
  const bytes = renderSkillForHost(
    intermediateBytes,
    skillSource.skillId,
    host,
    cursorTemplate,
    supportPaths,
    { quoteCursorDescription: true },
  );
  if (projected.text !== bytes) {
    throw new SkillRuntimeError(
      'E_SOURCE_MAP_PROJECTION_MISMATCH',
      `Source-map projection for ${skillSource.skillId} on ${host} did not reproduce the rendered bytes.`,
      { host, expected: sha256(bytes), actual: sha256(projected.text) },
    );
  }
  if (!bytes.endsWith('\n'))
    throw new SkillRuntimeError(
      'E_GENERATED_NEWLINE_INVALID',
      `Composed asset for ${skillSource.skillId} must end with a newline.`,
    );
  assertPortableAsset(primaryPath, bytes, host, hostProfile.authorityCeiling);
  const primary = Object.freeze({
    host,
    path: primaryPath,
    bytes,
    digest: sha256(bytes),
    byteLength: byteLength(bytes),
    sourceMap: projected.build(),
  });

  const references = Object.freeze(
    graph.routedReferences.map(({ ref, modules: routedModules }) => {
      const refBuilder = new SourceMapBuilder();
      const sourcePath = `references/${ref.moduleId}.md`;
      const path = skillSupportPath(host, skillSource.skillId, sourcePath);
      appendModuleSequence(refBuilder, routedModules, sourceBytes, host, context, path);
      const refBytes = refBuilder.text;
      assertPortableAsset(path, refBytes, host, hostProfile.authorityCeiling);
      return Object.freeze({
        host,
        moduleId: ref.moduleId,
        moduleVersion: ref.moduleVersion,
        path,
        routed: true,
        bytes: refBytes,
        digest: sha256(refBytes),
        byteLength: byteLength(refBytes),
        sourceMap: refBuilder.build(),
      });
    }),
  );

  const preview = Object.freeze({
    skillId: skillSource.skillId,
    skillVersion: skillSource.skillVersion,
    host,
    hostProfile: `${hostProfile.hostProfileId}@${hostProfile.hostProfileVersion}`,
    inline: Object.freeze(
      graph.inlineModules.map(({ ref, entry }) =>
        Object.freeze({
          moduleId: ref.moduleId,
          moduleVersion: ref.moduleVersion,
          source: entry.source.path,
          mode: 'inline',
        }),
      ),
    ),
    overlay: Object.freeze(
      graph.overlayModules.map(({ ref, entry }) =>
        Object.freeze({
          moduleId: ref.moduleId,
          moduleVersion: ref.moduleVersion,
          source: entry.source.path,
          mode: 'overlay',
        }),
      ),
    ),
    routed: Object.freeze(
      graph.routedReferences.map(({ ref, modules: routedModules }) =>
        Object.freeze({
          moduleId: ref.moduleId,
          moduleVersion: ref.moduleVersion,
          path: skillSupportPath(host, skillSource.skillId, `references/${ref.moduleId}.md`),
          mode: 'routed',
          sources: Object.freeze(
            routedModules.map(({ ref: selectedRef, entry }) =>
              Object.freeze({
                moduleId: selectedRef.moduleId,
                moduleVersion: selectedRef.moduleVersion,
                source: entry.source.path,
              }),
            ),
          ),
        }),
      ),
    ),
  });

  return Object.freeze({ skillId: skillSource.skillId, host, primary, references, preview, graph });
}

export { sha256Bytes };
