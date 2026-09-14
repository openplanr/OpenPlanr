import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { OPEN_REFERENCE_OPERATE_EXTENSIONS_V2 } from 'planr-pipeline/operate/extensions-v2';
import {
  createOperatingResultTemplateV2,
  operatingResultSchemaDependenciesV2,
} from 'planr-pipeline/operate/result-packet-v2';
import { type OperatingIntelligenceAssignmentV2, sha256Jcs } from 'planr-pipeline/protocol';
import { createOperateClient, type OperateActorV2, type OperateClient } from './client.js';
import { assertOperatePathCustody, assertOperateTreeCustody } from './path-custody.js';
import { ensureOperateStorageLayout } from './storage-layout.js';

type JsonRecord = Record<string, unknown>;

const PACKET_ID_PATTERN = /^pkt_[a-f0-9]{32}$/u;
const PACKET_FORMAT = 'openplanr-operate-assignment-packet';
const PACKET_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2.0.0';
const RECEIPT_KIND = 'openplanr-operate-assignment-packet-receipt';
const RECEIPT_SWAP_PATTERN = /^\.(pkt_[a-f0-9]{32})\.receipt-(stage|backup)-([a-f0-9-]+)$/u;

type PacketContractKind =
  | 'operating-advisor-result'
  | 'operating-challenger-review'
  | 'operating-decision-ledger';

export type OperateAssignmentPacket = Readonly<{
  kind: typeof PACKET_FORMAT;
  schemaVersion: typeof PACKET_VERSION;
  protocolVersion: typeof PROTOCOL_VERSION;
  packetId: string;
  assignmentId: string;
  cycleId: string;
  submissionId: string;
  actor: OperateActorV2;
  contractKind: PacketContractKind;
  roleId: string;
  roleVersion: string;
  analysisProfile: JsonRecord;
  intelligencePlanId: string;
  snapshotId: string;
  scope: { scopeId: string; domainId: string; domainVersion: string };
  inputArtifactIds: string[];
  inputAbsenceIds: string[];
  outputContract: JsonRecord;
  createdAt: string;
}>;

export type PacketValidationFailure = Readonly<{
  pointer: string;
  rule: string;
  message: string;
}>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stablePacketId(assignmentId: string, submissionId: string, actor: OperateActorV2): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ assignmentId, submissionId, actor }))
    .digest('hex')
    .slice(0, 32);
  return `pkt_${digest}`;
}

function safePacketId(value: string): string {
  if (!PACKET_ID_PATTERN.test(value)) {
    throw Object.assign(new Error('The Operate packet identity is invalid.'), {
      code: 'E_OPERATE_PACKET_ID_INVALID',
    });
  }
  return value;
}

function contractKind(assignment: JsonRecord): PacketContractKind {
  const roleKind = String(assignment.assignmentKind ?? '');
  if (roleKind === 'advisor') return 'operating-advisor-result';
  if (roleKind === 'challenger') return 'operating-challenger-review';
  if (roleKind === 'chair') return 'operating-decision-ledger';
  throw Object.assign(
    new Error(`Assignment role kind ${roleKind || '(missing)'} has no prepared result contract.`),
    {
      code: 'E_OPERATE_PACKET_ROLE_UNSUPPORTED',
    },
  );
}

const PACKET_KEYS = Object.freeze([
  'kind',
  'schemaVersion',
  'protocolVersion',
  'packetId',
  'assignmentId',
  'cycleId',
  'submissionId',
  'actor',
  'contractKind',
  'roleId',
  'roleVersion',
  'analysisProfile',
  'intelligencePlanId',
  'snapshotId',
  'scope',
  'inputArtifactIds',
  'inputAbsenceIds',
  'outputContract',
  'createdAt',
] as const);

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return sha256Jcs(left as never) === sha256Jcs(right as never);
  } catch {
    return false;
  }
}

function assertClosedPacket(value: JsonRecord, packetId: string): OperateAssignmentPacket {
  const foreign = Object.keys(value).find((key) => !PACKET_KEYS.includes(key as never));
  const missing = PACKET_KEYS.find((key) => !Object.hasOwn(value, key));
  const actor = record(value.actor);
  const scope = record(value.scope);
  const outputContract = record(value.outputContract);
  if (
    foreign ||
    missing ||
    value.kind !== PACKET_FORMAT ||
    value.schemaVersion !== PACKET_VERSION ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    value.packetId !== packetId ||
    typeof value.assignmentId !== 'string' ||
    typeof value.cycleId !== 'string' ||
    typeof value.submissionId !== 'string' ||
    actor.kind !== 'agent' ||
    typeof actor.actorId !== 'string' ||
    typeof actor.runtime !== 'string' ||
    Object.keys(actor).some((key) => !['actorId', 'kind', 'runtime'].includes(key)) ||
    ![
      'operating-advisor-result',
      'operating-challenger-review',
      'operating-decision-ledger',
    ].includes(String(value.contractKind)) ||
    typeof value.roleId !== 'string' ||
    typeof value.roleVersion !== 'string' ||
    Object.keys(record(value.analysisProfile)).length === 0 ||
    typeof value.intelligencePlanId !== 'string' ||
    typeof value.snapshotId !== 'string' ||
    typeof scope.scopeId !== 'string' ||
    typeof scope.domainId !== 'string' ||
    typeof scope.domainVersion !== 'string' ||
    Object.keys(scope).some((key) => !['scopeId', 'domainId', 'domainVersion'].includes(key)) ||
    !Array.isArray(value.inputArtifactIds) ||
    value.inputArtifactIds.some((entry) => typeof entry !== 'string') ||
    !Array.isArray(value.inputAbsenceIds) ||
    value.inputAbsenceIds.some((entry) => typeof entry !== 'string') ||
    Object.keys(outputContract).length === 0 ||
    !Number.isFinite(Date.parse(String(value.createdAt)))
  ) {
    throw Object.assign(
      new Error('The prepared Operate packet is not one exact closed packet record.'),
      {
        code: 'E_OPERATE_PACKET_CORRUPT',
        context: { packetId, foreign: foreign ?? null, missing: missing ?? null },
      },
    );
  }
  return value as OperateAssignmentPacket;
}

async function atomicWrite(target: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
  await rename(temporary, target);
}

async function writeJson(target: string, value: unknown): Promise<void> {
  await atomicWrite(target, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'));
}

async function readJson(target: string): Promise<JsonRecord> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(target, 'utf8')) as unknown;
  } catch (cause) {
    throw Object.assign(
      new Error('Prepared Operate packet JSON is unavailable or invalid.', { cause }),
      {
        code: 'E_OPERATE_PACKET_CORRUPT',
      },
    );
  }
  const parsed = record(value);
  if (Object.keys(parsed).length === 0) {
    throw Object.assign(new Error('Prepared Operate packet JSON is not an object.'), {
      code: 'E_OPERATE_PACKET_CORRUPT',
    });
  }
  return parsed;
}

async function assertPacketRelativeFile(root: string, relative: unknown): Promise<string> {
  if (
    typeof relative !== 'string' ||
    !relative ||
    path.posix.isAbsolute(relative) ||
    relative.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw Object.assign(new Error('Prepared packet path custody is invalid.'), {
      code: 'E_OPERATE_PACKET_CORRUPT',
    });
  }
  const target = path.resolve(root, ...relative.split('/'));
  const rootReal = await realpath(root);
  const metadata = await lstat(target);
  const targetReal = await realpath(target);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    (targetReal !== rootReal && !targetReal.startsWith(`${rootReal}${path.sep}`))
  ) {
    throw Object.assign(new Error('Prepared packet file escapes exact packet custody.'), {
      code: 'E_OPERATE_PACKET_CORRUPT',
    });
  }
  return target;
}

async function assertPacketInventories(
  root: string,
  packet: OperateAssignmentPacket,
): Promise<void> {
  const matrix = await readJson(path.join(root, 'evidence-matrix.json'));
  const matrixKeys = ['absences', 'assignmentId', 'inputs', 'packetRoot', 'pathMode'].sort();
  if (
    JSON.stringify(Object.keys(matrix).sort()) !== JSON.stringify(matrixKeys) ||
    matrix.assignmentId !== packet.assignmentId ||
    matrix.pathMode !== 'packet-relative' ||
    matrix.packetRoot !== '.' ||
    !Array.isArray(matrix.inputs) ||
    !Array.isArray(matrix.absences) ||
    !sameJson(
      matrix.absences.map((entry) => record(entry).absenceId),
      packet.inputAbsenceIds,
    )
  ) {
    throw Object.assign(new Error('Prepared packet evidence inventory is corrupt.'), {
      code: 'E_OPERATE_PACKET_CORRUPT',
    });
  }
  const matrixArtifactIds: string[] = [];
  for (const candidate of matrix.inputs) {
    const entry = record(candidate);
    if (
      JSON.stringify(Object.keys(entry).sort()) !==
        JSON.stringify(['artifactId', 'contentPath', 'kind', 'metadata', 'representation']) ||
      typeof entry.artifactId !== 'string' ||
      !['decoded-json', 'raw'].includes(String(entry.representation)) ||
      entry.contentPath !==
        path.posix.join(
          'inputs',
          `${entry.artifactId}.${entry.representation === 'decoded-json' ? 'json' : 'bin'}`,
        )
    ) {
      throw Object.assign(new Error('Prepared packet input path binding is corrupt.'), {
        code: 'E_OPERATE_PACKET_CORRUPT',
      });
    }
    const { metadata, kind } = artifactMetadata(entry.artifactId, entry.metadata);
    if (entry.kind !== kind && entry.representation === 'raw') {
      throw Object.assign(new Error('Prepared packet input schema binding is corrupt.'), {
        code: 'E_OPERATE_PACKET_CORRUPT',
      });
    }
    matrixArtifactIds.push(entry.artifactId);
    const contentPath = await assertPacketRelativeFile(root, entry.contentPath);
    if (entry.representation === 'raw') {
      const bytes = await readFile(contentPath);
      if (
        bytes.length !== metadata.sizeBytes ||
        `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== metadata.rawHash
      ) {
        throw Object.assign(new Error('Prepared packet raw input bytes changed after issuance.'), {
          code: 'E_OPERATE_PACKET_CORRUPT',
        });
      }
    } else {
      const body = await readJson(contentPath);
      if (
        metadata.mediaType !== 'application/json' ||
        metadata.encoding !== 'utf-8' ||
        typeof metadata.canonicalHash !== 'string' ||
        !SHA256_PATTERN.test(metadata.canonicalHash) ||
        sha256Jcs(body as never) !== metadata.canonicalHash ||
        entry.kind !== String(body.kind ?? kind)
      ) {
        throw Object.assign(
          new Error('Prepared packet decoded input differs from its immutable canonical bytes.'),
          { code: 'E_OPERATE_PACKET_CORRUPT' },
        );
      }
    }
  }
  if (!sameJson(matrixArtifactIds, packet.inputArtifactIds)) {
    throw Object.assign(
      new Error('Prepared packet input order differs from the exact Assignment.'),
      {
        code: 'E_OPERATE_PACKET_CORRUPT',
      },
    );
  }

  const catalog = await readJson(path.join(root, 'schema-catalog.json'));
  const catalogKeys = [
    'kind',
    'pathMode',
    'protocolVersion',
    'root',
    'schemaRoot',
    'schemas',
    'schemaVersion',
  ].sort();
  if (
    JSON.stringify(Object.keys(catalog).sort()) !== JSON.stringify(catalogKeys) ||
    catalog.kind !== 'openplanr-operate-schema-catalog' ||
    catalog.schemaVersion !== '1.0.0' ||
    catalog.protocolVersion !== PROTOCOL_VERSION ||
    catalog.pathMode !== 'packet-relative' ||
    catalog.schemaRoot !== 'schemas' ||
    !Array.isArray(catalog.schemas)
  ) {
    throw Object.assign(new Error('Prepared packet schema inventory is corrupt.'), {
      code: 'E_OPERATE_PACKET_CORRUPT',
    });
  }
  const schemaFiles: string[] = [];
  for (const candidate of catalog.schemas) {
    const entry = record(candidate);
    if (
      JSON.stringify(Object.keys(entry).sort()) !==
        JSON.stringify(['fileName', 'kind', 'schemaPath']) ||
      typeof entry.fileName !== 'string' ||
      path.basename(entry.fileName) !== entry.fileName ||
      entry.schemaPath !== path.posix.join('schemas', entry.fileName)
    ) {
      throw Object.assign(new Error('Prepared packet schema path binding is corrupt.'), {
        code: 'E_OPERATE_PACKET_CORRUPT',
      });
    }
    schemaFiles.push(entry.fileName);
    await assertPacketRelativeFile(root, entry.schemaPath);
  }
  const actualSchemaFiles = (await readdir(path.join(root, 'schemas'))).sort();
  if (!sameJson([...schemaFiles].sort(), actualSchemaFiles)) {
    throw Object.assign(new Error('Prepared packet schema directory differs from its inventory.'), {
      code: 'E_OPERATE_PACKET_CORRUPT',
    });
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function assertReceipt(value: JsonRecord, packetId: string): void {
  if (
    value.kind !== RECEIPT_KIND ||
    value.schemaVersion !== '1.0.0' ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    value.packetId !== packetId ||
    typeof value.assignmentId !== 'string' ||
    typeof value.submissionId !== 'string' ||
    typeof value.contentHash !== 'string'
  ) {
    throw Object.assign(new Error('The prepared packet receipt is corrupt.'), {
      code: 'E_OPERATE_PACKET_CORRUPT',
      context: { packetId },
    });
  }
}

async function receiptAt(root: string, packetId: string): Promise<boolean> {
  try {
    const receipt = await readJson(path.join(root, 'receipt.json'));
    assertReceipt(receipt, packetId);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    if ((error as { code?: string }).code === 'E_OPERATE_PACKET_CORRUPT') {
      try {
        await stat(path.join(root, 'packet.json'));
        return false;
      } catch (packetError) {
        if ((packetError as NodeJS.ErrnoException).code === 'ENOENT') throw error;
        throw packetError;
      }
    }
    throw error;
  }
}

function scopeOf(assignment: JsonRecord): OperateAssignmentPacket['scope'] {
  const context = record(assignment.intelligenceContext);
  const scope = {
    scopeId: String(context.scopeId ?? assignment.scopeId ?? ''),
    domainId: String(context.domainId ?? assignment.domainId ?? ''),
    domainVersion: String(context.domainVersion ?? assignment.domainVersion ?? ''),
  };
  if (!scope.scopeId || !scope.domainId || !scope.domainVersion) {
    throw Object.assign(new Error('The issued Assignment has no exact scope identity.'), {
      code: 'E_OPERATE_PACKET_ASSIGNMENT_INVALID',
    });
  }
  return scope;
}

function absenceIds(assignment: JsonRecord): string[] {
  return Array.isArray(assignment.inputAbsences)
    ? assignment.inputAbsences.map((entry) => String(record(entry).absenceId ?? '')).filter(Boolean)
    : [];
}

function exactIdentity(assignment: JsonRecord): {
  cycleId: string;
  roleId: string;
  roleVersion: string;
  analysisProfile: JsonRecord;
  intelligencePlanId: string;
  snapshotId: string;
  scope: OperateAssignmentPacket['scope'];
  inputArtifactIds: string[];
  inputAbsenceIds: string[];
  outputContract: JsonRecord;
} {
  const context = record(assignment.intelligenceContext);
  const identity = {
    cycleId: String(assignment.cycleId ?? ''),
    roleId: String(assignment.roleId ?? ''),
    roleVersion: String(assignment.roleVersion ?? ''),
    analysisProfile: structuredClone(record(assignment.analysisProfile)),
    intelligencePlanId: String(context.intelligencePlanId ?? ''),
    snapshotId: String(context.snapshotId ?? ''),
    scope: scopeOf(assignment),
    inputArtifactIds: Array.isArray(assignment.inputArtifactIds)
      ? assignment.inputArtifactIds.map(String)
      : [],
    inputAbsenceIds: absenceIds(assignment),
    outputContract: structuredClone(record(assignment.outputContract)),
  };
  if (
    !identity.cycleId ||
    !identity.roleId ||
    !identity.roleVersion ||
    Object.keys(identity.analysisProfile).length === 0 ||
    !identity.intelligencePlanId ||
    !identity.snapshotId ||
    Object.keys(identity.outputContract).length === 0
  ) {
    throw Object.assign(
      new Error('The issued Assignment lacks an exact result identity binding.'),
      {
        code: 'E_OPERATE_PACKET_ASSIGNMENT_INVALID',
      },
    );
  }
  return identity;
}

type PreparedDecodedInput = {
  artifactId: string;
  metadata: JsonRecord;
  kind: string;
  representation: 'decoded-json';
  body: JsonRecord;
};

type PreparedRawInput = {
  artifactId: string;
  metadata: JsonRecord;
  kind: string;
  representation: 'raw';
  bytes: Uint8Array;
};

type PreparedInput = PreparedDecodedInput | PreparedRawInput;

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function exactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function artifactMetadata(
  artifactId: string,
  value: unknown,
): { metadata: JsonRecord; kind: string } {
  const metadata = record(value);
  if (
    metadata.artifactId !== artifactId ||
    typeof metadata.schemaId !== 'string' ||
    !metadata.schemaId ||
    typeof metadata.rawHash !== 'string' ||
    !SHA256_PATTERN.test(metadata.rawHash) ||
    !Number.isSafeInteger(metadata.sizeBytes) ||
    Number(metadata.sizeBytes) < 0
  ) {
    throw Object.assign(
      new Error(`Issued Artifact ${artifactId} returned invalid immutable metadata.`),
      {
        code: 'E_OPERATE_PACKET_INPUT_REPRESENTATION_INVALID',
        context: { artifactId },
      },
    );
  }
  return { metadata, kind: String(metadata.schemaId) };
}

function decodedInput(artifactId: string, value: unknown): PreparedDecodedInput {
  const artifact = record(value);
  const { metadata, kind: schemaId } = artifactMetadata(artifactId, artifact.metadata);
  const body = record(artifact.contentJson);
  if (
    !exactKeys(artifact, ['contentJson', 'metadata', 'representation']) ||
    artifact.representation !== 'decoded-json' ||
    Object.keys(body).length === 0 ||
    metadata.mediaType !== 'application/json' ||
    metadata.encoding !== 'utf-8' ||
    typeof metadata.canonicalHash !== 'string' ||
    !SHA256_PATTERN.test(metadata.canonicalHash) ||
    sha256Jcs(body as never) !== metadata.canonicalHash
  ) {
    throw Object.assign(
      new Error(`Issued Artifact ${artifactId} did not return one decoded JSON object.`),
      {
        code: 'E_OPERATE_PACKET_INPUT_REPRESENTATION_INVALID',
        context: { artifactId, representation: artifact.representation ?? null },
      },
    );
  }
  return {
    artifactId,
    metadata,
    kind: String(body.kind ?? schemaId),
    representation: 'decoded-json',
    body,
  };
}

function rawInput(artifactId: string, value: unknown): PreparedRawInput {
  const artifact = record(value);
  const { metadata, kind } = artifactMetadata(artifactId, artifact.metadata);
  if (
    !exactKeys(artifact, ['contentBase64', 'metadata', 'representation']) ||
    artifact.representation !== 'raw' ||
    typeof artifact.contentBase64 !== 'string' ||
    !BASE64_PATTERN.test(artifact.contentBase64)
  ) {
    throw Object.assign(
      new Error(`Issued Artifact ${artifactId} did not return one exact raw representation.`),
      {
        code: 'E_OPERATE_PACKET_INPUT_REPRESENTATION_INVALID',
        context: { artifactId, representation: artifact.representation ?? null },
      },
    );
  }
  const bytes = Buffer.from(artifact.contentBase64, 'base64');
  const rawHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (
    bytes.toString('base64') !== artifact.contentBase64 ||
    bytes.length !== metadata.sizeBytes ||
    rawHash !== metadata.rawHash
  ) {
    throw Object.assign(
      new Error(`Issued Artifact ${artifactId} raw bytes differ from immutable metadata.`),
      {
        code: 'E_OPERATE_PACKET_INPUT_REPRESENTATION_INVALID',
        context: { artifactId },
      },
    );
  }
  return { artifactId, metadata, kind, representation: 'raw', bytes };
}

function orderedResultInputArtifacts(inputs: PreparedInput[], assignment: JsonRecord) {
  const decodedInputs = inputs.filter(
    (input): input is Extract<PreparedInput, { representation: 'decoded-json' }> =>
      input.representation === 'decoded-json',
  );
  const challenger = decodedInputs.find(
    ({ kind, body }) =>
      kind === 'operating-challenger-review' && body.kind === 'operating-challenger-review',
  );
  const advisorArtifactOrder = new Map<string, number>(
    ((challenger?.body.advisorArtifactIds as string[] | undefined) ?? []).map(
      (artifactId, index) => [artifactId, index],
    ),
  );
  const context = record(assignment.intelligenceContext);
  const domain = OPEN_REFERENCE_OPERATE_EXTENSIONS_V2.domains.find(
    ({ domainId, domainVersion }) =>
      domainId === context.domainId && domainVersion === context.domainVersion,
  );
  const roleOrder = new Map<string, number>(
    (domain?.roles ?? [])
      .filter(({ roleKind }) => roleKind === 'advisor')
      .map(({ roleId }, index) => [roleId, index]),
  );
  return decodedInputs
    .map((input, index) => ({
      input,
      index,
      order:
        input.kind === 'operating-advisor-result'
          ? (advisorArtifactOrder.get(input.artifactId) ??
            roleOrder.get(String(input.body.roleId)) ??
            Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return left.index - right.index;
    })
    .map(({ input: { artifactId, kind: schemaId, body: value } }) => ({
      artifactId,
      schemaId,
      value,
    }));
}

function qualityErrors(
  packet: OperateAssignmentPacket,
  content: JsonRecord,
): PacketValidationFailure[] {
  const errors: PacketValidationFailure[] = [];
  const exact = [
    ['assignmentId', packet.assignmentId],
    ['protocolVersion', packet.protocolVersion],
    ['roleId', packet.roleId],
    ['roleVersion', packet.roleVersion],
    ['intelligencePlanId', packet.intelligencePlanId],
    ['snapshotId', packet.snapshotId],
    ['scopeId', packet.scope.scopeId],
    ['domainId', packet.scope.domainId],
    ['domainVersion', packet.scope.domainVersion],
  ] as const;
  for (const [field, expected] of exact) {
    if (content[field] !== expected) {
      errors.push({
        pointer: `/${field}`,
        rule: 'exact-packet-binding',
        message: `Expected the exact packet ${field} ${expected}.`,
      });
    }
  }
  if (content.kind !== packet.contractKind) {
    errors.push({
      pointer: '/kind',
      rule: 'exact-result-contract',
      message: `Expected ${packet.contractKind}.`,
    });
  }
  if (!sameJson(content.analysisProfile, packet.analysisProfile)) {
    errors.push({
      pointer: '/analysisProfile',
      rule: 'exact-analysis-profile',
      message: 'Expected the exact registry-owned Assignment analysisProfile.',
    });
  }
  if (
    packet.contractKind !== 'operating-decision-ledger' &&
    !sameJson(content.inputAbsenceIds, packet.inputAbsenceIds)
  ) {
    errors.push({
      pointer: '/inputAbsenceIds',
      rule: 'exact-input-absences',
      message: 'Expected the exact ordered Assignment input absence identities.',
    });
  }
  return errors;
}

function preflightIssuePointer(issue: {
  path: string;
  message: string;
  context: Readonly<Record<string, unknown>>;
}): string {
  const base = issue.path || '/';
  if (issue.context.rule !== 'required') return base;
  const missing = issue.message.match(/^missing required property '([^']+)'$/u)?.[1];
  if (!missing) return base;
  const segment = missing.replaceAll('~', '~0').replaceAll('/', '~1');
  return `${base === '/' ? '' : base}/${segment}`;
}

export class OperateAssignmentPacketService {
  constructor(
    private readonly projectDir: string,
    private readonly clientFactory: (projectDir: string) => OperateClient = createOperateClient,
    private readonly hooks: {
      afterReceiptBackup?: () => Promise<void>;
      afterReceiptPromote?: () => Promise<void>;
    } = {},
  ) {}

  private async assertPacketCustody(target: string, requireDirectory = false): Promise<void> {
    await assertOperatePathCustody(this.projectDir, target, {
      code: 'E_OPERATE_PACKET_CORRUPT',
      message:
        'Prepared packet custody cannot traverse symbolic links or leave project-local .planr.',
      requireDirectory,
    });
  }

  private async packetsRoot(): Promise<string> {
    const root = await ensureOperateStorageLayout(this.projectDir);
    const packets = path.join(root, 'packets');
    await this.assertPacketCustody(packets, true);
    await assertOperateTreeCustody(this.projectDir, packets, {
      code: 'E_OPERATE_PACKET_CORRUPT',
      message: 'Prepared packet custody cannot contain symbolic links or special entries.',
      requireDirectory: true,
    });
    await this.recoverInterruptedReceiptSwaps(packets);
    return packets;
  }

  private async recoverInterruptedReceiptSwaps(root: string): Promise<void> {
    const entries = await readdir(root, { withFileTypes: true });
    const groups = new Map<
      string,
      { stage: string | null; backup: string | null; nonce: string | null }
    >();
    for (const entry of entries) {
      const match = entry.name.match(RECEIPT_SWAP_PATTERN);
      if (!match) continue;
      if (!entry.isDirectory()) {
        throw Object.assign(new Error('Interrupted packet receipt custody is not a directory.'), {
          code: 'E_OPERATE_PACKET_CORRUPT',
        });
      }
      const [, packetId, kind, nonce] = match;
      await this.assertPacketCustody(path.join(root, entry.name), true);
      const group = groups.get(packetId) ?? { stage: null, backup: null, nonce: null };
      if ((group.nonce && group.nonce !== nonce) || group[kind as 'stage' | 'backup']) {
        throw Object.assign(
          new Error('Ambiguous interrupted packet receipt custody requires recovery.'),
          {
            code: 'E_OPERATE_PACKET_CORRUPT',
            context: { packetId },
          },
        );
      }
      group[kind as 'stage' | 'backup'] = path.join(root, entry.name);
      group.nonce = nonce;
      groups.set(packetId, group);
    }
    for (const [packetId, group] of groups) {
      const canonical = path.join(root, packetId);
      await this.assertPacketCustody(canonical);
      const canonicalExists = await pathExists(canonical);
      const canonicalIsReceipt = canonicalExists && (await receiptAt(canonical, packetId));
      if (canonicalIsReceipt) {
        if (group.stage) await rm(group.stage, { recursive: true, force: true });
        if (group.backup) await rm(group.backup, { recursive: true, force: true });
        continue;
      }
      if (group.stage) {
        if (!(await receiptAt(group.stage, packetId))) {
          throw Object.assign(new Error('Interrupted receipt staging is not a verified receipt.'), {
            code: 'E_OPERATE_PACKET_CORRUPT',
            context: { packetId },
          });
        }
        const backup =
          group.backup ?? path.join(root, `.${packetId}.receipt-backup-${group.nonce}`);
        if (canonicalExists && !group.backup) await rename(canonical, backup);
        await rename(group.stage, canonical);
        if (await pathExists(backup)) await rm(backup, { recursive: true, force: true });
        continue;
      }
      if (group.backup && !canonicalExists) {
        await rename(group.backup, canonical);
        continue;
      }
      throw Object.assign(new Error('Interrupted packet receipt custody is inconsistent.'), {
        code: 'E_OPERATE_PACKET_CORRUPT',
        context: { packetId },
      });
    }
  }

  private async packet(
    packetId: string,
  ): Promise<{ root: string; value: OperateAssignmentPacket }> {
    const root = path.join(await this.packetsRoot(), safePacketId(packetId));
    await this.assertPacketCustody(root, true);
    const value = assertClosedPacket(await readJson(path.join(root, 'packet.json')), packetId);
    await assertPacketInventories(root, value);
    return { root, value };
  }

  private assertSameCustody(
    packet: OperateAssignmentPacket,
    input: {
      assignmentId: string;
      submissionId: string;
      actor: OperateActorV2;
      contractKind: PacketContractKind;
      identity: ReturnType<typeof exactIdentity>;
    },
  ): void {
    if (
      packet.assignmentId !== input.assignmentId ||
      packet.submissionId !== input.submissionId ||
      !sameJson(packet.actor, input.actor) ||
      packet.contractKind !== input.contractKind ||
      packet.cycleId !== input.identity.cycleId ||
      packet.roleId !== input.identity.roleId ||
      packet.roleVersion !== input.identity.roleVersion ||
      !sameJson(packet.analysisProfile, input.identity.analysisProfile) ||
      packet.intelligencePlanId !== input.identity.intelligencePlanId ||
      packet.snapshotId !== input.identity.snapshotId ||
      !sameJson(packet.scope, input.identity.scope) ||
      !sameJson(packet.inputArtifactIds, input.identity.inputArtifactIds) ||
      !sameJson(packet.inputAbsenceIds, input.identity.inputAbsenceIds) ||
      !sameJson(packet.outputContract, input.identity.outputContract)
    ) {
      throw Object.assign(
        new Error('The idempotent packet identity is bound to different custody.'),
        {
          code: 'E_OPERATE_PACKET_CONFLICT',
        },
      );
    }
  }

  async prepare(input: { assignmentId: string; actorId: string; runtime: string }): Promise<{
    packet: OperateAssignmentPacket;
    directory: string;
    resultPath: string;
    templatePath: string;
    assignmentPath: string;
    rubricPath: string;
    schemaCatalogPath: string;
    evidenceMatrixPath: string;
    replayed: boolean;
  }> {
    const actor = { actorId: input.actorId, kind: 'agent' as const, runtime: input.runtime };
    const client = this.clientFactory(this.projectDir);
    const claimed = await client.dispatch({
      operation: 'operate.assignment.claim',
      request: { assignmentId: input.assignmentId, actor },
    });
    if (!claimed.ok) {
      throw Object.assign(new Error(claimed.error.message), {
        code: claimed.error.code,
        context: claimed.error.context,
      });
    }
    const claim = record(claimed.data);
    const assignment = record(claim.assignment);
    const submissionId = String(claim.submissionId ?? '');
    if (assignment.assignmentId !== input.assignmentId || !submissionId) {
      throw Object.assign(new Error('The runtime returned an invalid exact Assignment claim.'), {
        code: 'E_OPERATE_PACKET_ASSIGNMENT_INVALID',
      });
    }
    const kind = contractKind(assignment);
    const identity = exactIdentity(assignment);
    if (
      identity.outputContract.schemaId !== kind ||
      identity.outputContract.schemaVersion !== PROTOCOL_VERSION
    ) {
      throw Object.assign(
        new Error('The Assignment output contract does not match its role kind.'),
        {
          code: 'E_OPERATE_PACKET_ASSIGNMENT_INVALID',
        },
      );
    }
    const packetId = stablePacketId(input.assignmentId, submissionId, actor);
    const packetsRoot = await this.packetsRoot();
    const destination = path.join(packetsRoot, packetId);
    await this.assertPacketCustody(destination);
    try {
      const existing = await this.packet(packetId);
      this.assertSameCustody(existing.value, {
        assignmentId: input.assignmentId,
        submissionId,
        actor,
        contractKind: kind,
        identity,
      });
      return {
        packet: existing.value,
        directory: existing.root,
        resultPath: path.join(existing.root, 'result.json'),
        templatePath: path.join(existing.root, 'result-template.json'),
        assignmentPath: path.join(existing.root, 'assignment.json'),
        rubricPath: path.join(existing.root, 'rubric.json'),
        schemaCatalogPath: path.join(existing.root, 'schema-catalog.json'),
        evidenceMatrixPath: path.join(existing.root, 'evidence-matrix.json'),
        replayed: true,
      };
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException & { code?: string }).code !== 'ENOENT' &&
        (error as { code?: string }).code !== 'E_OPERATE_PACKET_CORRUPT'
      )
        throw error;
      try {
        await stat(destination);
        throw error;
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
      }
    }

    const packet: OperateAssignmentPacket = Object.freeze({
      kind: PACKET_FORMAT,
      schemaVersion: PACKET_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      packetId,
      assignmentId: input.assignmentId,
      cycleId: identity.cycleId,
      submissionId,
      actor,
      contractKind: kind,
      roleId: identity.roleId,
      roleVersion: identity.roleVersion,
      analysisProfile: identity.analysisProfile,
      intelligencePlanId: identity.intelligencePlanId,
      snapshotId: identity.snapshotId,
      scope: identity.scope,
      inputArtifactIds: identity.inputArtifactIds,
      inputAbsenceIds: identity.inputAbsenceIds,
      outputContract: identity.outputContract,
      createdAt: new Date().toISOString(),
    });
    const staging = path.join(packetsRoot, `.${packetId}.${randomUUID()}.tmp`);
    await this.assertPacketCustody(staging);
    await Promise.all([
      mkdir(path.join(staging, 'inputs'), { recursive: true, mode: 0o700 }),
      mkdir(path.join(staging, 'schemas'), { recursive: true, mode: 0o700 }),
    ]);
    await this.assertPacketCustody(staging, true);
    try {
      const inputs: PreparedInput[] = [];
      for (const artifactId of Array.isArray(assignment.inputArtifactIds)
        ? assignment.inputArtifactIds.map(String)
        : []) {
        const decoded = await client.dispatch({
          operation: 'operate.artifact.get',
          request: {
            artifactId,
            representation: 'decoded-json',
            actor,
            scope: identity.scope,
            assignmentId: input.assignmentId,
          },
        });
        if (decoded.ok) {
          const prepared = decodedInput(artifactId, decoded.data);
          await writeJson(path.join(staging, 'inputs', `${artifactId}.json`), prepared.body);
          inputs.push(prepared);
          continue;
        }
        if (decoded.error.code !== 'RESULT_CONTRACT_INVALID') {
          throw Object.assign(new Error(decoded.error.message), {
            code: decoded.error.code,
            context: decoded.error.context,
          });
        }
        const raw = await client.dispatch({
          operation: 'operate.artifact.get',
          request: {
            artifactId,
            representation: 'raw',
            actor,
            scope: identity.scope,
            assignmentId: input.assignmentId,
          },
        });
        if (!raw.ok) {
          throw Object.assign(new Error(raw.error.message), {
            code: raw.error.code,
            context: raw.error.context,
          });
        }
        const prepared = rawInput(artifactId, raw.data);
        await atomicWrite(path.join(staging, 'inputs', `${artifactId}.bin`), prepared.bytes);
        inputs.push(prepared);
      }
      const schemas = operatingResultSchemaDependenciesV2(kind);
      const rootSchema = schemas.find((entry) => entry.kind === kind);
      if (!rootSchema) {
        throw Object.assign(new Error('The Assignment result schema bundle has no root schema.'), {
          code: 'E_OPERATE_PACKET_ASSIGNMENT_INVALID',
        });
      }
      for (const schema of schemas) {
        await writeJson(path.join(staging, 'schemas', schema.fileName), schema.schema);
      }
      const template = createOperatingResultTemplateV2({
        assignment: assignment as unknown as OperatingIntelligenceAssignmentV2,
        inputArtifacts: orderedResultInputArtifacts(inputs, assignment),
      });
      await Promise.all([
        writeJson(path.join(staging, 'packet.json'), packet),
        writeJson(path.join(staging, 'assignment.json'), assignment),
        writeJson(path.join(staging, 'rubric.json'), assignment.analysisRubric ?? {}),
        writeJson(path.join(staging, 'result-schema.json'), rootSchema.schema),
        writeJson(path.join(staging, 'schema-catalog.json'), {
          kind: 'openplanr-operate-schema-catalog',
          schemaVersion: '1.0.0',
          protocolVersion: PROTOCOL_VERSION,
          pathMode: 'packet-relative',
          schemaRoot: 'schemas',
          root: { kind, fileName: rootSchema.fileName },
          schemas: schemas.map(({ kind: schemaKind, fileName }) => ({
            kind: schemaKind,
            fileName,
            schemaPath: path.posix.join('schemas', fileName),
          })),
        }),
        writeJson(path.join(staging, 'result-template.json'), template),
        writeJson(path.join(staging, 'result.json'), template),
        writeJson(path.join(staging, 'evidence-matrix.json'), {
          assignmentId: input.assignmentId,
          pathMode: 'packet-relative',
          packetRoot: '.',
          inputs: inputs.map(({ artifactId, metadata, kind: inputKind, representation }) => ({
            artifactId,
            metadata,
            kind: inputKind,
            representation,
            contentPath: path.posix.join(
              'inputs',
              `${artifactId}.${representation === 'decoded-json' ? 'json' : 'bin'}`,
            ),
          })),
          absences: assignment.inputAbsences ?? [],
        }),
      ]);
      try {
        await rename(staging, destination);
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(String((error as NodeJS.ErrnoException).code))) {
          throw error;
        }
        const existing = await this.packet(packetId);
        this.assertSameCustody(existing.value, {
          assignmentId: input.assignmentId,
          submissionId,
          actor,
          contractKind: kind,
          identity,
        });
        await rm(staging, { recursive: true, force: true });
        return {
          packet: existing.value,
          directory: existing.root,
          resultPath: path.join(existing.root, 'result.json'),
          templatePath: path.join(existing.root, 'result-template.json'),
          assignmentPath: path.join(existing.root, 'assignment.json'),
          rubricPath: path.join(existing.root, 'rubric.json'),
          schemaCatalogPath: path.join(existing.root, 'schema-catalog.json'),
          evidenceMatrixPath: path.join(existing.root, 'evidence-matrix.json'),
          replayed: true,
        };
      }
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
    const verified = await this.packet(packetId);
    return {
      packet: verified.value,
      directory: verified.root,
      resultPath: path.join(verified.root, 'result.json'),
      templatePath: path.join(verified.root, 'result-template.json'),
      assignmentPath: path.join(verified.root, 'assignment.json'),
      rubricPath: path.join(verified.root, 'rubric.json'),
      schemaCatalogPath: path.join(verified.root, 'schema-catalog.json'),
      evidenceMatrixPath: path.join(verified.root, 'evidence-matrix.json'),
      replayed: false,
    };
  }

  async validate(
    packetId: string,
    bytes: Uint8Array,
  ): Promise<{
    ok: boolean;
    packetId: string;
    contractKind: PacketContractKind;
    errors: PacketValidationFailure[];
  }> {
    const { value } = await this.packet(packetId);
    let content: unknown;
    try {
      content = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch {
      return {
        ok: false,
        packetId,
        contractKind: value.contractKind,
        errors: [
          { pointer: '/', rule: 'utf8-json', message: 'Content must be verified UTF-8 JSON.' },
        ],
      };
    }
    const object = record(content);
    const preflight = await this.clientFactory(this.projectDir).preflightAssignmentResult(
      value.assignmentId,
      bytes,
    );
    const errors = [
      ...preflight.issues.map((issue) => ({
        pointer: preflightIssuePointer(issue),
        rule: issue.code,
        message: issue.message,
      })),
      ...qualityErrors(value, object),
    ];
    return { ok: errors.length === 0, packetId, contractKind: value.contractKind, errors };
  }

  async submit(packetId: string, bytes: Uint8Array): Promise<JsonRecord> {
    const prepared = await this.packet(packetId);
    const validation = await this.validate(packetId, bytes);
    if (!validation.ok) {
      throw Object.assign(
        new Error('Prepared result failed schema or packet-quality validation.'),
        {
          code: 'E_OPERATE_PACKET_VALIDATION',
          errors: validation.errors,
        },
      );
    }
    const client = this.clientFactory(this.projectDir);
    const result = await client.dispatch({
      operation: 'operate.assignment.submit',
      request: {
        assignmentId: prepared.value.assignmentId,
        submissionId: prepared.value.submissionId,
        actor: prepared.value.actor,
        mediaType: 'application/json',
        encoding: 'utf-8',
        contentBase64: Buffer.from(bytes).toString('base64'),
      },
    });
    if (!result.ok) {
      throw Object.assign(new Error(result.error.message), {
        code: result.error.code,
        context: result.error.context,
      });
    }
    const receipt = {
      kind: RECEIPT_KIND,
      schemaVersion: '1.0.0',
      protocolVersion: PROTOCOL_VERSION,
      packetId,
      assignmentId: prepared.value.assignmentId,
      submissionId: prepared.value.submissionId,
      contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      accepted: result.data,
    };
    const nonce = randomUUID();
    const stage = path.join(path.dirname(prepared.root), `.${packetId}.receipt-stage-${nonce}`);
    const backup = path.join(path.dirname(prepared.root), `.${packetId}.receipt-backup-${nonce}`);
    await this.assertPacketCustody(stage);
    await this.assertPacketCustody(backup);
    await mkdir(stage, { recursive: false, mode: 0o700 });
    await this.assertPacketCustody(stage, true);
    await writeJson(path.join(stage, 'receipt.json'), receipt);
    const stagedReceipt = await readJson(path.join(stage, 'receipt.json'));
    assertReceipt(stagedReceipt, packetId);
    if (!sameJson(stagedReceipt, receipt)) {
      await rm(stage, { recursive: true, force: true });
      throw Object.assign(new Error('The staged packet receipt changed before promotion.'), {
        code: 'E_OPERATE_PACKET_CORRUPT',
      });
    }
    let backedUp = false;
    let promoted = false;
    try {
      await rename(prepared.root, backup);
      backedUp = true;
      await this.hooks.afterReceiptBackup?.();
      await rename(stage, prepared.root);
      promoted = true;
      await this.hooks.afterReceiptPromote?.();
      await rm(backup, { recursive: true, force: true });
    } catch (error) {
      if (promoted && (await receiptAt(prepared.root, packetId))) {
        if (await pathExists(backup)) await rm(backup, { recursive: true, force: true });
        if (await pathExists(stage)) await rm(stage, { recursive: true, force: true });
        return receipt;
      }
      if (backedUp && !(await pathExists(prepared.root)) && (await pathExists(backup))) {
        await rename(backup, prepared.root);
      }
      if (await pathExists(stage)) await rm(stage, { recursive: true, force: true });
      throw error;
    }
    return receipt;
  }

  async recoverAbandoned(options: { olderThanMs: number; now?: number }): Promise<string[]> {
    const root = await this.packetsRoot();
    const entries = await readdir(root, { withFileTypes: true });
    const client = this.clientFactory(this.projectDir);
    const removed: string[] = [];
    for (const entry of entries) {
      if (!PACKET_ID_PATTERN.test(entry.name)) continue;
      if (!entry.isDirectory()) {
        throw Object.assign(
          new Error('Prepared packet custody contains a non-directory packet entry.'),
          {
            code: 'E_OPERATE_PACKET_CORRUPT',
            context: { packetId: entry.name },
          },
        );
      }
      const packetRoot = path.join(root, entry.name);
      await this.assertPacketCustody(packetRoot, true);
      try {
        await stat(path.join(packetRoot, 'receipt.json'));
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const packet = assertClosedPacket(
        await readJson(path.join(packetRoot, 'packet.json')),
        entry.name,
      );
      const age = (options.now ?? Date.now()) - Date.parse(packet.createdAt);
      if (!Number.isFinite(age) || age < options.olderThanMs) continue;
      const assignmentState = await client.readAssignmentState(packet.assignmentId, packet.cycleId);
      if (!['abandoned', 'failed', 'rejected'].includes(assignmentState ?? '')) continue;
      await rm(packetRoot, { recursive: true, force: true });
      removed.push(entry.name);
    }
    return removed;
  }
}

export function createOperateAssignmentPacketService(
  projectDir: string,
): OperateAssignmentPacketService {
  return new OperateAssignmentPacketService(projectDir);
}
