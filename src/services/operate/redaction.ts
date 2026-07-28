import { sha256Digest } from './canonical.js';
import {
  type CollectedEvidenceItem,
  OperateError,
  type OperatingEvidenceItem,
  type OperatingSensitivity,
} from './types.js';

const SENSITIVITY_RANK: Record<OperatingSensitivity, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

const BIDI_AND_INVISIBLE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: untrusted evidence must strip C0/C1 and bidi controls.
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI stripping intentionally recognizes ESC and BEL.
const ANSI_ESCAPE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

const EMBEDDED_INSTRUCTION_PATTERNS: Array<{
  label: string;
  pattern: RegExp;
  risk: 'annotate' | 'quarantine';
}> = [
  {
    label: 'instruction-override',
    pattern:
      /\b(?:ignore|disregard|override|forget)\s+(?:all\s+)?(?:previous|prior|system|developer|user)\s+(?:instructions?|messages?|prompts?)\b/gi,
    risk: 'annotate',
  },
  {
    label: 'role-control-marker',
    pattern:
      /(?:<\s*\/?\s*(?:system|assistant|developer|tool)\b|\[\s*INST\s*]|\b(?:system|developer)\s+(?:message|prompt)\s*:)/gi,
    risk: 'annotate',
  },
  {
    label: 'identity-override',
    pattern: /\b(?:you are now|act as|pretend to be|switch roles? to)\b/gi,
    risk: 'annotate',
  },
  {
    label: 'output-control',
    pattern:
      /\b(?:return|respond|reply|output)\s+(?:only|exactly|with)\b|\bdo not (?:mention|reveal|disclose)\b/gi,
    risk: 'annotate',
  },
  {
    label: 'secret-exfiltration',
    pattern:
      /\b(?:read|print|dump|reveal|exfiltrate|upload|send)\b[\s\S]{0,96}\b(?:process\.env|environment variables?|credentials?|secrets?|tokens?|private keys?)\b/gi,
    risk: 'quarantine',
  },
  {
    label: 'tool-invocation-directive',
    pattern:
      /\b(?:call|invoke|use|run)\s+(?:the\s+)?(?:shell|terminal|browser|network|file|filesystem)\s+(?:tool|command)\b/gi,
    risk: 'annotate',
  },
  {
    label: 'remote-execution-text',
    pattern: /\b(?:curl|wget)\s+https?:\/\/|\b(?:eval|exec)\s*\(/gi,
    risk: 'annotate',
  },
  {
    label: 'obfuscated-execution-directive',
    pattern: /\batob\s*\([\s\S]{0,256}\b(?:eval|exec)\b/gi,
    risk: 'quarantine',
  },
];

const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp; replacement: string }> = [
  {
    label: 'private-key',
    pattern:
      /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  {
    label: 'authorization',
    pattern: /\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+\S+/gi,
    replacement: 'authorization: [REDACTED]',
  },
  {
    label: 'known-token',
    pattern:
      /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|lin_api_[A-Za-z0-9_-]{20,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|[sr]k_live_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g,
    replacement: '[REDACTED_TOKEN]',
  },
  {
    label: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: '[REDACTED_JWT]',
  },
  {
    label: 'secret-assignment',
    pattern:
      /^([ \t]*(?:export[ \t]+)?[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY)[A-Za-z0-9_]*[ \t]*[=:][ \t]*)(.+)$/gim,
    replacement: '$1[REDACTED]',
  },
  {
    label: 'structured-secret',
    pattern:
      /((?:"|')?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|secret|token)(?:"|')?[ \t]*[:=][ \t]*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,}\]\r\n#]+)/gi,
    replacement: '$1"[REDACTED]"',
  },
  {
    label: 'credential-url',
    pattern: /\b(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi,
    replacement: '$1[REDACTED]@',
  },
];

const PII_PATTERNS: Array<{ label: string; pattern: RegExp; replacement: string }> = [
  {
    label: 'email',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '[REDACTED_EMAIL]',
  },
  {
    label: 'user-home',
    pattern: /(?:\/Users\/|\/home\/)[^/\s"'`]+/g,
    replacement: '/home/[REDACTED_USER]',
  },
  {
    label: 'windows-home',
    pattern: /\b[A-Z]:\\Users\\[^\\\s"'`]+/gi,
    replacement: 'C:\\Users\\[REDACTED_USER]',
  },
];

export function compareSensitivity(
  left: OperatingSensitivity,
  right: OperatingSensitivity,
): number {
  return SENSITIVITY_RANK[left] - SENSITIVITY_RANK[right];
}

export function maximumSensitivity(values: readonly OperatingSensitivity[]): OperatingSensitivity {
  return values.reduce<OperatingSensitivity>(
    (maximum, value) => (compareSensitivity(value, maximum) > 0 ? value : maximum),
    'public',
  );
}

export function assertSensitivityAllowed(
  sensitivity: OperatingSensitivity,
  ceiling: OperatingSensitivity,
): void {
  if (compareSensitivity(sensitivity, ceiling) > 0) {
    throw new OperateError(
      'E_OPERATE_EVIDENCE_REJECTED',
      `Evidence sensitivity ${sensitivity} exceeds the configured ${ceiling} ceiling.`,
    );
  }
}

export function normalizeUntrustedText(value: string): string {
  return value.normalize('NFC').replace(ANSI_ESCAPE, '').replace(BIDI_AND_INVISIBLE, '');
}

export interface RedactionResult {
  value: string;
  redactions: string[];
  inputDigest: `sha256:${string}`;
}

export interface EmbeddedInstructionInspection {
  annotations: string[];
  quarantined: boolean;
}

/**
 * Classify instruction-shaped text before it is placed in an advisor pack.
 *
 * Evidence is allowed to discuss prompts and tools, so ordinary control-like
 * prose is annotated and then inert-framed. Direct tool/credential
 * exfiltration instructions are quarantined instead of being sent to a model.
 */
export function inspectEmbeddedInstructions(input: string): EmbeddedInstructionInspection {
  const value = normalizeUntrustedText(input);
  const annotations: string[] = [];
  let quarantined = false;
  for (const candidate of EMBEDDED_INSTRUCTION_PATTERNS) {
    candidate.pattern.lastIndex = 0;
    if (!candidate.pattern.test(value)) continue;
    annotations.push(candidate.label);
    quarantined ||= candidate.risk === 'quarantine';
  }
  return {
    annotations: [...new Set(annotations)].sort(),
    quarantined,
  };
}

export interface AdvisorEvidenceText {
  value: string;
  annotations: string[];
  quarantined: boolean;
  reason: string | null;
}

/**
 * Redact, inspect, and deterministically frame one evidence excerpt.
 *
 * The digest-derived boundary prevents evidence from manufacturing a matching
 * closing marker. The framed value remains plain text inside the JSON advisor
 * pack and is never promoted to a system/developer instruction.
 */
export function prepareAdvisorEvidenceText(input: {
  evidenceId: string;
  digest: `sha256:${string}`;
  value: string;
}): AdvisorEvidenceText {
  if (Buffer.byteLength(input.value, 'utf8') > 16 * 1024) {
    return {
      value: '',
      annotations: ['oversized-evidence'],
      quarantined: true,
      reason: 'Evidence excerpt exceeds the bounded advisor-pack size.',
    };
  }
  let redacted: RedactionResult;
  try {
    redacted = redactSensitiveText(input.value);
  } catch {
    return {
      value: '',
      annotations: ['unredactable-sensitive-content'],
      quarantined: true,
      reason: 'Evidence could not be safely redacted for advisor use.',
    };
  }
  const inspection = inspectEmbeddedInstructions(redacted.value);
  const annotations = [
    ...inspection.annotations,
    ...(redacted.redactions.length > 0 ? ['sensitive-content-redacted'] : []),
  ].sort();
  if (inspection.quarantined) {
    return {
      value: '',
      annotations,
      quarantined: true,
      reason: 'Evidence contains a direct tool, execution, or secret-exfiltration instruction.',
    };
  }
  const token = sha256Digest(
    Buffer.from(`${input.evidenceId}\0${input.digest}\0${redacted.inputDigest}`),
  ).slice('sha256:'.length, 'sha256:'.length + 20);
  const opening = `<<<OPENPLANR_UNTRUSTED_EVIDENCE:${token}>>>`;
  const closing = `<<<END_OPENPLANR_UNTRUSTED_EVIDENCE:${token}>>>`;
  const escaped = redacted.value
    .replaceAll(opening, '[ESCAPED_EVIDENCE_BOUNDARY]')
    .replaceAll(closing, '[ESCAPED_EVIDENCE_BOUNDARY]');
  return {
    value: [
      opening,
      `evidence_id=${input.evidenceId}`,
      `annotations=${annotations.length > 0 ? annotations.join(',') : 'none'}`,
      escaped,
      closing,
    ].join('\n'),
    annotations,
    quarantined: false,
    reason: null,
  };
}

export function redactSensitiveText(
  input: string,
  options: { redactPii?: boolean } = {},
): RedactionResult {
  const inputDigest = sha256Digest(Buffer.from(input));
  let value = normalizeUntrustedText(input);
  const redactions: string[] = [];
  for (const candidate of [
    ...SECRET_PATTERNS,
    ...(options.redactPii === false ? [] : PII_PATTERNS),
  ]) {
    candidate.pattern.lastIndex = 0;
    if (candidate.pattern.test(value)) {
      redactions.push(candidate.label);
      candidate.pattern.lastIndex = 0;
      value = value.replace(candidate.pattern, candidate.replacement);
    }
  }
  if (containsSecret(value)) {
    throw new OperateError(
      'E_OPERATE_SECRET_DETECTED',
      'Evidence still contains a secret-like value after redaction.',
    );
  }
  return { value, redactions: [...new Set(redactions)].sort(), inputDigest };
}

export function containsSecret(value: string): boolean {
  const candidate = value
    .replace(
      /(?:"|')?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|secret|token)(?:"|')?[ \t]*[:=][ \t]*(?:"|')?\[REDACTED(?:_[A-Z_]+)?\](?:"|')?/gi,
      '',
    )
    .replace(/\[REDACTED(?:_[A-Z_]+)?\]/g, '');
  return SECRET_PATTERNS.some(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(candidate);
  });
}

export function sanitizeEvidenceItem(input: CollectedEvidenceItem): OperatingEvidenceItem {
  const redacted = redactSensitiveText(input.content);
  const repository = input.repository
    ? {
        componentId: input.repository.componentId,
        canonicalRemote: input.repository.canonicalRemote,
        revision: input.repository.revision,
        configuredBranch: input.repository.configuredBranch,
        dirtyFingerprint: input.repository.dirtyFingerprint,
      }
    : undefined;
  return {
    id: input.id,
    source: input.source,
    location: input.location,
    digest: sha256Digest(redacted.value),
    collectedAt: input.collectedAt,
    observedFrom: input.observedFrom ?? null,
    observedTo: input.observedTo ?? null,
    freshness: input.freshness,
    sensitivity: input.sensitivity,
    claimTypes: [...new Set(input.claimTypes)].sort(),
    ...(repository ? { repository } : {}),
    ...(input.metric
      ? {
          metric: {
            identity: sanitizeGeneratedPlainText(input.metric.identity),
            query: sanitizeGeneratedPlainText(input.metric.query),
            observedFrom: input.metric.observedFrom,
            observedTo: input.metric.observedTo,
          },
        }
      : {}),
    summary: redacted.value.slice(0, 4_096),
  };
}

export function sanitizeGeneratedPlainText(value: string): string {
  const redacted = redactSensitiveText(value);
  return redacted.value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '[REMOVED_SCRIPT]')
    .replace(/\b(?:javascript|vbscript):/gi, 'blocked:')
    .replace(/!\[[^\]]*]\((?:https?:|data:)[^)]+\)/gi, '[REMOTE_IMAGE_REMOVED]');
}
