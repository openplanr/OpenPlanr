import { SkillAuthoringError } from './diagnostics.mjs';

export const AUTHORING_RESULT_KIND = 'skill-author-command-result';
export const AUTHORING_RESULT_VERSION = '1.0.0';

const COMMANDS = [
  ['lint', false, 'Validate the canonical module graph and host overlays.'],
  ['generate', true, 'Compile and atomically replace the owned local output tree.'],
  ['check', false, 'Compile in memory and report deterministic output drift.'],
  ['preview', false, 'Explain composition, host decisions, outputs, and source ownership.'],
  ['evaluate', false, 'Run the local deterministic skill evaluation suite.'],
];

export const AUTHORING_COMMANDS = Object.freeze(
  Object.fromEntries(
    COMMANDS.map(([command, writesOutput, description]) => [
      command,
      Object.freeze({
        command,
        description,
        writesOutput,
        npmScript: `skill:${command}`,
      }),
    ]),
  ),
);

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

const immutable = (value) => freeze(structuredClone(value));

export function getAuthoringCommand(command) {
  const contract = AUTHORING_COMMANDS[command];
  if (!contract) {
    throw new SkillAuthoringError(
      'E_SKILL_AUTHORING_COMMAND_UNKNOWN',
      `Unknown skill authoring command ${String(command)}.`,
      {
        path: 'package.json',
        owner: { kind: 'toolchain', id: 'skill-authoring', version: AUTHORING_RESULT_VERSION },
        repair: `Use one of: ${Object.keys(AUTHORING_COMMANDS).join(', ')}.`,
        usage: true,
      },
    );
  }
  return contract;
}

export function authoringUsage(command) {
  const contract = getAuthoringCommand(command);
  return `Usage: npm run ${contract.npmScript} -- <skill-dir> [--json]`;
}

export function parseAuthoringArgs(command, argv) {
  getAuthoringCommand(command);
  let json = false;
  const positionals = [];
  for (const argument of argv) {
    if (argument === '--json') json = true;
    else if (argument === '--help' || argument === '-h')
      return Object.freeze({ help: true, json: false });
    else if (argument.startsWith('-')) {
      return Object.freeze({ error: `Unknown option ${argument}.`, json: false });
    } else positionals.push(argument);
  }
  if (positionals.length !== 1) {
    return Object.freeze({ error: 'Exactly one skill directory argument is required.', json });
  }
  return Object.freeze({ json, skillDir: positionals[0] });
}

function moduleSummary(module) {
  return Object.freeze({
    moduleId: module.moduleId,
    moduleVersion: module.moduleVersion,
    moduleKind: module.moduleKind,
    source: module.source.path,
    appliesWhen: module.appliesWhen,
    authority: immutable(module.authorityCeiling),
    dependsOn: Object.freeze(
      (module.dependsOn ?? []).map(({ moduleId, moduleVersion }) =>
        Object.freeze({ moduleId, moduleVersion }),
      ),
    ),
    references: Object.freeze(
      (module.references ?? []).map(({ moduleId, moduleVersion }) =>
        Object.freeze({ moduleId, moduleVersion }),
      ),
    ),
  });
}

function profileSummary(profile) {
  return Object.freeze({
    id: profile.hostProfileId,
    version: profile.hostProfileVersion,
    host: profile.host,
    source: profile.source.path,
    authority: immutable(profile.authorityCeiling),
    overlayModules: Object.freeze(
      (profile.overlayModules ?? []).map(({ moduleId, moduleVersion }) =>
        Object.freeze({ moduleId, moduleVersion }),
      ),
    ),
    runtimeCapabilities: Object.freeze([...(profile.runtimeCapabilities ?? [])]),
    interactionBindings: immutable(profile.interactionBindings ?? []),
  });
}

/**
 * Produce the shared public description of the canonical graph used by every
 * authoring command. Integrity digests remain internal compiler data and are
 * intentionally absent from this contributor-facing contract.
 */
export function describeAuthoringGraph(loaded) {
  return Object.freeze({
    skillId: loaded.skillSource.skillId,
    skillVersion: loaded.skillSource.skillVersion,
    sourceFormat: loaded.skillSource.sourceFormat,
    sources: Object.freeze({
      skill: 'skill.json',
      modules: 'modules.json',
      hostProfiles: 'host-profiles.json',
      template: loaded.skillSource.template.path,
    }),
    modules: Object.freeze(
      loaded.modules
        .map(moduleSummary)
        .sort((left, right) =>
          `${left.moduleId}@${left.moduleVersion}`.localeCompare(
            `${right.moduleId}@${right.moduleVersion}`,
          ),
        ),
    ),
    hostProfiles: Object.freeze(
      loaded.declaredProfiles
        .map(profileSummary)
        .sort((left, right) =>
          `${left.id}@${left.version}`.localeCompare(`${right.id}@${right.version}`),
        ),
    ),
  });
}
