import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import {
  CLI_COMMAND_GROUPS,
  PLANR_CAPABILITY_GROUPS,
} from '../../../../apps/dashboard/src/features/planning/console-catalog.js';
import { bulkListCommands } from '../../../../apps/dashboard/src/features/planning/planning-list-filter.js';
import {
  type PlanningModelNode,
  planningContinuation,
} from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import {
  type OperateCommandRegistrationDependencies,
  registerOperateCommandDefinition,
} from '../../src/cli/commands/operate/registration.js';
import { registerBacklogCommand } from '../../src/cli/commands/planning-artifacts.js';
import { registerStatusCommand } from '../../src/cli/commands/status.js';

const templates = CLI_COMMAND_GROUPS.flatMap((group) => group.commands);

function registration() {
  const program = new Command()
    .name('openplanr')
    .exitOverride()
    .configureOutput({
      writeOut: () => {},
      writeErr: () => {},
    });
  const dependencies = {
    createClient: vi.fn(),
    createAssignmentPacketService: vi.fn(),
    listDomains: vi.fn(),
    startDashboard: vi.fn(),
    inspectOperateReviewNote: vi.fn(),
  } satisfies OperateCommandRegistrationDependencies;
  registerOperateCommandDefinition(program, dependencies);
  registerBacklogCommand(program);
  registerStatusCommand(program);
  const invoked = vi.fn();
  const replaceActions = (command: Command) => {
    command.exitOverride();
    if (command.commands.length === 0) command.action(invoked);
    for (const child of command.commands) replaceActions(child);
  };
  replaceActions(program);
  return { program, invoked, dependencies };
}

function commandArgs(template: string) {
  return template.split(' ').slice(1);
}

function findLeaf(program: Command, args: string[]): Command {
  let current = program;
  for (const arg of args) {
    const child = current.commands.find((command) => command.name() === arg);
    if (!child) break;
    current = child;
  }
  return current;
}

describe('Console command catalogue', () => {
  it('covers shipped host skills with their published namespaced invocation', () => {
    const manifest = JSON.parse(
      readFileSync(
        new URL('../../../../adapters/manifests/codex-plugin-content.json', import.meta.url),
        'utf8',
      ),
    ) as { skills: { skillId: string; invocation: string }[] };
    const capabilities = PLANR_CAPABILITY_GROUPS.flatMap((group) => group.capabilities);
    expect(capabilities.map((capability) => capability.id).sort()).toEqual(
      manifest.skills.map((skill) => skill.skillId).sort(),
    );
    for (const capability of capabilities) {
      const skill = manifest.skills.find((entry) => entry.skillId === capability.id);
      expect(capability.command).toBe(skill?.invocation.replace(/^\$/, '/'));
    }
  });

  it.each(templates)('keeps $id accepted by the registered CLI grammar', async ({ command }) => {
    const { program, invoked, dependencies } = registration();
    await program.parseAsync(commandArgs(command), { from: 'user' });
    expect(invoked).toHaveBeenCalledOnce();
    for (const dependency of Object.values(dependencies)) {
      expect(dependency).not.toHaveBeenCalled();
    }
  });

  it.each(templates)('includes every required flag for $id', async ({ command }) => {
    const args = commandArgs(command);
    const leaf = findLeaf(registration().program, args);
    for (const option of leaf.options.filter((entry) => entry.mandatory)) {
      expect(args).toContain(option.long);
      const missing = [...args];
      const index = missing.indexOf(option.long ?? '');
      missing.splice(index, 2);
      const { program, invoked } = registration();
      await expect(program.parseAsync(missing, { from: 'user' })).rejects.toMatchObject({
        code: 'commander.missingMandatoryOptionValue',
      });
      expect(invoked).not.toHaveBeenCalled();
    }
  });

  it('keeps scoped task writers unavailable and preserves the parent read', () => {
    const task: PlanningModelNode = {
      id: 'SPEC-910/T-911',
      type: 'task',
      title: 'Scoped task fixture',
      status: 'outstanding',
      frontmatter: {},
    };
    expect(bulkListCommands([task], 'in-progress')).toEqual({
      commands: [],
      skipped: [`${task.id}: no verified status writer for this item`],
    });
    expect(planningContinuation(task)).toBe(`/planr:ship ${task.id}`);
    expect(planningContinuation({ ...task, id: 'SPEC-910', type: 'spec' })).toBe(
      'openplanr status SPEC-910 --md',
    );
    expect(templates.some(({ command }) => /openplanr task (?:show|update)/u.test(command))).toBe(
      false,
    );
    expect(templates.some(({ command }) => command.startsWith('openplanr status '))).toBe(true);
    expect(
      templates.some(({ command }) => command.startsWith('openplanr operate review decide')),
    ).toBe(false);
  });
});
