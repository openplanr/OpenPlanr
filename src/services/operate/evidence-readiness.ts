import { canonicalDigest } from './canonical.js';
import { assertOperatingArtifact, loadOperatingProtocol } from './protocol.js';
import { compareSensitivity, prepareAdvisorEvidenceText } from './redaction.js';
import {
  type EvidenceRequirement,
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  type OperatingEvidence,
  type OperatingEvidenceIndexItem,
  type OperatingEvidenceReadiness,
  type OperatingRoleId,
} from './types.js';

interface RegistryRequirement extends EvidenceRequirement {}

interface RegistryRole {
  id: OperatingRoleId;
  minimumEvidence: {
    match: 'all' | 'any';
    requirements: RegistryRequirement[];
  };
}

function ageHours(iso: string, now: Date): number {
  return Math.max(0, (now.getTime() - Date.parse(iso)) / (60 * 60 * 1_000));
}

export async function evaluateEvidenceReadiness(input: {
  cycleId: string;
  evidence: OperatingEvidence;
  enabledRoles: OperatingRoleId[];
  now?: Date;
  /**
   * FR2: the POST-index evidence view a mission-mode role's packet is actually
   * built from. When provided, a `repository` requirement is additionally capped
   * by the number of repository items that survived the mission index — so a role
   * whose repository items were all dropped by the dot-prefixed/pattern filter is
   * gated not-ready instead of dispatching "ready" against a pre-index item set
   * that no bounded mission packet can reference. Omitting it preserves the
   * pre-index behaviour for the standard (pack-mode) engine path.
   */
  missionEvidenceIndex?: readonly OperatingEvidenceIndexItem[];
}): Promise<OperatingEvidenceReadiness> {
  const now = input.now ?? new Date();
  const registry = (
    await loadOperatingProtocol()
  ).listOperatingRoles() as unknown as RegistryRole[];
  const postIndexRepositoryCount = input.missionEvidenceIndex
    ? input.missionEvidenceIndex.filter((item) => item.source === 'repository').length
    : null;
  const eligibleItems = input.evidence.items.filter(
    (item) =>
      !prepareAdvisorEvidenceText({
        evidenceId: item.id,
        digest: item.digest,
        value: item.summary ?? '',
      }).quarantined,
  );
  let gapNumber = 1;
  const roles = input.enabledRoles.map((roleId) => {
    const role = registry.find((entry) => entry.id === roleId);
    const configured = role?.minimumEvidence.requirements ?? [
      {
        source: 'repository',
        claimTypes: ['code'],
        minimumItems: 1,
        maxAgeHours: 168,
        observationWindow: 'current-state' as const,
        sensitivityCeiling: 'internal' as const,
      },
    ];
    const requirements = configured.map((requirement) => {
      const matching = eligibleItems.filter(
        (item) =>
          item.source === requirement.source &&
          requirement.claimTypes.some((claim) => item.claimTypes.includes(claim)) &&
          compareSensitivity(item.sensitivity, requirement.sensitivityCeiling) <= 0,
      );
      const oldestAgeHours =
        matching.length > 0
          ? Math.max(...matching.map((item) => ageHours(item.collectedAt, now)))
          : null;
      // FR2: for a mission-mode evaluation, a `repository` requirement can be
      // satisfied only by repository items the mission index actually retained —
      // dot-prefixed/pattern-dropped repository items are unreachable by a bounded
      // mission packet, so they cannot count toward readiness.
      const observedItems =
        postIndexRepositoryCount !== null && requirement.source === 'repository'
          ? Math.min(matching.length, postIndexRepositoryCount)
          : matching.length;
      const satisfied =
        observedItems >= requirement.minimumItems &&
        oldestAgeHours !== null &&
        oldestAgeHours <= requirement.maxAgeHours &&
        (requirement.observationWindow === 'current-state' ||
          requirement.observationWindow === 'current-cycle' ||
          matching.some((item) => item.observedFrom && item.observedTo));
      return {
        ...structuredClone(requirement),
        observedItems,
        oldestAgeHours,
        satisfied,
      };
    });
    const ready =
      (role?.minimumEvidence.match ?? 'all') === 'any'
        ? requirements.some((requirement) => requirement.satisfied)
        : requirements.every((requirement) => requirement.satisfied);
    const gapId = ready ? null : `GAP-${String(gapNumber++).padStart(3, '0')}`;
    return {
      roleId,
      readiness: ready ? ('ready' as const) : ('not_evaluated' as const),
      requirements,
      missingEvidence: requirements
        .filter((requirement) => !requirement.satisfied)
        .map(
          (requirement) =>
            `${requirement.source}:${requirement.claimTypes.join('+')} (${requirement.observedItems}/${requirement.minimumItems})`,
        ),
      evidenceRefs: eligibleItems
        .filter((item) =>
          requirements.some(
            (requirement) =>
              requirement.source === item.source &&
              requirement.claimTypes.some((claim) => item.claimTypes.includes(claim)),
          ),
        )
        .map((item) => item.id)
        .sort(),
      modelCallAllowed: ready,
      gapId,
    };
  });
  const readiness: OperatingEvidenceReadiness = {
    kind: 'operating-evidence-readiness',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    cycleId: input.cycleId,
    inputDigest: canonicalDigest({
      evidence: input.evidence.fingerprint,
      roles: input.enabledRoles,
      advisorEligibleEvidenceRefs: eligibleItems.map((item) => item.id).sort(),
    }),
    evaluatedAt: now.toISOString(),
    roles,
  };
  return assertOperatingArtifact('operating-evidence-readiness', readiness);
}
