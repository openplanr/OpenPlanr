import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('../../src/services/pipeline-package-service.js', () => ({
  resolvePipelinePackage: () => ({ root: state.root, version: 'fixture' }),
}));
const alpha = 'a'.repeat(22),
  beta = 'b'.repeat(22),
  gamma = 'c'.repeat(22);
const project = resolve('/tmp/owned-project');
function instance(instanceId: string, port: number, kind: string, projectRoot?: string) {
  return {
    instanceId,
    port,
    kind,
    pid: 123,
    status: 'running',
    ...(projectRoot ? { projectRoot } : {}),
  };
}
function fixture(value: Record<string, unknown>) {
  writeFileSync(join(state.root, 'fixture.json'), JSON.stringify(value));
}
function calls() {
  return JSON.parse(readFileSync(join(state.root, 'calls.json'), 'utf8')) as string[];
}
beforeEach(() => {
  vi.resetModules();
  state.root = mkdtempSync(join(tmpdir(), 'owned-server-selection-'));
  const runtime = `import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const fixture=fileURLToPath(new URL('../../fixture.json',import.meta.url));const calls=fileURLToPath(new URL('../../calls.json',import.meta.url));
export async function stop(id){const current=JSON.parse(readFileSync(fixture,'utf8'));const prior=JSON.parse(readFileSync(calls,'utf8'));writeFileSync(calls,JSON.stringify([...prior,id]));if(current.failId===id){const error=new Error('The instance changed.');error.code='E_SERVER_INSTANCE_CHANGED';throw error;}return {status:'stopping'};}
`;
  for (const dir of ['artifact', 'dashboard', 'design-engine'])
    mkdirSync(join(state.root, 'lib', dir), { recursive: true });
  writeFileSync(
    join(state.root, 'lib/artifact/review-server.mjs'),
    runtime +
      `export const listArtifactReviewServers=async()=>JSON.parse(readFileSync(fixture,'utf8')).artifacts;export const stopArtifactReviewServer=stop;`,
  );
  writeFileSync(
    join(state.root, 'lib/dashboard/index.mjs'),
    runtime +
      `export const listDashboardServers=async()=>JSON.parse(readFileSync(fixture,'utf8')).dashboards;export const stopDashboardServer=stop;`,
  );
  writeFileSync(
    join(state.root, 'lib/design-engine/daemon.mjs'),
    `export const findRunningDaemon=async()=>null;export const killRunningDaemon=async()=>false;`,
  );
  writeFileSync(join(state.root, 'calls.json'), '[]');
  fixture({
    artifacts: [instance(alpha, 43123, 'artifact', project)],
    dashboards: [
      instance(beta, 43124, 'dashboard', project),
      instance(gamma, 43125, 'dashboard', project + '-other'),
    ],
  });
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));
it('resolves a recorded port to the exact authenticated instance only', async () => {
  const { stopManagedServers } = await import('../../src/services/server-lifecycle-service.js');
  expect(await stopManagedServers({ target: '43123' })).toEqual({
    results: [{ instanceId: alpha, result: { status: 'stopping' } }],
    failures: [],
  });
  expect(calls()).toEqual([alpha]);
});
it('refuses ambiguous or absent ports without sending any shutdown', async () => {
  fixture({
    artifacts: [instance(alpha, 43123, 'artifact', project)],
    dashboards: [instance(beta, 43123, 'dashboard', project)],
  });
  const { stopManagedServers } = await import('../../src/services/server-lifecycle-service.js');
  await expect(stopManagedServers({ target: '43123' })).rejects.toMatchObject({
    code: 'E_SERVER_SELECTOR_AMBIGUOUS',
  });
  await expect(stopManagedServers({ target: '43126' })).rejects.toMatchObject({
    code: 'E_SERVER_SELECTION_EMPTY',
  });
  expect(calls()).toEqual([]);
});
it('requires --yes before unfiltered --all and rejects conflicting selectors', async () => {
  const { stopManagedServers } = await import('../../src/services/server-lifecycle-service.js');
  await expect(stopManagedServers({ all: true })).rejects.toMatchObject({
    code: 'E_SERVER_CONFIRMATION_REQUIRED',
  });
  await expect(stopManagedServers({ all: true, target: alpha, yes: true })).rejects.toMatchObject({
    code: 'E_SERVER_SELECTOR_INVALID',
  });
  await expect(stopManagedServers({ target: alpha, project })).rejects.toMatchObject({
    code: 'E_SERVER_SELECTOR_INVALID',
  });
  await expect(stopManagedServers({ target: '70000' })).rejects.toMatchObject({
    code: 'E_SERVER_SELECTOR_INVALID',
  });
  await expect(stopManagedServers({})).rejects.toMatchObject({ code: 'E_SERVER_SELECTOR_INVALID' });
  expect(calls()).toEqual([]);
});
it('stops only exact project records without prefix or unscoped matches', async () => {
  const { stopManagedServers } = await import('../../src/services/server-lifecycle-service.js');
  expect((await stopManagedServers({ project })).results.map((item) => item.instanceId)).toEqual([
    alpha,
    beta,
  ]);
  expect(calls()).toEqual([alpha, beta]);
});
it('allows project-filtered --all without unfiltered confirmation', async () => {
  const { stopManagedServers } = await import('../../src/services/server-lifecycle-service.js');
  expect(
    (await stopManagedServers({ all: true, project })).results.map((item) => item.instanceId),
  ).toEqual([alpha, beta]);
  expect(calls()).toEqual([alpha, beta]);
});
it('retains earlier receipts and continues distinct owners after identity changes', async () => {
  fixture({
    artifacts: [instance(alpha, 43123, 'artifact', project)],
    dashboards: [instance(beta, 43124, 'dashboard', project), instance(gamma, 43125, 'dashboard')],
    failId: beta,
  });
  const { stopManagedServers } = await import('../../src/services/server-lifecycle-service.js');
  const result = await stopManagedServers({ all: true, yes: true });
  expect(result.results.map((item) => item.instanceId)).toEqual([alpha, gamma]);
  expect(result.failures).toEqual([
    { instanceId: beta, code: 'E_SERVER_INSTANCE_CHANGED', problem: 'The instance changed.' },
  ]);
  expect(calls()).toEqual([alpha, beta, gamma]);
});
it('treats a confirmed empty batch as an idempotent selection', async () => {
  fixture({ artifacts: [], dashboards: [] });
  const { stopManagedServers } = await import('../../src/services/server-lifecycle-service.js');
  expect(await stopManagedServers({ all: true, yes: true })).toEqual({ results: [], failures: [] });
  expect(calls()).toEqual([]);
});
