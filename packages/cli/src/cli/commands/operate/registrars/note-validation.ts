import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Command, Option } from 'commander';
import { display } from '../../../../utils/logger.js';
import { OperateCommandBoundaryError } from '../input.js';
import type {
  OperateCommandRegistrationDependencies,
  OperateNoteContractVersionSelector,
  OperateNoteValidationDiagnostic,
  OperateNoteValidationProfile,
  OperateNoteValidationResult,
} from './contracts.js';

const PROFILES = ['advisor', 'challenger', 'chair', 'board-report'] as const;
const CONTRACT_VERSIONS = ['auto', '1.0.0', '2.0.0'] as const;
const PUBLIC_DIAGNOSTIC_CODE = /^E_[A-Z0-9_]{1,127}$/u;
const MAX_PUBLIC_DIAGNOSTICS = 50;
const MAX_DIAGNOSTIC_TEXT = 500;

type NoteValidationDependencies = Pick<
  OperateCommandRegistrationDependencies,
  'inspectOperateReviewNote'
>;

type NoteValidationOptions = {
  profile: OperateNoteValidationProfile;
  contractVersion: OperateNoteContractVersionSelector;
  json?: boolean;
};

type PublicDiagnostic = {
  code: string;
  problem: string;
};

type PublicDiagnostics = {
  entries: PublicDiagnostic[];
  omitted: number;
};

async function readNote(path: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readFile(resolve(path));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
    throw new OperateCommandBoundaryError(
      missing ? 'E_OPERATE_NOTE_NOT_FOUND' : 'E_OPERATE_NOTE_UNREADABLE',
      missing
        ? 'The Operate note file does not exist.'
        : 'The Operate note file could not be read.',
      error,
    );
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new OperateCommandBoundaryError(
      'E_OPERATE_NOTE_UTF8_INVALID',
      'The Operate note must be valid UTF-8 Markdown.',
      error,
    );
  }
}

function publicDiagnostics(
  diagnostics: readonly OperateNoteValidationDiagnostic[],
): PublicDiagnostics {
  return {
    entries: diagnostics.slice(0, MAX_PUBLIC_DIAGNOSTICS).map(({ code, message }) => ({
      code: PUBLIC_DIAGNOSTIC_CODE.test(code) ? code : 'E_OPERATE_NOTE_DIAGNOSTIC_INVALID',
      problem: String(message).replace(/\s+/gu, ' ').trim().slice(0, MAX_DIAGNOSTIC_TEXT),
    })),
    omitted: Math.max(0, diagnostics.length - MAX_PUBLIC_DIAGNOSTICS),
  };
}

function renderResult(result: OperateNoteValidationResult, json = false): void {
  const diagnostics = publicDiagnostics(result.diagnostics);
  const checkCount = result.diagnostics.length;
  const data = {
    profile: result.profile,
    contractVersion: result.contractVersion,
    contractKind: result.contractKind,
    versionSource: result.versionSource,
    byteLength: result.byteLength,
    itemCount: result.itemCount,
  };
  if (json) {
    display.line(
      JSON.stringify(
        result.ok
          ? {
              ok: true,
              operation: 'operate.note.validate',
              data,
              diagnostics: diagnostics.entries,
              ...(diagnostics.omitted > 0 ? { diagnosticsOmitted: diagnostics.omitted } : {}),
            }
          : {
              ok: false,
              code: 'E_OPERATE_NOTE_INVALID',
              problem: `The Operate ${result.profile} note failed ${checkCount} contract check${checkCount === 1 ? '' : 's'}.`,
              data,
              diagnostics: diagnostics.entries,
              ...(diagnostics.omitted > 0 ? { diagnosticsOmitted: diagnostics.omitted } : {}),
            },
      ),
    );
  } else if (result.ok) {
    display.line(
      `Operate ${result.profile} note is valid for ${result.contractKind}@${result.contractVersion} · ${result.byteLength} bytes · ${result.itemCount} item(s).`,
    );
  } else {
    display.line(
      `E_OPERATE_NOTE_INVALID: The Operate ${result.profile} note failed ${checkCount} contract check${checkCount === 1 ? '' : 's'}.`,
    );
    for (const diagnostic of diagnostics.entries) {
      display.line(`- ${diagnostic.code}: ${diagnostic.problem}`);
    }
    if (diagnostics.omitted > 0) {
      display.line(
        `- E_OPERATE_NOTE_DIAGNOSTICS_TRUNCATED: ${diagnostics.omitted} additional diagnostic(s) omitted.`,
      );
    }
  }
  if (!result.ok) process.exitCode = 1;
}

export function registerOperateNoteValidationCommand(
  operate: Command,
  dependencies: NoteValidationDependencies,
): void {
  operate
    .command('validate-note')
    .description('Inspect one Operate Markdown note against a selected or detected output contract')
    .argument('<file>', 'Markdown note to validate')
    .addOption(
      new Option('--profile <profile>', 'advisor, challenger, chair, or board-report')
        .choices([...PROFILES])
        .makeOptionMandatory(),
    )
    .addOption(
      new Option('--contract-version <version>', 'note contract version: auto, 1.0.0, or 2.0.0')
        .choices([...CONTRACT_VERSIONS])
        .default('auto'),
    )
    .option('--json')
    .action(async (file: string, options: NoteValidationOptions) => {
      const markdown = await readNote(file);
      const result = await dependencies.inspectOperateReviewNote(markdown, {
        profile: options.profile,
        contractVersion: options.contractVersion,
      });
      renderResult(result, options.json);
    });
}
