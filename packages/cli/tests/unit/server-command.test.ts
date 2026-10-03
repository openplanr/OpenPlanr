import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerServerCommand } from '../../src/cli/commands/server.js';
import {
  listManagedServers,
  stopManagedServer,
  stopManagedServers,
} from '../../src/services/server-lifecycle-service.js';
import { display } from '../../src/utils/logger.js';

vi.mock('../../src/services/server-lifecycle-service.js', () => ({
  listManagedServers: vi.fn(),
  stopManagedServer: vi.fn(),
  stopManagedServers: vi.fn(),
}));
vi.mock('../../src/utils/logger.js', () => ({ display: { line: vi.fn(), keyValue: vi.fn() } }));
async function server(...args: string[]) {
  const program = new Command().exitOverride();
  registerServerCommand(program);
  await program.parseAsync(['node', 'planr', 'server', ...args]);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listManagedServers).mockResolvedValue([]);
  vi.mocked(stopManagedServer).mockResolvedValue({ status: 'stopped' });
  vi.mocked(stopManagedServers).mockResolvedValue({ results: [], failures: [] });
});
afterEach(() => vi.restoreAllMocks());
describe('owned server CLI smoke', () => {
  it('prints an empty result through the supported display API', async () => {
    await server('list');
    expect(display.line).toHaveBeenCalledWith('No local Studio services are running.');
  });
  it('lists exact instance IDs and returns complete structured output', async () => {
    const instances = [
      { instanceId: 'a'.repeat(22), pid: 123, port: 43123, kind: 'design', status: 'running' },
    ];
    vi.mocked(listManagedServers).mockResolvedValue(instances);
    await server('list', '--json');
    expect(JSON.parse(String(vi.mocked(display.line).mock.calls[0][0]))).toEqual({
      ok: true,
      action: 'server.list',
      instances,
    });
  });
  it('passes only the chosen instance identity to the lifecycle service', async () => {
    await server('stop', 'a'.repeat(22));
    expect(stopManagedServer).toHaveBeenCalledExactlyOnceWith('a'.repeat(22));
    expect(display.line).toHaveBeenCalledWith('Local service stopped.');
  });
  it('keeps shutdown failures actionable', async () => {
    vi.mocked(stopManagedServer).mockRejectedValueOnce(new Error('instance changed'));
    await expect(server('stop', 'a'.repeat(22))).rejects.toThrow('instance changed');
    expect(display.line).not.toHaveBeenCalled();
  });
});

it('accepts a recorded port selector without treating it as an instance ID', async () => {
  await server('stop', '43123', '--json');
  expect(stopManagedServer).not.toHaveBeenCalled();
  expect(stopManagedServers).toHaveBeenCalledWith({
    target: '43123',
    all: undefined,
    project: undefined,
    yes: undefined,
  });
  expect(JSON.parse(String(vi.mocked(display.line).mock.calls[0][0]))).toEqual({
    ok: true,
    action: 'server.stop',
    results: [],
    failures: [],
  });
});
it('forwards explicit all confirmation and exact project filtering', async () => {
  await server('stop', '--all', '--yes');
  expect(stopManagedServers).toHaveBeenCalledWith({
    target: undefined,
    all: true,
    project: undefined,
    yes: true,
  });
  await server('stop', '--project', '/tmp/project');
  expect(stopManagedServers).toHaveBeenLastCalledWith({
    target: undefined,
    all: undefined,
    project: '/tmp/project',
    yes: undefined,
  });
});
it('preserves successful batch receipts when another authenticated stop fails', async () => {
  const prior = process.exitCode;
  try {
    const batch = {
      results: [{ instanceId: 'a'.repeat(22), result: { status: 'stopping' } }],
      failures: [
        {
          instanceId: 'b'.repeat(22),
          code: 'E_SERVER_INSTANCE_CHANGED',
          problem: 'The instance changed.',
        },
      ],
    };
    vi.mocked(stopManagedServers).mockResolvedValue(batch);
    await server('stop', '--all', '--yes', '--json');
    expect(JSON.parse(String(vi.mocked(display.line).mock.calls[0][0]))).toEqual({
      ok: false,
      action: 'server.stop',
      ...batch,
    });
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = prior;
  }
});

it('accepts the explicit global --yes confirmation for unfiltered --all', async () => {
  const program = new Command().exitOverride().option('--yes');
  registerServerCommand(program);
  await program.parseAsync(['node', 'planr', '--yes', 'server', 'stop', '--all']);
  expect(stopManagedServers).toHaveBeenCalledWith({
    target: undefined,
    all: true,
    project: undefined,
    yes: true,
  });
});
