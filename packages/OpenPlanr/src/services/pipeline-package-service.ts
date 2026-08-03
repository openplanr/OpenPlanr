import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { GuidedQuestionnaire } from './operate/types.js';

const require = createRequire(import.meta.url);

export interface PipelinePackage {
  root: string;
  version: string;
  binPath: string;
  adapterRegistryPath: string;
  roleRegistryPath: string;
}

export interface GuidedInteractionValidators {
  createGuidedAnswerSubmission(value: unknown): GuidedQuestionnaire['submission'];
  validateGuidedQuestion(value: unknown): unknown[];
  validateGuidedQuestionnaire(value: unknown): unknown[];
  validateGuidedAnswerEnvelope(value: unknown): unknown[];
  validateGuidedSession(value: unknown): unknown[];
  validateGuidedConfirmation(value: unknown): unknown[];
  validateStructuredAction(value: unknown): unknown[];
  validateEvidenceDiagnostic(value: unknown): unknown[];
}

function candidateRoots(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const roots = [process.env.OPENPLANR_PIPELINE_ROOT].filter((value): value is string =>
    Boolean(value),
  );

  try {
    const entry = require.resolve('planr-pipeline');
    roots.push(path.resolve(path.dirname(entry), '../..'));
  } catch {
    // Optional dependency may be omitted by the minimal installer.
  }
  roots.push(
    path.resolve(here, '../../../planr-pipeline'),
    path.resolve(process.cwd(), '../planr-pipeline'),
  );
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

export function resolvePipelinePackage(required = true): PipelinePackage | null {
  for (const root of candidateRoots()) {
    const packagePath = path.join(root, 'package.json');
    const binPath = path.join(root, 'bin', 'planr-pipeline.mjs');
    const adapterRegistryPath = path.join(root, 'registry', 'adapters.json');
    const roleRegistryPath = path.join(root, 'registry', 'roles.json');
    if (![packagePath, binPath, adapterRegistryPath, roleRegistryPath].every(existsSync)) continue;
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: string };
    return {
      root,
      version: pkg.version ?? '0.0.0',
      binPath,
      adapterRegistryPath,
      roleRegistryPath,
    };
  }

  if (!required) return null;
  const error = new Error(
    'The pipeline package is not installed. Run `npm install -g openplanr@latest` or rerun setup without `--minimal`.',
  );
  error.name = 'E_PIPELINE_NOT_INSTALLED';
  throw error;
}

/**
 * Resolve the additive Protocol v1.2 guided-interaction validators without
 * making OpenPlanr depend on private pipeline source paths at compile time.
 */
export async function resolveGuidedInteractionValidators(): Promise<GuidedInteractionValidators> {
  const candidates = candidateRoots()
    .map((root) => {
      const packagePath = path.join(root, 'package.json');
      if (!existsSync(packagePath)) return null;
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: string };
      return { root, version: pkg.version ?? '0.0.0' };
    })
    .filter((candidate): candidate is { root: string; version: string } => candidate !== null);
  if (candidates.length === 0) {
    const error = new Error('The pipeline package is not installed.');
    error.name = 'E_PIPELINE_NOT_INSTALLED';
    throw error;
  }
  for (const candidate of candidates) {
    const modulePath = path.join(candidate.root, 'lib', 'pipeline', 'index.mjs');
    if (!existsSync(modulePath)) continue;
    try {
      const loaded = (await import(
        pathToFileURL(modulePath).href
      )) as Partial<GuidedInteractionValidators>;
      if (
        typeof loaded.createGuidedAnswerSubmission === 'function' &&
        typeof loaded.validateGuidedQuestion === 'function' &&
        typeof loaded.validateGuidedQuestionnaire === 'function' &&
        typeof loaded.validateGuidedAnswerEnvelope === 'function' &&
        typeof loaded.validateGuidedSession === 'function' &&
        typeof loaded.validateGuidedConfirmation === 'function' &&
        typeof loaded.validateStructuredAction === 'function' &&
        typeof loaded.validateEvidenceDiagnostic === 'function'
      ) {
        return loaded as GuidedInteractionValidators;
      }
    } catch {
      // Continue to the next installed or explicitly configured candidate.
    }
  }
  const versions = [...new Set(candidates.map((candidate) => candidate.version))].join(', ');
  const error = new Error(
    `Installed planr-pipeline version(s) ${versions} do not provide the Protocol v1.2 guided interaction validators. Install the compatible full package with \`npm install -g openplanr@latest\`.`,
  );
  error.name = 'E_PIPELINE_VERSION_INCOMPATIBLE';
  throw error;
}
