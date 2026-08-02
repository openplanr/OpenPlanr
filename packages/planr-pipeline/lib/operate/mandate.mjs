import { assertProtocolArtifact, listOperatingRoles } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';
import { listRuntimeAdapters, normalizeRuntime } from '../pipeline/runtime.mjs';
import { roleById } from './advisor-brief.mjs';

const MANDATE_PROTOCOL_VERSION = '1.4.0';
const MANDATE_RESPONSE_SCHEMA = 'operating-advisor-response@1.4.0';
const MANDATE_CITATION_SHAPE = 'operating-citation@1.4.0';

const CITATION_REQUIREMENT_DESCRIPTION =
  'Every claim carries a repository path with a line range and revision, a git revision, '
  + 'or a planr artifact id. The engine resolves and snapshots each citation fail-closed at '
  + 'the pinned revision and mints the evidence-of-record from what actually resolved; a '
  + 'fabricated, moved, unresolvable, or above-ceiling citation becomes a governed gap.';

function uniqueSorted(values) {
  return [...new Set(Array.isArray(values) ? values : [])].sort();
}

function runtimeBinding(runtime, executionMode) {
  const normalized = normalizeRuntime(runtime ?? 'claude-code');
  const adapter = listRuntimeAdapters().find(({ id }) => id === normalized);
  if (!adapter?.capabilities?.operatingBoard) {
    throw new TypeError(`Runtime ${String(runtime)} does not provide Operating Board assets.`);
  }
  return {
    runtime: normalized,
    runtimeBinding: 'required',
    crossRuntimeFallback: false,
    executionMode: executionMode
      ?? (adapter.capabilities.operatingAdvisorDispatch === 'sequential-native'
        ? 'sequential-native'
        : 'native-agent'),
    assurance: 'runtime-governed',
    toolIsolation: adapter.capabilities.toolIsolation,
  };
}

/**
 * Build the canonical Protocol v1.4 operating mandate for a role. The v1.3
 * compatibility projection remains available when explicitly requested. The
 * mandate is the unit of dispatch: it carries the lens question, the mandate
 * prose, the registry-derived investigation mandate (what to examine and what
 * counts as sufficient grounding), the declared read boundaries, the required
 * response schema, and the citation requirement.
 *
 * It deliberately carries NO evidence body and NO evidence index. `boundaries.roots`
 * come from the caller's declared workspace roots — never an evidence-index-derived
 * subset — so a gitignored `.planr/` tree is fully readable when the caller declares
 * it. The registry remains the source of truth; runtime assets must not copy these
 * instructions by hand.
 */
export function createOperatingMandate(roleId, options = {}) {
  const role = structuredClone(roleById(roleId));
  const {
    roots = ['.'], forbiddenPaths = [], protocolVersion = MANDATE_PROTOCOL_VERSION,
  } = options;
  const examine = [...role.investigationMandate.examine];
  if (protocolVersion === '1.3.0') {
    const legacyUnsigned = {
      kind: 'operating-mandate',
      schemaVersion: '1.0.0',
      protocolVersion,
      roleId: role.id,
      lensQuestion:
        `As ${role.displayLabel}, investigate ${examine.join('; ')} and determine the `
        + `highest-leverage findings, decisions, and gaps within this mandate: ${role.mandate}`,
      mandate: role.mandate,
      investigationMandate: {
        examine,
        sufficientGrounding: role.investigationMandate.sufficientGrounding,
      },
      boundaries: {
        roots: uniqueSorted(roots),
        sensitivityCeiling: role.sensitivityCeiling,
        forbiddenPaths: uniqueSorted(forbiddenPaths),
      },
      responseSchema: 'operating-advisor-response@1.3.0',
      citationRequirement: {
        everyClaimCited: true,
        citationShape: 'operating-citation@1.3.0',
        description: CITATION_REQUIREMENT_DESCRIPTION,
      },
    };
    const legacy = { ...legacyUnsigned, mandateDigest: sha256Jcs(legacyUnsigned) };
    assertProtocolArtifact('operating-mandate', legacy, { protocolVersion });
    return legacy;
  }
  const unsigned = {
    kind: 'operating-mandate',
    schemaVersion: '1.0.0',
    protocolVersion,
    roleId: role.id,
    phase: role.id === 'chair' ? 'chair' : 'advisor',
    lensQuestion:
      `As ${role.displayLabel}, investigate ${examine.join('; ')} and determine the `
      + `highest-leverage findings, decisions, and gaps within this mandate: ${role.mandate}`,
    mandate: role.mandate,
    investigationMandate: {
      examine,
      sufficientGrounding: role.investigationMandate.sufficientGrounding,
    },
    runtimeBinding: runtimeBinding(options.runtime, options.executionMode),
    boundaries: {
      roots: uniqueSorted(roots),
      sensitivityCeiling: role.sensitivityCeiling,
      forbiddenPaths: uniqueSorted(forbiddenPaths),
    },
    procedure: role.id === 'chair'
      ? 'procedures/operate/chair.md'
      : 'procedures/operate/advisor.md',
    responseSchema: MANDATE_RESPONSE_SCHEMA,
    citationRequirement: {
      materialClaimsCited: true,
      materialActionsCited: true,
      citationShape: MANDATE_CITATION_SHAPE,
    },
    permissionPolicy: {
      authority: 'runtime-session',
      planrGrantsPermissions: false,
      forbiddenEffects: [
        'write-workspace',
        'deploy',
        'publish',
        'spend',
        'customer-contact',
        'credential-change',
        'destructive-data',
        'plan',
        'ship',
      ],
    },
  };
  const mandate = { ...unsigned, mandateDigest: sha256Jcs(unsigned) };
  assertProtocolArtifact('operating-mandate', mandate, {
    protocolVersion,
  });
  return mandate;
}

export function listOperatingMandates(options = {}) {
  return listOperatingRoles()
    .map(({ id }) => createOperatingMandate(id, options))
    .sort((left, right) => left.roleId.localeCompare(right.roleId));
}
