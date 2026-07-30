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

export function normalizeOperatingAdapter(adapter, pipelineVersion) {
  return {
    runtime: adapter.id,
    version: adapter.version,
    capabilityLevel: adapter.capabilityLevel,
    pipelineRange: `^${pipelineVersion}`,
    operatingBoard: {
      declared: Boolean(
        adapter.capabilities?.operatingBoard && adapter.entrypoints?.operate,
      ),
      available: false,
      entrypoint: adapter.entrypoints?.operate ?? null,
    },
    interactiveQuestions: adapter.capabilities?.interactiveQuestions ?? 'none',
    operatingAdvisorDispatch:
      adapter.capabilities?.operatingAdvisorDispatch ?? null,
  };
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

export function resolveGuidedOperatingBoard({
  protocolVersion,
  pipelineVersion,
  cliVersion,
  skillsVersion,
  marketplaceVersion,
  adapters,
  guidedContractsPresent,
  evidenceDiagnosticsPresent,
  releaseVerified,
}) {
  const certifiedAdapterIds = new Set(['claude-code', 'codex', 'cursor']);
  const certifiedAdapters = adapters.filter(({ runtime }) => certifiedAdapterIds.has(runtime));
  const interactive = (adapter) =>
    ['native', 'chat', 'terminal'].includes(adapter.interactiveQuestions);
  const dispatchDeclared = (adapter) =>
    ['native-isolated', 'native-bounded', 'structured-provider'].includes(
      adapter.operatingAdvisorDispatch,
    );
  const readiness = {
    protocol: atLeast(protocolVersion, '1.2.0'),
    pipeline: atLeast(pipelineVersion, '0.31.0') && guidedContractsPresent,
    cli: atLeast(cliVersion, '1.15.0') && evidenceDiagnosticsPresent,
    skills: atLeast(skillsVersion, '1.17.0'),
    marketplace: atLeast(marketplaceVersion, '1.2.0'),
    adapters:
      certifiedAdapters.length === certifiedAdapterIds.size
      && certifiedAdapters.every(
        (adapter) => interactive(adapter) && dispatchDeclared(adapter),
      ),
    release: releaseVerified === true,
  };
  const missing = Object.entries(readiness)
    .filter(([, ready]) => !ready)
    .map(([name]) => name);
  return {
    status: missing.length ? 'unavailable' : 'available',
    command: 'planr operate',
    protocolRange: '^1.2.0',
    components: {
      pipeline: pipelineVersion,
      cli: cliVersion,
      skills: skillsVersion,
      marketplace: marketplaceVersion,
    },
    certifiedRuntimes: missing.length
      ? []
      : certifiedAdapters.map(({ runtime }) => runtime),
    advisorDispatch: Object.fromEntries(
      certifiedAdapters.map(({ runtime, operatingAdvisorDispatch }) => [
        runtime,
        operatingAdvisorDispatch,
      ]),
    ),
    missing,
  };
}
