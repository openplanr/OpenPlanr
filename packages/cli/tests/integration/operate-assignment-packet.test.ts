import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/operate/client.js', () => ({
  createOperateClient: vi.fn(() => {
    throw new Error('The test must inject an exact packet client.');
  }),
}));

import { OperateAssignmentPacketService } from '../../src/services/operate/assignment-packet-service.js';

const assignment = Object.freeze({
  kind: 'operating-assignment',
  schemaVersion: '1.0.0',
  protocolVersion: '2.0.0',
  assignmentId: 'asg_packet_0001',
  cycleId: 'cyc_packet_0001',
  assignmentKind: 'advisor',
  roleId: 'ceo',
  roleVersion: '2.0.0',
  analysisProfile: {
    id: 'strategy-finance',
    version: '1.0.0',
    questionIds: ['strategic-direction'],
  },
  analysisRubric: { requiredQuestions: ['What changed?'] },
  inputArtifactIds: ['art_bundle_0001'],
  inputAbsences: [],
  intelligenceContext: {
    intelligencePlanId: 'ipl_packet_0001',
    snapshotId: 'snp_packet_0001',
    scopeId: 'scope-packet',
    domainId: 'business',
    domainVersion: '1.0.0',
    sourceArtifactId: 'art_source_0001',
    evidenceRefIds: ['evr_snapshot_unissued_0001'],
    inputBundle: {
      issuedEvidence: [{ evidenceRefId: 'evr_packet_0001' }],
    },
  },
  outputContract: {
    schemaId: 'operating-advisor-result',
    schemaVersion: '2.0.0',
    mediaType: 'application/json',
    encoding: 'utf-8',
  },
});

const inputBundle = Object.freeze({
  kind: 'operating-intelligence-input-bundle',
  protocolVersion: '2.0.0',
});
const inputBundleBytes = Buffer.from(JSON.stringify(inputBundle), 'utf8');
const inputBundleMetadata = Object.freeze({
  artifactId: 'art_bundle_0001',
  schemaId: 'operating-intelligence-input-bundle',
  mediaType: 'application/json',
  encoding: 'utf-8',
  sizeBytes: inputBundleBytes.length,
  rawHash: `sha256:${createHash('sha256').update(inputBundleBytes).digest('hex')}`,
  canonicalHash: sha256Jcs(inputBundle),
});

function fakeClient(state: { assignmentState: string }) {
  return {
    dispatch: vi.fn(async (input: { operation: string }) => {
      if (input.operation === 'operate.assignment.claim') {
        return {
          ok: true,
          data: { assignment: structuredClone(assignment), submissionId: 'sub_packet_0001' },
        };
      }
      if (input.operation === 'operate.artifact.get') {
        return {
          ok: true,
          data: {
            metadata: inputBundleMetadata,
            representation: 'decoded-json',
            contentJson: inputBundle,
          },
        };
      }
      if (input.operation === 'operate.assignment.submit') {
        return { ok: true, data: { replayed: false, accepted: true } };
      }
      return { ok: false, error: { code: 'UNEXPECTED', message: input.operation } };
    }),
    readAssignmentState: vi.fn(async () => state.assignmentState),
    preflightAssignmentResult: vi.fn(async (assignmentId: string) => ({
      valid: true,
      assignmentId,
      schemaId: 'operating-advisor-result',
      issues: [],
    })),
  };
}

function rawEvidenceClient(
  state: { assignmentState: string },
  options: { contentBase64?: string; rawHash?: string } = {},
) {
  const rawBytes = Buffer.from('{"name":"packet-evidence","private":true}\n', 'utf8');
  const metadata = {
    artifactId: 'art_bundle_0001',
    schemaId: 'operating-evidence-snapshot',
    mediaType: 'application/octet-stream',
    encoding: 'binary',
    sizeBytes: rawBytes.length,
    rawHash: options.rawHash ?? `sha256:${createHash('sha256').update(rawBytes).digest('hex')}`,
    canonicalHash: null,
  };
  return {
    rawBytes,
    client: {
      dispatch: vi.fn(
        async (input: { operation: string; request?: { representation?: string } }) => {
          if (input.operation === 'operate.assignment.claim') {
            return {
              ok: true,
              data: { assignment: structuredClone(assignment), submissionId: 'sub_packet_0001' },
            };
          }
          if (input.operation === 'operate.artifact.get') {
            if (input.request?.representation === 'decoded-json') {
              return {
                ok: false,
                error: {
                  code: 'RESULT_CONTRACT_INVALID',
                  message: 'decoded-json requires a canonical UTF-8 JSON Artifact.',
                  context: { artifactId: 'art_bundle_0001' },
                },
              };
            }
            return {
              ok: true,
              data: {
                metadata,
                representation: 'raw',
                contentBase64: options.contentBase64 ?? rawBytes.toString('base64'),
              },
            };
          }
          if (input.operation === 'operate.assignment.submit') {
            return { ok: true, data: { replayed: false, accepted: true } };
          }
          return { ok: false, error: { code: 'UNEXPECTED', message: input.operation } };
        },
      ),
      readAssignmentState: vi.fn(async () => state.assignmentState),
      preflightAssignmentResult: vi.fn(async (assignmentId: string) => ({
        valid: true,
        assignmentId,
        schemaId: 'operating-advisor-result',
        issues: [],
      })),
    },
  };
}

async function serviceFixture(
  state = { assignmentState: 'claimed' },
  hooks: ConstructorParameters<typeof OperateAssignmentPacketService>[2] = {},
) {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'openplanr-packet-'));
  const client = fakeClient(state);
  const service = new OperateAssignmentPacketService(projectDir, (() => client) as never, hooks);
  return { projectDir, client, service, state };
}

describe('Operate prepared assignment packets', () => {
  it('rejects a symlinked packets root before writing any issued input', async () => {
    const { projectDir, service } = await serviceFixture();
    const operateRoot = path.join(projectDir, '.planr', 'operate');
    const external = path.join(projectDir, 'external-packets');
    await Promise.all([
      mkdir(path.join(operateRoot, 'state'), { recursive: true }),
      mkdir(path.join(operateRoot, 'projections'), { recursive: true }),
      mkdir(path.join(operateRoot, 'archive'), { recursive: true }),
      mkdir(external, { recursive: true }),
    ]);
    await symlink(external, path.join(operateRoot, 'packets'));

    await expect(
      service.prepare({
        assignmentId: assignment.assignmentId,
        actorId: 'agent-ceo',
        runtime: 'codex',
      }),
    ).rejects.toMatchObject({ code: 'OPERATE_STORE_INCOMPATIBLE' });
    expect(await readdir(external)).toEqual([]);
  });

  it('prepares one exact packet idempotently under concurrent calls', async () => {
    const { service } = await serviceFixture();
    const [left, right] = await Promise.all([
      service.prepare({
        assignmentId: assignment.assignmentId,
        actorId: 'agent-ceo',
        runtime: 'codex',
      }),
      service.prepare({
        assignmentId: assignment.assignmentId,
        actorId: 'agent-ceo',
        runtime: 'codex',
      }),
    ]);

    expect(left.packet.packetId).toBe(right.packet.packetId);
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    expect(JSON.parse(await readFile(path.join(left.directory, 'rubric.json'), 'utf8'))).toEqual(
      assignment.analysisRubric,
    );
    expect(
      JSON.parse(await readFile(path.join(left.directory, 'result-template.json'), 'utf8')),
    ).toMatchObject({
      assignmentId: assignment.assignmentId,
      roleId: assignment.roleId,
      roleVersion: assignment.roleVersion,
      analysisProfile: assignment.analysisProfile,
      intelligencePlanId: assignment.intelligenceContext.intelligencePlanId,
      snapshotId: assignment.intelligenceContext.snapshotId,
      inputAbsenceIds: [],
      analysis: { profileId: 'strategy-finance' },
    });
    const catalog = JSON.parse(
      await readFile(path.join(left.directory, 'schema-catalog.json'), 'utf8'),
    ) as { schemas: Array<{ fileName: string }> };
    expect(catalog.schemas.map((entry) => entry.fileName)).toContain(
      'operating-advisor-result.schema.json',
    );
    expect(
      JSON.parse(
        await readFile(path.join(left.directory, 'inputs', 'art_bundle_0001.json'), 'utf8'),
      ),
    ).toEqual({
      kind: 'operating-intelligence-input-bundle',
      protocolVersion: '2.0.0',
    });
    const evidenceMatrix = JSON.parse(
      await readFile(path.join(left.directory, 'evidence-matrix.json'), 'utf8'),
    ) as {
      pathMode: string;
      packetRoot: string;
      inputs: Array<{ contentPath: string; representation: string }>;
    };
    expect(evidenceMatrix).toMatchObject({
      pathMode: 'packet-relative',
      packetRoot: '.',
      inputs: [{ contentPath: 'inputs/art_bundle_0001.json', representation: 'decoded-json' }],
    });
    const schemaCatalog = JSON.parse(
      await readFile(path.join(left.directory, 'schema-catalog.json'), 'utf8'),
    ) as {
      pathMode: string;
      schemaRoot: string;
      schemas: Array<{ fileName: string; schemaPath: string }>;
    };
    expect(schemaCatalog).toMatchObject({ pathMode: 'packet-relative', schemaRoot: 'schemas' });
    for (const schema of schemaCatalog.schemas) {
      expect(schema.schemaPath).toBe(`schemas/${schema.fileName}`);
    }
    const template = JSON.parse(
      await readFile(path.join(left.directory, 'result-template.json'), 'utf8'),
    ) as {
      summary: string;
      analysis: { executiveQuestionAnswers: Array<{ evidenceRefIds: string[] }> };
    };
    expect(template.summary).toBe('');
    expect(template.analysis.executiveQuestionAnswers[0].evidenceRefIds).toEqual([]);
    expect(JSON.stringify(template)).not.toContain('evr_snapshot_unissued_0001');
    expect((await stat(path.join(left.directory, 'inputs'))).mode & 0o777).toBe(0o700);
  });

  it('falls back to verified raw bytes and binds their exact packet-relative path', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'openplanr-packet-raw-'));
    const state = { assignmentState: 'claimed' };
    const { client, rawBytes } = rawEvidenceClient(state);
    const service = new OperateAssignmentPacketService(projectDir, (() => client) as never);

    const prepared = await service.prepare({
      assignmentId: assignment.assignmentId,
      actorId: 'agent-ceo',
      runtime: 'codex',
    });
    const matrix = JSON.parse(await readFile(prepared.evidenceMatrixPath, 'utf8')) as {
      inputs: Array<{ artifactId: string; contentPath: string; representation: string }>;
    };
    expect(matrix.inputs).toEqual([
      expect.objectContaining({
        artifactId: 'art_bundle_0001',
        contentPath: 'inputs/art_bundle_0001.bin',
        representation: 'raw',
      }),
    ]);
    expect(await readFile(path.join(prepared.directory, matrix.inputs[0].contentPath))).toEqual(
      rawBytes,
    );
    expect(
      (await stat(path.join(prepared.directory, matrix.inputs[0].contentPath))).mode & 0o777,
    ).toBe(0o600);
    expect(client.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'operate.artifact.get',
        request: expect.objectContaining({ representation: 'raw' }),
      }),
    );

    await writeFile(path.join(prepared.directory, matrix.inputs[0].contentPath), 'changed', {
      mode: 0o600,
    });
    await expect(
      service.validate(prepared.packet.packetId, Buffer.from('{}')),
    ).rejects.toMatchObject({ code: 'E_OPERATE_PACKET_CORRUPT' });
  });

  it('rejects malformed or hash-mismatched raw evidence before packet promotion', async () => {
    for (const options of [{ contentBase64: 'YWJj=' }, { rawHash: `sha256:${'f'.repeat(64)}` }]) {
      const projectDir = await mkdtemp(path.join(os.tmpdir(), 'openplanr-packet-raw-invalid-'));
      const { client } = rawEvidenceClient({ assignmentState: 'claimed' }, options);
      const service = new OperateAssignmentPacketService(projectDir, (() => client) as never);
      await expect(
        service.prepare({
          assignmentId: assignment.assignmentId,
          actorId: 'agent-ceo',
          runtime: 'codex',
        }),
      ).rejects.toMatchObject({ code: 'E_OPERATE_PACKET_INPUT_REPRESENTATION_INVALID' });
      const packets = path.join(projectDir, '.planr', 'operate', 'packets');
      expect((await readdir(packets)).filter((entry) => entry.startsWith('pkt_'))).toEqual([]);
    }
  });

  it('fails closed when packet.json contains a foreign field', async () => {
    const { service } = await serviceFixture();
    const prepared = await service.prepare({
      assignmentId: assignment.assignmentId,
      actorId: 'agent-ceo',
      runtime: 'codex',
    });
    const target = path.join(prepared.directory, 'packet.json');
    const packet = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>;
    await writeFile(target, `${JSON.stringify({ ...packet, injected: true })}\n`, { mode: 0o600 });

    await expect(
      service.validate(prepared.packet.packetId, Buffer.from('{}')),
    ).rejects.toMatchObject({
      code: 'E_OPERATE_PACKET_CORRUPT',
    });
  });

  it('reports an exact JSON pointer for a schema-required property', async () => {
    const { service, client } = await serviceFixture();
    const prepared = await service.prepare({
      assignmentId: assignment.assignmentId,
      actorId: 'agent-ceo',
      runtime: 'codex',
    });
    client.preflightAssignmentResult.mockResolvedValueOnce({
      valid: false,
      assignmentId: assignment.assignmentId,
      schemaId: 'operating-advisor-result',
      issues: [
        {
          code: 'RESULT_CONTRACT_INVALID',
          path: '/',
          message: "missing required property 'summary'",
          context: { rule: 'required' },
        },
      ],
    });

    const validation = await service.validate(prepared.packet.packetId, Buffer.from('{}'));
    expect(validation.errors).toContainEqual({
      pointer: '/summary',
      rule: 'RESULT_CONTRACT_INVALID',
      message: "missing required property 'summary'",
    });
  });

  it('rejects a packet-directory symlink during validation and abandoned recovery', async () => {
    const { projectDir, service } = await serviceFixture();
    const prepared = await service.prepare({
      assignmentId: assignment.assignmentId,
      actorId: 'agent-ceo',
      runtime: 'codex',
    });
    const displaced = path.join(projectDir, 'displaced-packet');
    await rename(prepared.directory, displaced);
    await symlink(displaced, prepared.directory);

    await expect(
      service.validate(prepared.packet.packetId, Buffer.from('{}')),
    ).rejects.toMatchObject({
      code: 'E_OPERATE_PACKET_CORRUPT',
    });

    const foreignPacket = `pkt_${'a'.repeat(32)}`;
    const packetsRoot = path.dirname(prepared.directory);
    await symlink(displaced, path.join(packetsRoot, foreignPacket));
    await expect(service.recoverAbandoned({ olderThanMs: 0 })).rejects.toMatchObject({
      code: 'E_OPERATE_PACKET_CORRUPT',
    });
  });

  it('accepts JCS-equal reordered custody and rejects a changed value', async () => {
    const { service } = await serviceFixture();
    const prepared = await service.prepare({
      assignmentId: assignment.assignmentId,
      actorId: 'agent-ceo',
      runtime: 'codex',
    });
    const target = path.join(prepared.directory, 'packet.json');
    const packet = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>;
    await writeFile(
      target,
      `${JSON.stringify({
        ...packet,
        actor: { runtime: 'codex', kind: 'agent', actorId: 'agent-ceo' },
      })}\n`,
      { mode: 0o600 },
    );
    await expect(
      service.prepare({
        assignmentId: assignment.assignmentId,
        actorId: 'agent-ceo',
        runtime: 'codex',
      }),
    ).resolves.toMatchObject({ replayed: true });

    await writeFile(
      target,
      `${JSON.stringify({
        ...packet,
        actor: { runtime: 'other-runtime', kind: 'agent', actorId: 'agent-ceo' },
      })}\n`,
      { mode: 0o600 },
    );
    await expect(
      service.prepare({
        assignmentId: assignment.assignmentId,
        actorId: 'agent-ceo',
        runtime: 'codex',
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_PACKET_CONFLICT' });
  });

  it('preserves old active packets and removes only runtime-confirmed abandoned custody', async () => {
    const fixture = await serviceFixture();
    const prepared = await fixture.service.prepare({
      assignmentId: assignment.assignmentId,
      actorId: 'agent-ceo',
      runtime: 'codex',
    });
    const target = path.join(prepared.directory, 'packet.json');
    const packet = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>;
    await writeFile(
      target,
      `${JSON.stringify({ ...packet, createdAt: '2025-01-01T00:00:00.000Z' }, null, 2)}\n`,
      { mode: 0o600 },
    );

    expect(await fixture.service.recoverAbandoned({ olderThanMs: 1, now: Date.now() })).toEqual([]);
    fixture.state.assignmentState = 'abandoned';
    expect(await fixture.service.recoverAbandoned({ olderThanMs: 1, now: Date.now() })).toEqual([
      prepared.packet.packetId,
    ]);
  });

  it('restores pre-swap custody on first rename failure and commits receipt after promotion', async () => {
    const first = await serviceFixture(
      { assignmentState: 'claimed' },
      {
        afterReceiptBackup: async () => {
          throw new Error('after backup');
        },
      },
    );
    const prepared = await first.service.prepare({
      assignmentId: assignment.assignmentId,
      actorId: 'agent-ceo',
      runtime: 'codex',
    });
    const bytes = await readFile(prepared.resultPath);
    await expect(first.service.submit(prepared.packet.packetId, bytes)).rejects.toThrow(
      'after backup',
    );
    await expect(stat(path.join(prepared.directory, 'packet.json'))).resolves.toBeTruthy();
    expect(
      (await readdir(path.dirname(prepared.directory))).filter((entry) =>
        entry.startsWith('.pkt_'),
      ),
    ).toEqual([]);

    const promoted = new OperateAssignmentPacketService(
      first.projectDir,
      (() => first.client) as never,
      {
        afterReceiptPromote: async () => {
          throw new Error('after promote');
        },
      },
    );
    await expect(promoted.submit(prepared.packet.packetId, bytes)).resolves.toMatchObject({
      packetId: prepared.packet.packetId,
    });
    await expect(stat(path.join(prepared.directory, 'receipt.json'))).resolves.toBeTruthy();
    expect(
      (await readdir(path.dirname(prepared.directory))).filter((entry) =>
        entry.startsWith('.pkt_'),
      ),
    ).toEqual([]);
  });

  it('finishes an interrupted receipt swap before any later packet recovery', async () => {
    const fixture = await serviceFixture();
    const prepared = await fixture.service.prepare({
      assignmentId: assignment.assignmentId,
      actorId: 'agent-ceo',
      runtime: 'codex',
    });
    const parent = path.dirname(prepared.directory);
    const nonce = 'deadbeef';
    const backup = path.join(parent, `.${prepared.packet.packetId}.receipt-backup-${nonce}`);
    const stage = path.join(parent, `.${prepared.packet.packetId}.receipt-stage-${nonce}`);
    await mkdir(stage, { mode: 0o700 });
    await writeFile(
      path.join(stage, 'receipt.json'),
      `${JSON.stringify({
        kind: 'openplanr-operate-assignment-packet-receipt',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        packetId: prepared.packet.packetId,
        assignmentId: prepared.packet.assignmentId,
        submissionId: prepared.packet.submissionId,
        contentHash: `sha256:${'0'.repeat(64)}`,
        accepted: {},
      })}\n`,
      { mode: 0o600 },
    );
    await rename(prepared.directory, backup);

    await fixture.service.recoverAbandoned({ olderThanMs: Number.MAX_SAFE_INTEGER });
    await expect(stat(path.join(prepared.directory, 'receipt.json'))).resolves.toBeTruthy();
    expect((await readdir(parent)).filter((entry) => entry.startsWith('.pkt_'))).toEqual([]);
  });
});
