import { verifyDocumentDigest } from './canonical-json.mjs';
import { CANONICAL_REGISTRIES } from './generated/canonical-registries.mjs';
import { PROTOCOL_ERROR_CODES, ProtocolError } from './errors.mjs';

const fail = (code, message, details) => {
  throw new ProtocolError(code, message, '', details);
};
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function assertDocument(name, value, kind) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.kind !== kind
    || value.protocolVersion !== '1.5.0' || value.digestAlgorithm !== 'sha256'
    || value.canonicalization !== 'rfc8785' || !verifyDocumentDigest(value)) {
    fail(PROTOCOL_ERROR_CODES.DOCUMENT_INVALID, `${name} is not a digest-bound Protocol 1.5 document.`, { name });
  }
}

function assertSortedUnique(values, key, name) {
  const keys = values.map((value) => value[key]);
  if (new Set(keys).size !== keys.length) fail(PROTOCOL_ERROR_CODES.DUPLICATE_ID, `${name} contains duplicate ${key} values.`, { keys });
  const sorted = [...keys].sort();
  if (!equal(keys, sorted)) fail(PROTOCOL_ERROR_CODES.SORT_ORDER_INVALID, `${name} must be sorted by ${key}.`, { keys, sorted });
}

const EXPECTED_ROLES = Object.freeze({
  'planr-backend': ['backend-agent', 'dev', 'conditional', 'implementation-high', 'implementation-result'],
  'planr-database': ['db-agent', 'po-preflight', 'conditional', 'analysis-high', 'task-output-manifest'],
  'planr-designer': ['designer-agent', 'po', 'conditional', 'analysis-high', 'designer-output'],
  'planr-devops': ['devops-agent', 'post-build', 'conditional', 'analysis-high', 'task-output-manifest'],
  'planr-documentation': ['doc-gen-agent', 'post-build', 'conditional', 'analysis-high', 'task-output-manifest'],
  'planr-entity-scaffold': ['entity-scaffold-agent', 'po-preflight', 'manual', 'analysis-high', 'task-output-manifest'],
  'planr-frontend': ['frontend-agent', 'dev', 'conditional', 'implementation-high', 'implementation-result'],
  'planr-qa': ['qa-agent', 'qa', 'always', 'read-only-qa', 'task-output-manifest'],
  'planr-specification': ['specification-agent', 'po', 'always', 'analysis-high', 'specification-output'],
});

const EXPECTED_TASK_KINDS = Object.freeze({
  backend: 'planr-backend', database: 'planr-database', devops: 'planr-devops', documentation: 'planr-documentation',
  'entity-scaffold': 'planr-entity-scaffold', frontend: 'planr-frontend', qa: 'planr-qa',
});

const EXPECTED_SKILLS = Object.freeze([
  'planr-artifact', 'planr-browser-qa', 'planr-ceo-review', 'planr-chair-review', 'planr-challenger-review', 'planr-cmo-review',
  'planr-coo-review', 'planr-cpo-review', 'planr-cto-review', 'planr-dashboard', 'planr-design', 'planr-design-loop',
  'planr-design-review', 'planr-diagram', 'planr-doctor', 'planr-investigate', 'planr-land', 'planr-openplanr', 'planr-operate',
  'planr-plan',
  'planr-plan-review', 'planr-release', 'planr-ship', 'planr-spec', 'planr-status', 'planr-sync',
]);

export function validateCanonicalRegistries(registries = CANONICAL_REGISTRIES) {
  const roles = registries['roles.json'];
  const taskKinds = registries['task-kinds.json'];
  const rules = registries['rules.json'];
  const commands = registries['commands.json'];
  const skills = registries['skills.json'];
  const outputs = registries['outputs.json'];
  const outputPaths = registries['output-paths.json'];
  assertDocument('roles.json', roles, 'role-registry');
  assertDocument('task-kinds.json', taskKinds, 'task-kind-registry');
  assertDocument('rules.json', rules, 'rule-catalog');
  assertDocument('commands.json', commands, 'command-catalog');
  assertDocument('skills.json', skills, 'skill-catalog');
  assertDocument('outputs.json', outputs, 'output-catalog');
  assertDocument('output-paths.json', outputPaths, 'output-path-catalog');

  if (roles.roles.length !== 9) fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, 'Protocol 0.1 requires exactly nine canonical roles.');
  assertSortedUnique(roles.roles, 'roleId', 'roles.json');
  const aliases = new Set();
  const canonicalRoleIds = new Set(roles.roles.map(({ roleId }) => roleId));
  for (const role of roles.roles) {
    if (role.legacyAliases.length !== 1 || aliases.has(role.legacyAliases[0].id) || canonicalRoleIds.has(role.legacyAliases[0].id)) {
      fail(PROTOCOL_ERROR_CODES.DUPLICATE_ID, `Role alias collision for ${role.roleId}.`);
    }
    aliases.add(role.legacyAliases[0].id);
    const expected = EXPECTED_ROLES[role.roleId];
    if (!expected || !equal([
      role.legacyAliases[0]?.id, role.phase, role.activation, role.capabilityTier, role.outputContracts[0]?.id,
    ], expected)) {
      fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, `Role compatibility mapping drifted for ${role.roleId}.`);
    }
    if (role.adapterMappings.length < 3 || role.qaCoverage.length < 1) {
      fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, `Role ${role.roleId} lacks adapter parity or QA coverage.`);
    }
  }
  const qa = roles.roles.find(({ roleId }) => roleId === 'planr-qa');
  const database = roles.roles.find(({ roleId }) => roleId === 'planr-database');
  const devops = roles.roles.find(({ roleId }) => roleId === 'planr-devops');
  if (qa.writeBoundary.repositoryAccess !== 'read-only' || qa.writeBoundary.allowedOutputClasses.includes('C')) {
    fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, 'QA must remain read-only.');
  }
  if (database.writeBoundary.externalDataAccess !== 'read-only' || !database.writeBoundary.forbiddenEffects.includes('database-mutation')) {
    fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, 'Database inspection must remain externally read-only.');
  }
  if (!devops.writeBoundary.forbiddenEffects.includes('deploy')) {
    fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, 'DevOps configuration authority must forbid deploy.');
  }

  if (taskKinds.roleRegistryDigest !== roles.documentDigest || taskKinds.bindings.length !== 7) {
    fail(PROTOCOL_ERROR_CODES.REFERENCE_INVALID, 'Task-kind registry is not bound to the exact role registry.');
  }
  assertSortedUnique(taskKinds.bindings, 'taskKind', 'task-kinds.json bindings');
  for (const binding of taskKinds.bindings) {
    if (EXPECTED_TASK_KINDS[binding.taskKind] !== binding.roleId || !canonicalRoleIds.has(binding.roleId)) {
      fail(PROTOCOL_ERROR_CODES.REFERENCE_INVALID, `Task kind ${binding.taskKind} has a mismatched role binding.`);
    }
    const expectedOutput = ['backend', 'frontend'].includes(binding.taskKind)
      ? 'implementation-result'
      : 'task-output-manifest';
    if (!equal(binding.outputContracts, [{ id: expectedOutput, version: '1.0.0' }])) {
      fail(PROTOCOL_ERROR_CODES.REFERENCE_INVALID, `Task kind ${binding.taskKind} has a mismatched output contract.`);
    }
  }
  if (!equal(taskKinds.legacyMappings.map(({ legacyType, legacyAgent, taskKind, precedence }) => [legacyType, legacyAgent, taskKind, precedence]), [
    ['UI', 'frontend-agent', 'frontend', 1], ['Tech', 'db-agent', 'database', 2],
    ['Tech', 'backend-agent', 'backend', 3], ['Tech', null, 'backend', 4],
  ])) fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, 'Legacy UI/Tech routing precedence drifted.');

  assertSortedUnique(rules.rules, 'ruleId', 'rules.json');
  if (!equal(rules.rules.map(({ ruleId }) => ruleId), ['R1', 'R10', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9'].sort())) {
    fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, 'Rule catalog must contain exact R1-R10.');
  }
  if (rules.rules.some((rule) => !rule.enforcementPoints.length || !rule.testRefs.length || !rule.citedBy.length)) {
    fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, 'Every rule requires enforcement, tests, and citations.');
  }

  const inventory = commands.inventory;
  if (inventory.rootCommandModules !== 39 || inventory.rootCommandSlugs.length !== 39
    || inventory.pipelineMachineLeaves !== 31 || inventory.pipelineMachineGrammar.length !== 31
    || inventory.frozenClaudeDocuments !== 8 || inventory.frozenClaudeSlugs.length !== 8) {
    fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, 'Command inventory floors drifted.');
  }
  assertSortedUnique(commands.commands, 'commandId', 'commands.json');
  const grammar = commands.commands.map(({ argv }) => JSON.stringify(argv));
  if (new Set(grammar).size !== grammar.length) fail(PROTOCOL_ERROR_CODES.DUPLICATE_ID, 'Command grammar contains duplicate argv entries.');
  if (commands.commands.some(({ argv }) => argv[0] === 'pipeline' && argv[1] === 'operate')) {
    fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, 'Retired pipeline Operate grammar became callable.');
  }
  if (!commands.commands.some(({ argv, lifecycle }) => argv[0] === 'operate' && lifecycle === 'active')
    || !commands.negativeContracts.some(({ forbiddenArgvPrefix }) => equal(forbiddenArgvPrefix, ['pipeline', 'operate']))) {
    fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, 'Operate facade/retirement negative contract drifted.');
  }

  assertSortedUnique(skills.skills, 'skillId', 'skills.json');
  const skillIds = skills.skills.map(({ skillId }) => skillId);
  if (!equal(skillIds, EXPECTED_SKILLS)) {
    fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, 'Canonical skill membership differs from the active source registry.');
  }
  if (skillIds.some((id) => canonicalRoleIds.has(id)) || skills.skills.some((skill) => skill.hosts.length < 3 || !skill.certificationRefs.length)) {
    fail(PROTOCOL_ERROR_CODES.DUPLICATE_ID, 'Skill/role IDs collide or a skill lacks host/certification parity.');
  }
  const ship = skills.skills.find(({ skillId }) => skillId === 'planr-ship');
  if (!equal(ship?.contracts?.outputs, [{ id: 'implementation-result', version: '1.0.0' }])) {
    fail(PROTOCOL_ERROR_CODES.REFERENCE_INVALID, 'Planr Ship must produce the canonical implementation result.');
  }
  const aliasIds = skills.compatibilityAliases.map(({ aliasId }) => aliasId).sort();
  if (aliasIds.length !== 0) {
    fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, 'Protocol 1.8 canonical skills must not expose compatibility aliases.');
  }
  for (const command of commands.commands.filter(({ surface }) => surface === 'frozen-host-alias')) {
    if (!skillIds.includes(command.skillId)) fail(PROTOCOL_ERROR_CODES.REFERENCE_INVALID, `Frozen command ${command.commandId} has no canonical skill.`);
  }

  assertSortedUnique(outputs.outputs, 'outputId', 'outputs.json');
  if (!['A', 'B', 'C', 'D'].every((outputClass) => outputs.outputs.some((output) => output.outputClass === outputClass))) {
    fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, 'Output catalog must cover Classes A-D.');
  }
  if (outputs.outputs.some((output) => !output.generator || !output.validator || !output.compatibilityReaders.length || !output.testRefs.length)) {
    fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, 'Every output requires generator, validator, reader, and test custody.');
  }
  const modeAwarePlanningIds = ['gherkin-feature', 'professional-specification', 'task', 'user-story'];
  assertSortedUnique(outputPaths.outputs, 'outputId', 'output-paths.json');
  if (outputPaths.outputCatalogDigest !== outputs.documentDigest
    || !equal(outputPaths.outputs.map(({ outputId }) => outputId), modeAwarePlanningIds)) {
    fail(PROTOCOL_ERROR_CODES.REFERENCE_INVALID, 'Project-mode paths must bind the exact output catalog and complete planning output set.');
  }
  for (const outputPath of outputPaths.outputs) {
    const output = outputs.outputs.find(({ outputId }) => outputId === outputPath.outputId);
    if (outputPath.pathTemplates.default !== output?.pathTemplate
      || !outputPath.pathTemplates['spec-driven']) {
      fail(PROTOCOL_ERROR_CODES.REGISTRY_INVALID, `Output ${outputPath.outputId} has an invalid project-mode path contract.`);
    }
  }
  return true;
}

validateCanonicalRegistries();

const roleIndex = new Map(CANONICAL_REGISTRIES['roles.json'].roles.map((role) => [role.roleId, role]));
const aliasIndex = new Map(CANONICAL_REGISTRIES['roles.json'].roles.flatMap((role) => role.legacyAliases.map(({ id }) => [id, role])));
const taskKindIndex = new Map(CANONICAL_REGISTRIES['task-kinds.json'].bindings.map((binding) => [binding.taskKind, binding]));

export { CANONICAL_REGISTRIES };

export function getCanonicalRegistry(name) {
  const value = CANONICAL_REGISTRIES[name];
  if (!value) fail(PROTOCOL_ERROR_CODES.ASSET_NOT_FOUND, `Unknown canonical registry: ${name}`);
  return value;
}

export function getRole(roleId) {
  const role = roleIndex.get(roleId);
  if (!role) fail(PROTOCOL_ERROR_CODES.REFERENCE_INVALID, `Unknown canonical role: ${roleId}`);
  return role;
}

export function resolveLegacyRoleAlias(alias) {
  return aliasIndex.get(alias) ?? null;
}

export function resolveTaskKind(taskKind) {
  const binding = taskKindIndex.get(taskKind);
  if (!binding) fail(PROTOCOL_ERROR_CODES.REFERENCE_INVALID, `Unknown task kind: ${taskKind}`);
  return binding;
}

/** Resolve one output definition from the canonical catalog or a compatible supplied catalog. */
export function getOutput(outputId, registries = CANONICAL_REGISTRIES) {
  const output = registries['outputs.json']?.outputs?.find((candidate) => candidate.outputId === outputId);
  if (!output) fail(PROTOCOL_ERROR_CODES.REFERENCE_INVALID, `Unknown output: ${outputId}`);
  return output;
}

/** Select the canonical template for one project mode while preserving legacy catalog fallback. */
export function getOutputPathTemplate(outputId, projectMode = 'default', registries = CANONICAL_REGISTRIES) {
  if (projectMode !== 'default' && projectMode !== 'spec-driven') {
    fail(PROTOCOL_ERROR_CODES.REFERENCE_INVALID, `Unknown project mode: ${projectMode}`);
  }
  const output = getOutput(outputId, registries);
  const outputPath = registries['output-paths.json']?.outputs?.find((candidate) => candidate.outputId === outputId);
  return outputPath?.pathTemplates?.[projectMode] ?? output.pathTemplate;
}

const PATH_TOKEN = /\{([A-Za-z][A-Za-z0-9]*)\}/gu;
const SAFE_RELATIVE_PATH = /^(?!\/)(?![A-Za-z]:)(?!.*\\)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/).+$/u;
const MAX_RELATIVE_PATH_LENGTH = 1024;

/** Resolve one catalog path with explicit mode and named template arguments. */
export function resolveOutputPath(outputId, options = {}, registries = CANONICAL_REGISTRIES) {
  const { projectMode = 'default', pathArguments = {} } = options;
  const template = getOutputPathTemplate(outputId, projectMode, registries);
  const missing = [...new Set([...template.matchAll(PATH_TOKEN)].map((match) => match[1]))]
    .filter((name) => typeof pathArguments[name] !== 'string' || pathArguments[name].length === 0);
  if (missing.length > 0) {
    fail(PROTOCOL_ERROR_CODES.REFERENCE_INVALID, `Output ${outputId} path is missing arguments: ${missing.join(', ')}.`, { outputId, projectMode, missing });
  }
  const resolved = template.replace(PATH_TOKEN, (_token, name) => pathArguments[name]);
  if (resolved.length > MAX_RELATIVE_PATH_LENGTH
    || !SAFE_RELATIVE_PATH.test(resolved)
    || /[\u0000\r\n]/u.test(resolved)) {
    fail(PROTOCOL_ERROR_CODES.REFERENCE_INVALID, `Output ${outputId} resolved to an invalid relative path.`, { outputId, projectMode });
  }
  return resolved;
}

/** Route only explicit legacy fields; prose, filenames, hosts, and models are never evidence. */
export function routeLegacyTask({ legacyType, legacyAgent = null }) {
  const mappings = CANONICAL_REGISTRIES['task-kinds.json'].legacyMappings;
  const exact = mappings.find((mapping) => mapping.legacyType === legacyType && mapping.legacyAgent === legacyAgent);
  if (exact) return resolveTaskKind(exact.taskKind);
  if (legacyType === 'Tech' && legacyAgent === null) return resolveTaskKind('backend');
  fail(PROTOCOL_ERROR_CODES.REFERENCE_INVALID, `Legacy routing requires an explicit reviewed mapping for ${legacyType}/${legacyAgent ?? '<none>'}.`);
}
