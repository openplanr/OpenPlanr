import { assertProtocolArtifact, listOperatingRoles } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';
import { roleById } from './advisor-brief.mjs';

const MANDATE_PROTOCOL_VERSION = '1.3.0';
const MANDATE_RESPONSE_SCHEMA = 'operating-advisor-response@1.3.0';
const MANDATE_CITATION_SHAPE = 'operating-citation@1.3.0';

const CITATION_REQUIREMENT_DESCRIPTION =
  'Every claim carries a repository path with a line range and revision, a git revision, '
  + 'or a planr artifact id. The engine resolves and snapshots each citation fail-closed at '
  + 'the pinned revision and mints the evidence-of-record from what actually resolved; a '
  + 'fabricated, moved, unresolvable, or above-ceiling citation becomes a governed gap.';

function uniqueSorted(values) {
  return [...new Set(Array.isArray(values) ? values : [])].sort();
}

/**
 * Build the canonical Protocol v1.3 operating mandate for a role (FR1/FR5). The
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
  const { roots = [], forbiddenPaths = [] } = options;
  const examine = [...role.investigationMandate.examine];
  const unsigned = {
    kind: 'operating-mandate',
    schemaVersion: '1.0.0',
    protocolVersion: MANDATE_PROTOCOL_VERSION,
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
    responseSchema: MANDATE_RESPONSE_SCHEMA,
    citationRequirement: {
      everyClaimCited: true,
      citationShape: MANDATE_CITATION_SHAPE,
      description: CITATION_REQUIREMENT_DESCRIPTION,
    },
  };
  const mandate = { ...unsigned, mandateDigest: sha256Jcs(unsigned) };
  assertProtocolArtifact('operating-mandate', mandate, {
    protocolVersion: MANDATE_PROTOCOL_VERSION,
  });
  return mandate;
}

export function listOperatingMandates(options = {}) {
  return listOperatingRoles()
    .map(({ id }) => createOperatingMandate(id, options))
    .sort((left, right) => left.roleId.localeCompare(right.roleId));
}
