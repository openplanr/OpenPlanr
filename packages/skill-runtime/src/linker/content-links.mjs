import { posix } from 'node:path';

import { SkillRuntimeError } from '../errors.mjs';

const MARKDOWN_LINK = /!?\[[^\]\n]*\]\((?:<([^>\n]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'))?\)/gu;
const INLINE_CODE = /`([^`\n]+)`/gu;
const FENCE = /^\s*(```|~~~)/u;
const PACKAGED_PREFIX = /^(?:agents|assets|commands|procedures|references|scripts)\//u;
const EXTERNAL_TARGET = /^(?:https?:|mailto:|tel:|data:)/iu;

function fail(code, message, details) {
  throw new SkillRuntimeError(code, message, details);
}

function lineNumber(bytes, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (bytes.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function withoutCodeFences(bytes) {
  let fenced = false;
  return String(bytes)
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) {
        fenced = !fenced;
        return '';
      }
      return fenced ? '' : line;
    })
    .join('\n');
}

function normalizedTarget(rawTarget, context) {
  const target = rawTarget.trim();
  if (target.length === 0 || target.startsWith('#') || EXTERNAL_TARGET.test(target)) return null;
  if (
    target.startsWith('/') ||
    target.includes('\\') ||
    /^[A-Za-z]:/u.test(target) ||
    target.includes('\0') ||
    target.startsWith('file:')
  ) {
    fail(
      'E_SKILL_CONTENT_LINK_UNSAFE',
      `Skill content link ${target} is not a safe package-relative target.`,
      {
        ...context,
        target,
        repair:
          'Use a package-relative Markdown link or describe the path as a user-project example.',
      },
    );
  }
  const [path] = target.split(/[?#]/u, 1);
  const segments = path.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.' || segment.length === 0)) {
    fail(
      'E_SKILL_CONTENT_LINK_UNSAFE',
      `Skill content link ${target} contains a non-canonical path segment.`,
      {
        ...context,
        target,
        repair: 'Link directly to a file inside the skill release unit without traversal segments.',
      },
    );
  }
  return path;
}

/** Parse package-relative Markdown links and ambiguous inline-code dependencies. */
export function parseSkillContentLinks({ bytes, path, skillId, host }) {
  const source = String(bytes);
  const visible = withoutCodeFences(source);
  const links = [];
  for (const match of visible.matchAll(MARKDOWN_LINK)) {
    const target = match[1] ?? match[2];
    const line = lineNumber(visible, match.index);
    const localPath = normalizedTarget(target, { skillId, host, path, line });
    links.push(Object.freeze({ target, localPath, line, syntax: 'markdown-link' }));
  }

  const ambiguous = [];
  for (const match of visible.matchAll(INLINE_CODE)) {
    const target = match[1].trim();
    if (!PACKAGED_PREFIX.test(target)) continue;
    ambiguous.push(
      Object.freeze({ target, line: lineNumber(visible, match.index), syntax: 'inline-code' }),
    );
  }
  return Object.freeze({ links: Object.freeze(links), ambiguous: Object.freeze(ambiguous) });
}

/**
 * Prove one compiled host projection is a closed, readable release unit. Every
 * routed support asset must be linked and every local link must resolve exactly.
 */
export function linkSkillProjection({ skillId, host, primary, references = [], auxiliary = [] }) {
  const assets = [primary, ...references, ...auxiliary];
  const byPath = new Map();
  for (const asset of assets) {
    if (!asset || typeof asset.path !== 'string' || typeof asset.bytes !== 'string') {
      fail(
        'E_SKILL_CONTENT_ASSET_INVALID',
        `Skill ${skillId} has an invalid ${host} content asset.`,
        {
          skillId,
          host,
          repair: 'Compile regular text assets before linking the release unit.',
        },
      );
    }
    if (byPath.has(asset.path)) {
      fail(
        'E_SKILL_CONTENT_ASSET_DUPLICATE',
        `Skill ${skillId} emits ${asset.path} more than once.`,
        {
          skillId,
          host,
          path: asset.path,
          repair: 'Assign one canonical owner to the generated path.',
        },
      );
    }
    byPath.set(asset.path, asset);
  }

  const linked = new Set();
  const links = [];
  for (const asset of assets.filter(({ path }) => /\.(?:md|mdc)$/u.test(path))) {
    const parsed = parseSkillContentLinks({ bytes: asset.bytes, path: asset.path, skillId, host });
    const localMarkdownTargets = new Set(
      parsed.links.filter(({ localPath }) => localPath).map(({ localPath }) => localPath),
    );
    for (const dependency of parsed.ambiguous) {
      if (localMarkdownTargets.has(dependency.target)) continue;
      fail(
        'E_SKILL_CONTENT_REFERENCE_AMBIGUOUS',
        `${skillId} names packaged dependency ${dependency.target} as inline code instead of a readable link.`,
        {
          skillId,
          host,
          path: asset.path,
          line: dependency.line,
          target: dependency.target,
          repair: `Use a Markdown link such as [supporting guidance](${dependency.target}) and package the target, or remove the dependency.`,
        },
      );
    }
    for (const dependency of parsed.links) {
      if (!dependency.localPath) continue;
      const resolved = posix.normalize(posix.join(posix.dirname(asset.path), dependency.localPath));
      if (!byPath.has(resolved)) {
        const caseMatch = [...byPath.keys()].find(
          (candidate) => candidate.toLowerCase() === resolved.toLowerCase(),
        );
        fail(
          caseMatch ? 'E_SKILL_CONTENT_LINK_CASE' : 'E_SKILL_CONTENT_LINK_MISSING',
          `${skillId} links ${dependency.target} from ${asset.path}, but ${resolved} is not in the ${host} release unit.`,
          {
            skillId,
            host,
            path: asset.path,
            line: dependency.line,
            target: dependency.target,
            resolved,
            ...(caseMatch ? { caseMatch } : {}),
            repair: caseMatch
              ? `Match the generated file casing exactly: ${caseMatch}.`
              : `Declare and generate ${resolved}, or remove the link.`,
          },
        );
      }
      linked.add(resolved);
      links.push(Object.freeze({ from: asset.path, to: resolved, line: dependency.line }));
    }
  }

  const orphaned = references.map(({ path }) => path).filter((path) => !linked.has(path));
  if (orphaned.length > 0) {
    fail(
      'E_SKILL_CONTENT_ASSET_ORPHANED',
      `${skillId} packages support content that no instruction links.`,
      {
        skillId,
        host,
        orphaned,
        repair:
          'Link each routed reference from SKILL.md at the point where it should be read, or stop packaging it.',
      },
    );
  }
  return Object.freeze({
    skillId,
    host,
    entrypoint: primary.path,
    assets: Object.freeze(assets.map(({ path }) => path).sort()),
    links: Object.freeze(links),
    linkedSupport: Object.freeze([...linked].sort()),
  });
}

/** Link every host result emitted by one canonical skill compilation. */
export function linkSkillProjections(projections) {
  return Object.freeze(
    projections.map((projection) =>
      linkSkillProjection({
        skillId: projection.skillId,
        host: projection.host,
        primary: projection.primary,
        references: projection.references,
      }),
    ),
  );
}
