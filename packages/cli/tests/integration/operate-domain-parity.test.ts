import { afterEach, describe, expect, it } from 'vitest';
import { createOperateClient } from '../../src/services/operate/client.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

const projects: TestProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.cleanup();
});

describe('OpenPlanr public operating-domain parity', () => {
  it.each(['business', 'software'] as const)(
    'starts and resumes the installed %s domain contract through the same public composition',
    async (domainId) => {
      const fixture = await createTestProject(`operate-${domainId}`);
      projects.push(fixture);
      const client = createOperateClient(fixture.dir);
      const started = await client.dispatch({
        operation: 'operate.cycle.start',
        request: {
          scope: { scopeId: `scope-${domainId}`, domainId, domainVersion: '1.0.0' },
          focus: ['domain parity'],
          trigger: { kind: 'manual' },
          mode: 'standard',
          ownerActorId: `owner-${domainId}`,
        },
      });
      expect(started).toMatchObject({
        ok: true,
        data: { cycle: { domainId, domainVersion: '1.0.0' } },
      });
      if (!started.ok) throw new Error(JSON.stringify(started));
      const cycleId = (started.data as { cycle: { cycleId: string } }).cycle.cycleId;
      expect(
        await createOperateClient(fixture.dir).dispatch({
          operation: 'operate.cycle.resume',
          request: { cycleId },
        }),
      ).toMatchObject({ ok: true, data: { cycle: { domainId } } });
    },
  );

  it('fails closed before storage for an uninstalled domain contract', async () => {
    const fixture = await createTestProject('operate-unknown-domain');
    projects.push(fixture);
    expect(
      await createOperateClient(fixture.dir).dispatch({
        operation: 'operate.cycle.start',
        request: {
          scope: { scopeId: 'scope-unknown', domainId: 'unknown', domainVersion: '1.0.0' },
          focus: [],
          trigger: { kind: 'manual' },
          mode: 'standard',
          ownerActorId: 'owner-unknown-domain',
        },
      }),
    ).toMatchObject({ ok: false, error: { code: 'DOMAIN_CONTRACT_UNSUPPORTED' } });
  });

  it('rejects a copied foreign generation before replay or live composition', async () => {
    const source = await createTestProject('operate-source-project');
    const foreign = await createTestProject('operate-foreign-project');
    projects.push(source, foreign);
    const started = await createOperateClient(source.dir).dispatch({
      operation: 'operate.cycle.start',
      request: {
        scope: { scopeId: 'scope-source', domainId: 'business', domainVersion: '1.0.0' },
        focus: ['foreign custody'],
        trigger: { kind: 'manual' },
        mode: 'standard',
        ownerActorId: 'owner-source-project',
      },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));
    const cycleId = (started.data as { cycle: { cycleId: string } }).cycle.cycleId;
    await cp(join(source.dir, '.planr', 'operate'), join(foreign.dir, '.planr', 'operate'), {
      recursive: true,
    });
    expect(
      await createOperateClient(foreign.dir).dispatch({
        operation: 'operate.cycle.resume',
        request: { cycleId },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'OPERATE_STORE_CORRUPT' },
      allowedActions: [{ tool: 'operate.recovery.inspect' }],
    });
  });
});

import { cp } from 'node:fs/promises';
import { join } from 'node:path';
