import { SkillRuntimeError } from '../errors.mjs';

// Stable process exit codes shared by every authoring command.
export const AUTHORING_EXIT = Object.freeze({ ok: 0, failure: 1, usage: 2 });

/**
 * Typed error envelope for authoring-facing operations. Wraps a lower-level
 * compiler, graph, authority, or schema failure so lint, check, preview, and
 * evaluate render one identical diagnostic shape. `usage` marks a bad-argument
 * failure that maps to exit code 2 rather than a validation failure (exit 1).
 */
export class SkillAuthoringError extends SkillRuntimeError {
  constructor(code, message, details = {}) {
    super(code, message, details);
    this.name = 'SkillAuthoringError';
    this.usage = details.usage === true;
  }
}

const DOCUMENT_PATHS = Object.freeze({
  'skill-source': 'skill.json',
  'skill-module-registry': 'modules.json',
  'skill-host-profile-registry': 'host-profiles.json',
});

function nodeOwner(node) {
  const match = /^(skill|module|host-profile):([^@]+)@(.+)$/u.exec(node ?? '');
  if (!match) return null;
  return Object.freeze({ kind: match[1], id: match[2], version: match[3] });
}

function pointerOwner(pointer) {
  if (typeof pointer !== 'string') return null;
  const [, fragment = ''] = pointer.split('#', 2);
  const exact = /\/([^/@]+)@([^/]+)$/u.exec(fragment);
  if (pointer.startsWith('modules.json')) {
    return Object.freeze({
      kind: 'module-registry',
      id: exact?.[1] ?? 'modules',
      version: exact?.[2] ?? '1.0.0',
    });
  }
  if (pointer.startsWith('host-profiles.json')) {
    return Object.freeze({
      kind: 'host-profile-registry',
      id: exact?.[1] ?? 'host-profiles',
      version: exact?.[2] ?? '1.0.0',
    });
  }
  if (pointer.startsWith('skill.json')) {
    return Object.freeze({ kind: 'skill-source', id: 'skill', version: '1.0.0' });
  }
  return null;
}

function diagnosticOwner(details, pointer) {
  if (details.owner && typeof details.owner === 'object')
    return Object.freeze({ ...details.owner });
  const edgeOwner = nodeOwner(details.edge?.to);
  if (edgeOwner) return edgeOwner;
  const fromPointer = pointerOwner(pointer);
  if (fromPointer) return fromPointer;
  if (details.kind) {
    return Object.freeze({ kind: 'protocol-contract', id: details.kind, version: '1.6.0' });
  }
  if (details.templatePath) {
    return Object.freeze({ kind: 'template', id: details.templatePath, version: '1.0.0' });
  }
  return Object.freeze({ kind: 'runtime', id: '@openplanr/skill-runtime', version: '0.1.0' });
}

function diagnosticPath(details, pointer, owner) {
  if (details.path ?? details.sourcePath ?? details.templatePath) {
    return details.path ?? details.sourcePath ?? details.templatePath;
  }
  if (typeof pointer === 'string' && pointer.includes('#'))
    return pointer.slice(0, pointer.indexOf('#'));
  if (details.kind && DOCUMENT_PATHS[details.kind]) return DOCUMENT_PATHS[details.kind];
  if (owner.kind === 'module' || owner.kind === 'module-registry') return 'modules.json';
  if (owner.kind === 'host-profile' || owner.kind === 'host-profile-registry')
    return 'host-profiles.json';
  if (owner.kind === 'skill' || owner.kind === 'skill-source') return 'skill.json';
  return 'packages/skill-runtime/src/authoring';
}

/** Normalize any thrown error into a stable, serializable diagnostic. */
export function toDiagnostic(error) {
  if (error instanceof SkillRuntimeError) {
    const details = error.details ?? {};
    const edge = details.edge ?? null;
    const pointer = details.pointer ?? edge?.to ?? null;
    const owner = diagnosticOwner(details, pointer);
    const path = diagnosticPath(details, pointer, owner);
    return Object.freeze({
      code: error.code,
      message: error.message,
      owner,
      path,
      pointer,
      edge,
      repair: details.repair ?? `Inspect ${path} and correct ${error.code} at the named owner.`,
      details,
    });
  }
  return Object.freeze({
    code: 'E_SKILL_AUTHORING_UNEXPECTED',
    message: error instanceof Error ? error.message : String(error),
    owner: Object.freeze({ kind: 'runtime', id: '@openplanr/skill-runtime', version: '0.1.0' }),
    path: 'packages/skill-runtime/src/authoring',
    pointer: null,
    edge: null,
    repair:
      'Inspect the named runtime path and report the unexpected failure with its original message.',
    details: {},
  });
}

/** Render one diagnostic as stable, human-readable text. */
export function formatDiagnostic(diagnostic) {
  const lines = [`${diagnostic.code}: ${diagnostic.message}`];
  lines.push(
    `  owner: ${diagnostic.owner.kind} ${diagnostic.owner.id}@${diagnostic.owner.version}`,
  );
  if (diagnostic.path) lines.push(`  path: ${diagnostic.path}`);
  if (diagnostic.pointer) lines.push(`  pointer: ${diagnostic.pointer}`);
  if (diagnostic.edge) {
    const field = diagnostic.edge.field ? ` [${diagnostic.edge.field}]` : '';
    lines.push(`  edge: ${diagnostic.edge.from} -> ${diagnostic.edge.to}${field}`);
  }
  if (diagnostic.repair) lines.push(`  repair: ${diagnostic.repair}`);
  return lines.join('\n');
}

/** Render an ordered list of diagnostics as text. */
export function formatDiagnostics(diagnostics) {
  return diagnostics.map(formatDiagnostic).join('\n\n');
}
