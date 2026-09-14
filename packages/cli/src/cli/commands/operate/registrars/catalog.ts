import type { Command } from 'commander';
import type { OperateCommandOptions } from '../input.js';
import { renderOperateDomainCatalog } from '../render.js';
import type { OperateCommandRegistrationDependencies } from './contracts.js';

export function registerDomainCatalogCommand(
  operate: Command,
  dependencies: OperateCommandRegistrationDependencies,
): void {
  operate
    .command('domains')
    .description('List exact public operating domain identities and registered roles')
    .option('--json')
    .action(async (options: OperateCommandOptions) => {
      const domains = await dependencies.listDomains();
      renderOperateDomainCatalog(domains, options.json);
    });
}
