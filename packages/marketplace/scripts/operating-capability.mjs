export function atLeast(actual, minimum) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
    if (!match) return null;
    return {
      core: match.slice(1, 4).map(Number),
      prerelease: match[4] ?? null,
    };
  };
  const left = parse(actual);
  const right = parse(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] > right.core[index]) return true;
    if (left.core[index] < right.core[index]) return false;
  }
  if (left.prerelease && !right.prerelease) return false;
  if (!left.prerelease && right.prerelease) return true;
  if (left.prerelease && right.prerelease) {
    return left.prerelease.localeCompare(right.prerelease, undefined, { numeric: true }) >= 0;
  }
  return true;
}

export function resolveOperatingBoard({
  protocolVersion,
  pipelineVersion,
  cliVersion,
  skillsVersion,
  marketplaceVersion,
  operatingRolesPresent,
  cliCommandPresent,
  operateSkillPresent,
  adapters,
  releaseVerified,
}) {
  const certifiedAdapterIds = new Set(['claude-code', 'codex', 'cursor']);
  const certifiedAdapters = adapters.filter(({ runtime }) => certifiedAdapterIds.has(runtime));
  const declaresOperatingBoard = (adapter) =>
    adapter.operatingBoard?.declared ?? adapter.operatingBoard?.available ?? false;
  const readiness = {
    protocol: atLeast(protocolVersion, '1.2.0'),
    pipeline: atLeast(pipelineVersion, '0.30.0') && operatingRolesPresent,
    cli: atLeast(cliVersion, '1.14.0') && cliCommandPresent,
    skills: atLeast(skillsVersion, '1.16.0') && operateSkillPresent,
    adapters:
      certifiedAdapters.length === certifiedAdapterIds.size &&
      certifiedAdapters.every(declaresOperatingBoard),
    release: releaseVerified === true,
  };
  const missing = Object.entries(readiness)
    .filter(([, ready]) => !ready)
    .map(([name]) => name);

  const status = missing.length ? 'unavailable' : 'available';
  return {
    status,
    command: 'planr operate',
    protocolRange: '^1.2.0',
    components: {
      pipeline: pipelineVersion,
      cli: cliVersion,
      skills: skillsVersion,
      marketplace: marketplaceVersion,
    },
    certifiedRuntimes:
      status === 'available'
        ? certifiedAdapters.filter(declaresOperatingBoard).map((adapter) => adapter.runtime)
        : [],
    missing,
  };
}
