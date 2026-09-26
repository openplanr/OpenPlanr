import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { DIAGRAM_ERROR_CODES, diagramFail } from '../errors.mjs';

const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export function assertDiagramSlug(slug) {
  const value = String(slug);
  if (!SLUG.test(value)) {
    diagramFail(DIAGRAM_ERROR_CODES.OUTPUT_ESCAPE, `Invalid diagram slug: ${value}`, {
      repair: 'Use lowercase letters, numbers, and single hyphen-separated segments.',
    });
  }
  return value;
}

function canonicalizePotentialPath(target) {
  let candidate = target;
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  const canonicalParent = existsSync(candidate) ? realpathSync.native(candidate) : candidate;
  const suffix = relative(candidate, target);
  return suffix ? resolve(canonicalParent, suffix) : canonicalParent;
}

export function resolveDiagramOutputRoot(outputRoot) {
  if (typeof outputRoot !== 'string' || outputRoot.trim() === '' || outputRoot.includes('\0')) {
    diagramFail(
      DIAGRAM_ERROR_CODES.OUTPUT_ESCAPE,
      'Diagram output root must be a non-empty filesystem path.',
    );
  }
  const root = canonicalizePotentialPath(resolve(outputRoot));
  if (root === sep)
    diagramFail(
      DIAGRAM_ERROR_CODES.OUTPUT_ESCAPE,
      'The filesystem root cannot be a diagram output root.',
    );
  return root;
}

export function assertContainedPath(root, target) {
  const resolved = resolve(target);
  const rel = relative(root, resolved);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)))
    return resolved;
  diagramFail(
    DIAGRAM_ERROR_CODES.OUTPUT_ESCAPE,
    'Diagram output path escapes its configured root.',
    {
      root,
      target: resolved,
    },
  );
}

export function diagramRelativeDirectory(slug) {
  return `diagrams/${assertDiagramSlug(slug)}`;
}
