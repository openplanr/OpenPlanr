import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDigest } from '../canonical.js';
import {
  inspectEmbeddedInstructions,
  normalizeUntrustedText,
  redactSensitiveText,
} from '../redaction.js';

const ENGINE_VERSION = '1.0.0';
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_SUGGESTION_LENGTH = 1_000;

export interface OperatingCharterSuggestion {
  field: 'purpose';
  value: string;
  draft: true;
  confidence: 'high' | 'medium';
  citation: {
    source: 'package-json' | 'planr-config';
    location: 'package.json#description' | '.planr/config.json#projectName';
    digest: `sha256:${string}`;
  };
  engineVersion: typeof ENGINE_VERSION;
}

export interface OperatingCharterSuggestionResult {
  evidenceDigest: `sha256:${string}`;
  suggestions: OperatingCharterSuggestion[];
  gaps: Array<
    | 'purpose'
    | 'stage'
    | 'businessModel'
    | 'idealCustomer'
    | 'goals'
    | 'successMetrics'
    | 'guardrails'
    | 'knownUnknowns'
  >;
}

async function readBoundedJson(
  projectRoot: string,
  relativePath: string,
): Promise<Record<string, unknown> | null> {
  const target = path.join(projectRoot, relativePath);
  const bytes = await readFile(target).catch(() => null);
  if (!bytes || bytes.byteLength > MAX_METADATA_BYTES) return null;
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function safeMetadataValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeUntrustedText(value).replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > MAX_SUGGESTION_LENGTH) return null;
  const inspection = inspectEmbeddedInstructions(normalized);
  if (inspection.annotations.length > 0 || inspection.quarantined) return null;
  try {
    const redacted = redactSensitiveText(normalized);
    return redacted.redactions.length === 0 ? redacted.value : null;
  } catch {
    return null;
  }
}

/**
 * Produce bounded, provider-free charter drafts from local metadata.
 *
 * Only purpose is eligible at launch. Product stage, commercial facts,
 * customers, goals, metrics, guardrails, and unknowns remain human-owned.
 */
export async function buildOperatingCharterSuggestions(input: {
  projectRoot: string;
}): Promise<OperatingCharterSuggestionResult> {
  const [packageJson, planrConfig] = await Promise.all([
    readBoundedJson(input.projectRoot, 'package.json'),
    readBoundedJson(input.projectRoot, '.planr/config.json'),
  ]);
  const evidence = {
    packageDescription: safeMetadataValue(packageJson?.description),
    projectName: safeMetadataValue(planrConfig?.projectName),
  };
  const evidenceDigest = canonicalDigest({
    engineVersion: ENGINE_VERSION,
    evidence,
  });
  const suggestions: OperatingCharterSuggestion[] = [];
  if (evidence.packageDescription) {
    suggestions.push({
      field: 'purpose',
      value: evidence.packageDescription,
      draft: true,
      confidence: 'high',
      citation: {
        source: 'package-json',
        location: 'package.json#description',
        digest: canonicalDigest(evidence.packageDescription),
      },
      engineVersion: ENGINE_VERSION,
    });
  } else if (evidence.projectName) {
    suggestions.push({
      field: 'purpose',
      value: `Operate ${evidence.projectName} with explicit, evidence-cited decisions.`,
      draft: true,
      confidence: 'medium',
      citation: {
        source: 'planr-config',
        location: '.planr/config.json#projectName',
        digest: canonicalDigest(evidence.projectName),
      },
      engineVersion: ENGINE_VERSION,
    });
  }
  const suggested = new Set(suggestions.map((entry) => entry.field));
  return {
    evidenceDigest,
    suggestions,
    gaps: [
      'purpose',
      'stage',
      'businessModel',
      'idealCustomer',
      'goals',
      'successMetrics',
      'guardrails',
      'knownUnknowns',
    ].filter(
      (field) => !suggested.has(field as 'purpose'),
    ) as OperatingCharterSuggestionResult['gaps'],
  };
}
