import { SkillRuntimeError } from '../errors.mjs';
import {
  assertSafeSourcePath,
  renderCodexSkill,
  renderCursorSkill,
  renderHostTokens,
  sha256,
} from './render-primitives.mjs';

const INCLUDE_BLOCK = /<!-- openplanr:include:start ([^\s<>]+) -->[\s\S]*?<!-- openplanr:include:end -->/gu;
const INCLUDE_START = /<!-- openplanr:include:start ([^\s<>]+) -->/gu;
const INCLUDE_END = /<!-- openplanr:include:end -->/gu;
const CRLF = /\r\n/gu;
const INCLUDE_COMMENT_HEAD = '<!-- Composed from ';
const INCLUDE_COMMENT_TAIL = '. Do not edit generated projection. -->\n';

const compilerFragment = (text, pointer, digestSeed) => Object.freeze({
  text,
  ownerKind: 'compiler',
  pointer,
  digest: sha256(digestSeed),
});

const sourceFragment = (text, path, digest) => Object.freeze({
  text,
  ownerKind: 'source',
  pointer: path,
  digest,
});

function pushFragment(target, fragment) {
  if (fragment.text.length === 0) return;
  const previous = target.at(-1);
  if (
    previous
    && previous.ownerKind === fragment.ownerKind
    && previous.pointer === fragment.pointer
    && previous.digest === fragment.digest
  ) {
    target[target.length - 1] = Object.freeze({ ...previous, text: `${previous.text}${fragment.text}` });
  } else {
    target.push(fragment);
  }
}

function normalizeSourceFragments(bytes, path, digest) {
  const raw = String(bytes);
  const fragments = [];
  let last = 0;
  for (const match of raw.matchAll(CRLF)) {
    pushFragment(fragments, sourceFragment(raw.slice(last, match.index), path, digest));
    pushFragment(fragments, compilerFragment(
      '\n',
      'packages/skill-runtime/src/compiler/render-primitives.mjs#/canonicalText/crlf-to-lf',
      'openplanr-canonical-text@1.0.0:CRLF->LF',
    ));
    last = match.index + match[0].length;
  }
  pushFragment(fragments, sourceFragment(raw.slice(last), path, digest));
  return fragments;
}

function sliceFragments(fragments, start, end) {
  const selected = [];
  let cursor = 0;
  for (const fragment of fragments) {
    const next = cursor + fragment.text.length;
    if (next > start && cursor < end) {
      const localStart = Math.max(0, start - cursor);
      const localEnd = Math.min(fragment.text.length, end - cursor);
      pushFragment(selected, Object.freeze({ ...fragment, text: fragment.text.slice(localStart, localEnd) }));
    }
    cursor = next;
    if (cursor >= end) break;
  }
  return selected;
}

function trimEndFragments(fragments) {
  const text = fragments.map((fragment) => fragment.text).join('');
  return sliceFragments(fragments, 0, text.trimEnd().length);
}

/**
 * Fail-closed markdown-v1 include composition. `readSource(path)` returns the
 * canonicalized bytes of an included support file. Returns the composed text and
 * the ordered set of contributing include sources with their digests.
 */
export function composeIncludes(bytes, { sourcePath, readSource, stack = [sourcePath] }) {
  assertSafeSourcePath(sourcePath);
  const sourceDigest = sha256(bytes);
  const normalized = normalizeSourceFragments(bytes, sourcePath, sourceDigest);
  const source = normalized.map((fragment) => fragment.text).join('');
  const starts = [...source.matchAll(INCLUDE_START)];
  const ends = [...source.matchAll(INCLUDE_END)];
  const blocks = [...source.matchAll(INCLUDE_BLOCK)];
  if (starts.length !== ends.length || blocks.length !== starts.length) {
    throw new SkillRuntimeError(
      'E_SKILL_INCLUDE_MARKER_INVALID',
      `${sourcePath} has an unpaired or malformed OpenPlanr include marker.`,
      { sourcePath, starts: starts.length, ends: ends.length, blocks: blocks.length },
    );
  }
  const compositionSources = new Map();
  const fragments = [];
  let last = 0;
  for (const match of blocks) {
    for (const fragment of sliceFragments(normalized, last, match.index)) pushFragment(fragments, fragment);
    const includePath = match[1];
    // Include paths are extracted live from untrusted markdown include markers, so
    // guard them at the compiler boundary before any readSource sees them.
    assertSafeSourcePath(includePath, 'include path');
    if (stack.includes(includePath)) {
      throw new SkillRuntimeError(
        'E_SKILL_INCLUDE_CYCLE',
        `Skill composition contains a cycle through ${includePath}.`,
        { stack: [...stack, includePath] },
      );
    }
    const includeBytes = readSource(includePath);
    const nested = composeIncludes(includeBytes, {
      sourcePath: includePath,
      readSource,
      stack: [...stack, includePath],
    });
    const includeDigest = sha256(includeBytes);
    const prior = compositionSources.get(includePath);
    if (prior && prior.digest !== includeDigest) {
      throw new SkillRuntimeError('E_SKILL_INCLUDE_SOURCE_CHANGED', `Included source ${includePath} changed during composition.`, { path: includePath, first: prior.digest, second: includeDigest });
    }
    compositionSources.set(includePath, Object.freeze({ path: includePath, digest: includeDigest }));
    for (const row of nested.compositionSources) {
      const priorNested = compositionSources.get(row.path);
      if (priorNested && priorNested.digest !== row.digest) {
        throw new SkillRuntimeError('E_SKILL_INCLUDE_SOURCE_CHANGED', `Included source ${row.path} changed during composition.`, { path: row.path, first: priorNested.digest, second: row.digest });
      }
      compositionSources.set(row.path, row);
    }
    pushFragment(fragments, compilerFragment(
      INCLUDE_COMMENT_HEAD,
      'packages/skill-runtime/src/compiler/composition.mjs#/INCLUDE_COMMENT_HEAD',
      INCLUDE_COMMENT_HEAD,
    ));
    pushFragment(fragments, sourceFragment(includePath, sourcePath, sourceDigest));
    pushFragment(fragments, compilerFragment(
      INCLUDE_COMMENT_TAIL,
      'packages/skill-runtime/src/compiler/composition.mjs#/INCLUDE_COMMENT_TAIL',
      INCLUDE_COMMENT_TAIL,
    ));
    for (const fragment of trimEndFragments(nested.compositionFragments)) pushFragment(fragments, fragment);
    last = match.index + match[0].length;
  }
  for (const fragment of sliceFragments(normalized, last, source.length)) pushFragment(fragments, fragment);
  const composed = fragments.map((fragment) => fragment.text).join('');
  return Object.freeze({
    bytes: composed,
    compositionSources: Object.freeze([...compositionSources.values()]),
    compositionFragments: Object.freeze(fragments),
  });
}

/**
 * Project canonical skill bytes into a specific host's native asset. Pipeline
 * and Claude Code keep the composed body verbatim (after host-token
 * substitution); Codex strips Claude-only tool policy; Cursor wraps the body in
 * the rule template and repoints reference paths under the skill id.
 */
export function renderSkillForHost(
  bytes,
  id,
  host,
  cursorTemplate,
  supportPaths,
  { quoteCursorDescription = false } = {},
) {
  const hostBytes = renderHostTokens(bytes, host);
  if (host === 'pipeline' || host === 'claude-code') return hostBytes;
  if (host === 'codex') return renderCodexSkill(hostBytes, id);
  if (host === 'cursor') {
    let rendered = renderCursorSkill(hostBytes, id, cursorTemplate, {
      quoteDescription: quoteCursorDescription,
    });
    for (const supportPath of supportPaths) {
      rendered = rendered.replaceAll(`references/${supportPath}`, `references/${id}/${supportPath}`);
    }
    return rendered;
  }
  throw new SkillRuntimeError('E_SKILL_HOST_INVALID', `Unsupported skill projection host ${host}.`);
}

/** Logical asset path below one host's generated-output root. */
export function skillPrimaryPath(host, id) {
  if (host === 'cursor') return `rules/${id}.mdc`;
  if (host === 'pipeline' || host === 'claude-code' || host === 'codex') return `skills/${id}/SKILL.md`;
  throw new SkillRuntimeError('E_SKILL_HOST_INVALID', `Unsupported skill projection host ${host}.`);
}

/** Logical routed-reference path below one host's generated-output root. */
export function skillSupportPath(host, id, supportPath) {
  assertSafeSourcePath(supportPath, 'support path');
  if (!supportPath.startsWith('references/') || supportPath === 'references/') {
    throw new SkillRuntimeError(
      'E_SKILL_SUPPORT_PATH_INVALID',
      `Skill support path ${supportPath} must be below references/.`,
      { path: supportPath },
    );
  }
  if (host === 'cursor') return `rules/references/${id}/${supportPath.slice('references/'.length)}`;
  if (host === 'pipeline' || host === 'claude-code' || host === 'codex') return `skills/${id}/${supportPath}`;
  throw new SkillRuntimeError('E_SKILL_HOST_INVALID', `Unsupported skill projection host ${host}.`);
}

/** Whether a manifest path belongs to one skill's host-native output tree. */
export function isSkillAssetPath(host, id, path) {
  if (typeof path !== 'string') return false;
  try {
    assertSafeSourcePath(path, 'generated asset path');
    if (path === skillPrimaryPath(host, id)) return true;
    const referencePrefix = host === 'cursor'
      ? `rules/references/${id}/`
      : `skills/${id}/references/`;
    return path.startsWith(referencePrefix) && path.length > referencePrefix.length;
  } catch {
    return false;
  }
}
