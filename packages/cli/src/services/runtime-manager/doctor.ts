import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CLI_COMMAND, PLANNING_FOLDER } from '../../utils/constants.js';
import type { OwnedFile } from './global-state.js';

export type RuntimeDoctorDiagnostic = Readonly<{
  code: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}>;

export type InstalledDocument = Readonly<{
  runtime: string;
  target: string;
  kind?: OwnedFile['kind'];
  marker?: string;
}>;

const SETUP_RUNTIMES: Readonly<Record<string, string>> = {
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor',
};

export function classifyComponentDrift(input: {
  cliDrift: boolean;
  componentDrift: boolean;
  incompatibleDrift: boolean;
}): {
  drift: boolean;
  genuineDrift: boolean;
  upgradeOnlyDrift: boolean;
  status: 'pass' | 'warn' | 'fail';
} {
  const drift = input.componentDrift || input.incompatibleDrift;
  const genuineDrift = input.incompatibleDrift;
  const upgradeOnlyDrift = drift && !genuineDrift && input.cliDrift;
  const status: 'pass' | 'warn' | 'fail' = genuineDrift
    ? 'fail'
    : upgradeOnlyDrift
      ? 'warn'
      : drift
        ? 'fail'
        : 'pass';
  return { drift, genuineDrift, upgradeOnlyDrift, status };
}

/** Diagnoses byte ownership without mutating or repairing the managed targets. */
export function diagnoseManagedRuntimeFiles(
  files: readonly OwnedFile[],
  ownershipHash: (content: string | Buffer, kind: OwnedFile['kind'], marker?: string) => string,
): RuntimeDoctorDiagnostic | null {
  if (files.length === 0) return null;
  const conflicts: string[] = [];
  const missing: string[] = [];
  for (const file of files) {
    if (!existsSync(file.target)) missing.push(file.target);
    else if (ownershipHash(readFileSync(file.target), file.kind, file.marker) !== file.hash) {
      conflicts.push(file.target);
    }
  }
  return {
    code: conflicts.length ? 'migration-conflict' : 'managed-files',
    status: conflicts.length ? 'fail' : missing.length ? 'warn' : 'pass',
    message: conflicts.length
      ? `${conflicts.length} managed file(s) changed outside setup`
      : missing.length
        ? `${missing.length} managed file(s) are missing`
        : 'Managed runtime files match recorded ownership hashes',
    ...(conflicts.length || missing.length
      ? {
          fix: `Run \`${CLI_COMMAND} setup --dry-run\`, then explicitly approve repair or rollback.`,
        }
      : {}),
  };
}

/** Validates the append-only public provenance surface without inventing repairs. */
export function diagnoseRuntimeProvenance(projectDir: string): RuntimeDoctorDiagnostic | null {
  const provenancePath = path.join(projectDir, PLANNING_FOLDER, 'provenance.jsonl');
  if (!existsSync(provenancePath)) return null;
  const invalidLines: number[] = [];
  const lines = readFileSync(provenancePath, 'utf8').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        event_id?: string;
        producer?: { product?: string };
      };
      if (!event.event_id || !event.producer?.product) invalidLines.push(index + 1);
    } catch {
      invalidLines.push(index + 1);
    }
  }
  return {
    code: invalidLines.length ? 'provenance-invalid' : 'provenance',
    status: invalidLines.length ? 'fail' : 'pass',
    message: invalidLines.length
      ? `Provenance contains invalid event lines: ${invalidLines.join(', ')}`
      : 'Provenance is append-only JSONL with identifiable producers',
    ...(invalidLines.length
      ? {
          fix: 'Repair the invalid bytes, then explicitly append a recovery event. Doctor will not invent history.',
        }
      : {}),
  };
}

/** Markdown and rule documents under an installed plugin folder. */
export function pluginDocuments(runtime: string, root: string): InstalledDocument[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.mdc?$/u.test(entry))
    .map((entry) => ({ runtime, target: path.join(root, entry) }));
}

/**
 * Flags installed skills and rules that still tell the agent to run `planr <command>`.
 * In a shared file, only the block setup manages is read.
 */
export function diagnoseRetiredCommandSkills(
  documents: readonly InstalledDocument[],
  commandRoots: readonly string[],
  managedBlock: (content: Buffer, marker?: string) => Buffer,
): RuntimeDoctorDiagnostic | null {
  const readable = documents.filter(({ target }) => /\.mdc?$/u.test(target) && existsSync(target));
  const roots = commandRoots.filter((root) => /^[a-z][a-z0-9-]*$/u.test(root));
  if (readable.length === 0 || roots.length === 0) return null;
  const retired = new RegExp(`(?<![\\w./@:$#~-])planr[ \\t]+(?:${roots.join('|')})(?![\\w-])`, 'u');
  const stale = readable.filter(({ target, kind, marker }) => {
    const content = readFileSync(target);
    return retired.test(
      (kind === 'managed-block' ? managedBlock(content, marker) : content).toString('utf8'),
    );
  });
  if (stale.length === 0) {
    return {
      code: 'installed-skill-commands',
      status: 'pass',
      message: `Installed skills and rules run ${CLI_COMMAND}`,
    };
  }
  const hosts = [...new Set(stale.flatMap(({ runtime }) => SETUP_RUNTIMES[runtime] ?? []))].sort();
  return {
    code: 'installed-skill-commands',
    status: 'warn',
    message: `${stale.length} installed skill or rule file(s) still tell the agent to run planr`,
    fix: hosts.length
      ? `Rerun ${hosts.map((host) => `\`${CLI_COMMAND} setup --runtime ${host}\``).join(' and ')}, or update the plugin, then restart the agent.`
      : `Rerun \`${CLI_COMMAND} setup\`, then restart the agent.`,
  };
}
