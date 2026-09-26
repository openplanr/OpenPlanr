import {
  AUTHORING_EXIT,
  authoringUsage,
  checkSkill,
  evaluateSkill,
  formatDiagnostics,
  generateSkill,
  inspectStandardSkill,
  isStandardSkillPackage,
  lintSkill,
  parseAuthoringArgs,
  previewSkill,
} from '../../packages/skill-runtime/src/authoring/index.mjs';

function formatAuthority(authority) {
  return [
    `repositoryAccess=${authority.repositoryAccess}`,
    `externalDataAccess=${authority.externalDataAccess}`,
    `tools=[${authority.allowedTools.join(', ')}]`,
    `operations=[${authority.allowedOperations.join(', ')}]`,
  ].join(' ');
}

const COMMANDS = Object.freeze({
  lint: Object.freeze({
    operation: lintSkill,
    format: (result) => [
      `lint ok: ${result.skillId}@${result.skillVersion} (${result.sourceFormat})`,
      ...result.modules.map(
        (module) => `  ${module.mode} ${module.moduleId}@${module.moduleVersion}`,
      ),
      ...result.hostProfiles.map(
        (profile) => `  host-profile ${profile.id}@${profile.version} (${profile.host})`,
      ),
    ],
  }),
  generate: Object.freeze({
    operation: generateSkill,
    format: (result) => [
      `generate ok: ${result.skillId}@${result.skillVersion} -> ${result.outputDir}/`,
      ...result.assets.map((asset) => `  wrote ${asset.outputPath} (${asset.byteLength} bytes)`),
      ...result.manifests.map((path) => `  wrote ${path}`),
    ],
  }),
  check: Object.freeze({
    operation: checkSkill,
    format: (result) => [
      `check ok: ${result.skillId} (${result.assets.length} assets, deterministic, ${result.output.state}, no mutation)`,
      ...result.assets.map((asset) => `  ${asset.host} ${asset.path} (${asset.byteLength} bytes)`),
    ],
  }),
  preview: Object.freeze({
    operation: previewSkill,
    format: (result) => {
      const lines = [`preview ok: ${result.skillId}@${result.skillVersion}`];
      for (const host of result.hosts) {
        lines.push(`  host ${host.host} via ${host.hostProfile}`);
        for (const module of host.inline)
          lines.push(`    inline ${module.moduleId}@${module.moduleVersion} (${module.source})`);
        for (const module of host.overlayModules)
          lines.push(
            `    overlay-module ${module.moduleId}@${module.moduleVersion} (${module.source})`,
          );
        for (const reference of host.routed)
          lines.push(
            `    routed ${reference.moduleId}@${reference.moduleVersion} -> ${reference.path}`,
          );
        lines.push(
          `    overlay ${host.overlay.hostProfile}: ${formatAuthority(host.overlay.authority)}`,
        );
        if (host.capabilityDecision) {
          const fallbacks = host.capabilityDecision.fallbacks
            .map(({ surface }) => surface)
            .join(' -> ');
          lines.push(
            `    capability ${host.capabilityDecision.preferred.surface}: declared${fallbacks ? `; fallback ${fallbacks}` : ''}`,
          );
        }
        for (const output of host.outputs)
          lines.push(`    output ${output.kind} ${output.path} (${output.byteLength} bytes)`);
        for (const owner of host.owners)
          lines.push(`    owner ${owner.ownerKind} ${owner.pointer}@${owner.version}`);
        lines.push(
          ...(host.repairs.length === 0
            ? ['    repair none']
            : host.repairs.map((repair) => `    repair ${repair}`)),
        );
      }
      return lines;
    },
  }),
  evaluate: Object.freeze({
    operation: evaluateSkill,
    format: (result) => [
      `evaluate ok: ${result.skillId}`,
      ...result.hosts.map(
        (host) =>
          `  ${host.host} ${host.pass ? 'pass' : 'fail'}: ${host.inlineModules} inline, ${host.routedReferences} routed, ${host.byteLength} bytes${host.reasons.length ? ` (${host.reasons.join('; ')})` : ''}`,
      ),
    ],
  }),
});

/**
 * Run one authoring command: parse args, invoke the typed skill-runtime operation,
 * emit stable human or JSON output, and exit with 0 success, 1 validation/drift, or
 * 2 usage. All graph, authority, and source-map logic lives in skill-runtime.
 */
export function runAuthoringCommand(command) {
  const selected = COMMANDS[command];
  const usage = authoringUsage(command);
  const parsed = parseAuthoringArgs(command, process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${usage}\n`);
    process.exit(AUTHORING_EXIT.ok);
  }
  if (parsed.error) {
    process.stderr.write(`E_USAGE: ${parsed.error}\n${usage}\n`);
    process.exit(AUTHORING_EXIT.usage);
  }
  const standard = command !== 'generate' && isStandardSkillPackage(parsed.skillDir);
  const result = standard
    ? inspectStandardSkill({ skillDir: parsed.skillDir, command })
    : selected.operation({ skillDir: parsed.skillDir });
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    const lines = standard
      ? [
          `${command} ok: ${result.skillId}@${result.skillVersion} (${result.sourceFormat})`,
          `  ${result.hosts.length} hosts, ${result.resources.length} support resources, ${result.entrypointBytes} entrypoint bytes`,
          ...(result.legacyFiles.length > 0
            ? [
                `  ${result.legacyFiles.length} dormant composed-v1 files excluded from host packages`,
              ]
            : []),
          ...result.outputs.map(({ host, entrypoint }) => `  ${host} ${entrypoint}`),
        ]
      : selected.format(result);
    process.stdout.write(`${lines.join('\n')}\n`);
  } else {
    process.stderr.write(`${formatDiagnostics(result.diagnostics)}\n`);
  }
  process.exit(result.exit);
}
