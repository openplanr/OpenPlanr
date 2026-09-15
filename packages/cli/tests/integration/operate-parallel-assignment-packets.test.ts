import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OperateAssignmentPacketService } from '../../src/services/operate/assignment-packet-service.js';
import { createOperateClient } from '../../src/services/operate/client.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

const projects: TestProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.cleanup();
});

type JsonRecord = Record<string, unknown>;

function authoredEvidenceLimitedResult(template: JsonRecord): JsonRecord {
  const result = structuredClone(template);
  result.outcome = 'partial';
  result.summary = 'Evidence is incomplete, so this seat records no recommendation.';
  result.analysisMarkdown =
    'The issued evidence does not support a decision. Resolve the typed gaps before relying on this seat.';

  const analysis = result.analysis as JsonRecord;
  analysis.executiveQuestionAnswers = (analysis.executiveQuestionAnswers as JsonRecord[]).map(
    (answer) => ({
      ...answer,
      answer: 'The issued evidence is insufficient to answer this question confidently.',
      absenceIds: [...(result.inputAbsenceIds as string[])],
    }),
  );
  result.gaps = (result.gaps as JsonRecord[]).map((gap) => ({
    ...gap,
    impact: 'This missing input prevents an evidence-backed recommendation.',
    recoveryPath: 'Issue a fresh, authorized Artifact that satisfies the bound requirement.',
  }));
  return result;
}

describe('parallel prepared Advisor packets', () => {
  it('prepares, validates, and submits all five Advisor seats without duplicate custody', async () => {
    const fixture = await createTestProject('operate-five-parallel-advisors');
    projects.push(fixture);
    const repositoryEvidence = Buffer.from(
      `${JSON.stringify({ name: 'operate-five-parallel-advisors', private: true }, null, 2)}\n`,
      'utf8',
    );
    await writeFile(path.join(fixture.dir, 'package.json'), repositoryEvidence, { mode: 0o600 });
    const client = createOperateClient(fixture.dir);
    const started = await client.dispatch({
      operation: 'operate.cycle.start',
      request: {
        scope: {
          scopeId: 'scope-five-parallel',
          domainId: 'business',
          domainVersion: '1.0.0',
        },
        focus: ['parallel Advisor custody'],
        trigger: { kind: 'manual' },
        mode: 'standard',
        ownerActorId: 'owner-five-parallel',
      },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));
    const startData = started.data as {
      cycle: { cycleId: string };
      availableAssignments: Array<{ assignmentId: string; assignmentKind: string }>;
    };
    const advisors = startData.availableAssignments.filter(
      ({ assignmentKind }) => assignmentKind === 'advisor',
    );
    expect(advisors).toHaveLength(5);

    const packets = await Promise.all(
      advisors.map(({ assignmentId }, index) =>
        new OperateAssignmentPacketService(fixture.dir).prepare({
          assignmentId,
          actorId: `agent-advisor-${index + 1}`,
          runtime: 'codex',
        }),
      ),
    );
    expect(new Set(packets.map(({ packet }) => packet.packetId)).size).toBe(5);

    const rawInputs: Array<{ directory: string; contentPath: string }> = [];
    for (const packet of packets) {
      const matrix = JSON.parse(await readFile(packet.evidenceMatrixPath, 'utf8')) as {
        inputs: Array<{ contentPath: string; representation: string }>;
      };
      for (const input of matrix.inputs) {
        if (input.representation === 'raw') {
          rawInputs.push({ directory: packet.directory, contentPath: input.contentPath });
        }
      }
    }
    expect(rawInputs.length).toBeGreaterThan(0);
    for (const input of rawInputs) {
      expect(await readFile(path.join(input.directory, input.contentPath))).toEqual(
        repositoryEvidence,
      );
    }

    const authored = await Promise.all(
      packets.map(async (packet) => {
        const template = JSON.parse(await readFile(packet.resultPath, 'utf8')) as JsonRecord;
        const value = authoredEvidenceLimitedResult(template);
        const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await writeFile(packet.resultPath, bytes, { mode: 0o600 });
        return { packet, bytes };
      }),
    );

    const validated = await Promise.all(
      authored.map(({ packet, bytes }) =>
        new OperateAssignmentPacketService(fixture.dir).validate(packet.packet.packetId, bytes),
      ),
    );
    if (validated.some(({ ok }) => !ok)) {
      throw new Error(JSON.stringify(validated, null, 2));
    }
    expect(validated.every(({ ok }) => ok)).toBe(true);

    const submitted = await Promise.all(
      authored.map(({ packet, bytes }) =>
        new OperateAssignmentPacketService(fixture.dir).submit(packet.packet.packetId, bytes),
      ),
    );
    expect(submitted).toHaveLength(5);
    expect(new Set(submitted.map(({ packetId }) => packetId)).size).toBe(5);

    const currentGeneration = (
      await readFile(path.join(fixture.dir, '.planr', 'operate', 'state', 'CURRENT'), 'utf8')
    ).trim();
    const generationRoot = path.join(
      fixture.dir,
      '.planr',
      'operate',
      'state',
      'generations',
      currentGeneration,
    );
    const manifest = JSON.parse(
      await readFile(path.join(generationRoot, 'manifest.json'), 'utf8'),
    ) as {
      artifacts: Array<{ artifactId: string }>;
      state: { submissions: JsonRecord[] };
    };
    const events = (await readFile(path.join(generationRoot, 'events.jsonl'), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonRecord);
    expect(new Set(events.map(({ eventId }) => String(eventId))).size).toBe(events.length);
    expect(new Set(manifest.artifacts.map(({ artifactId }) => artifactId)).size).toBe(
      manifest.artifacts.length,
    );
    for (const { assignmentId } of advisors) {
      expect(
        manifest.state.submissions.filter(
          (submission) =>
            submission.assignmentId === assignmentId && submission.state === 'accepted',
        ),
      ).toHaveLength(1);
    }
  });
});
