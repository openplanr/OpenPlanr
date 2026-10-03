import type { Command } from 'commander';
import {
  listManagedServers,
  type ManagedServerStopBatch,
  stopManagedServer,
  stopManagedServers,
} from '../../services/server-lifecycle-service.js';
import { display } from '../../utils/logger.js';

function displayBatchStop(batch: ManagedServerStopBatch, json?: boolean): void {
  if (batch.failures.length) process.exitCode = 1;
  if (json) {
    display.line(
      JSON.stringify({ ok: batch.failures.length === 0, action: 'server.stop', ...batch }),
    );
    return;
  }
  for (const item of batch.results)
    display.keyValue(
      item.instanceId,
      item.result.status === 'stopped' ? 'stopped' : 'shutdown requested; pending work will finish',
    );
  for (const item of batch.failures)
    display.keyValue(item.instanceId, `${item.code}: ${item.problem}`);
  if (!batch.results.length && !batch.failures.length)
    display.line('No owned local services match this selection.');
}

/** Owned service operations never accept a port or PID as shutdown authority. */
export function registerServerCommand(program: Command): void {
  const server = program
    .command('server')
    .description('Inspect and stop owned local Studio services');
  server
    .command('list')
    .description('List local Studio instances')
    .option('--json', 'machine-readable output')
    .action(async (options: { json?: boolean }) => {
      const instances = await listManagedServers();
      if (options.json) {
        display.line(JSON.stringify({ ok: true, action: 'server.list', instances }));
        return;
      }
      if (!instances.length) {
        display.line('No local Studio services are running.');
        return;
      }
      for (const instance of instances)
        display.keyValue(
          instance.kind,
          `${instance.instanceId} · ${instance.status} · port ${instance.port}${instance.projectRoot ? ` · ${instance.projectRoot}` : ''}${instance.startedAt ? ` · since ${instance.startedAt}` : ''}`,
        );
    });
  server
    .command('stop [instance-or-port]')
    .description('Drain saves and stop recorded local services by instance, port or project')
    .option('--all', 'stop all recorded owned local services')
    .option('--project <directory>', 'stop only services recorded for this exact project')
    .option('--yes', 'confirm an unfiltered --all shutdown')
    .option('--json', 'machine-readable output')
    .action(
      async (
        instance: string | undefined,
        options: { json?: boolean; all?: boolean; project?: string; yes?: boolean },
      ) => {
        if (
          instance === undefined ||
          !/^[A-Za-z0-9_-]{22}$/u.test(instance) ||
          options.all ||
          options.project !== undefined
        ) {
          const batch = await stopManagedServers({
            target: instance,
            all: options.all,
            project: options.project,
            yes: options.yes || program.opts().yes,
          });
          displayBatchStop(batch, options.json);
          return;
        }
        const result = await stopManagedServer(instance);
        if (options.json)
          display.line(
            JSON.stringify({ ok: true, action: 'server.stop', instanceId: instance, ...result }),
          );
        else
          display.line(
            result.status === 'stopped'
              ? 'Local service stopped.'
              : 'Shutdown requested. Pending work will finish before the service closes.',
          );
      },
    );
}
