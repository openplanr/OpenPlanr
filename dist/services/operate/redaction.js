import { sha256Digest } from './canonical.js';
import { OperateError, } from './types.js';
const SENSITIVITY_RANK = {
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
const EMBEDDED_INSTRUCTION_PATTERNS = [
    {
        label: 'instruction-override',
        pattern: /\b(?:ignore|disregard|override|forget)\s+(?:all\s+)?(?:previous|prior|system|developer|user)\s+(?:instructions?|messages?|prompts?)\b/gi,
        risk: 'annotate',
    },
    {
        label: 'role-control-marker',
        pattern: /(?:<\s*\/?\s*(?:system|assistant|developer|tool)\b|\[\s*INST\s*]|\b(?:system|developer)\s+(?:message|prompt)\s*:)/gi,
        risk: 'annotate',
    },
    {
        label: 'identity-override',
        pattern: /\b(?:you are now|act as|pretend to be|switch roles? to)\b/gi,
        risk: 'annotate',
    },
    {
        label: 'output-control',
        pattern: /\b(?:return|respond|reply|output)\s+(?:only|exactly|with)\b|\bdo not (?:mention|reveal|disclose)\b/gi,
        risk: 'annotate',
    },
    {
        label: 'secret-exfiltration',
        pattern: /\b(?:read|print|dump|reveal|exfiltrate|upload|send)\b[\s\S]{0,96}\b(?:process\.env|environment variables?|credentials?|secrets?|tokens?|private keys?)\b/gi,
        risk: 'quarantine',
    },
    {
        label: 'tool-invocation-directive',
        pattern: /\b(?:call|invoke|use|run)\s+(?:the\s+)?(?:shell|terminal|browser|network|file|filesystem)\s+(?:tool|command)\b/gi,
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
const REDACTION_SENTINEL = '[REDACTED]';
const REDACTION_SENTINEL_SOURCE = String.raw `\[REDACTED(?:_[A-Z_]+)?\]`;
const COMPLETE_REDACTED_VALUE = new RegExp(String.raw `^(?:"${REDACTION_SENTINEL_SOURCE}"|'${REDACTION_SENTINEL_SOURCE}'|${REDACTION_SENTINEL_SOURCE})(?:[ \t]*[,;])?(?:[ \t]+(?:#|//).*)?[ \t]*$`);
const ENVIRONMENT_SECRET_KEY_SOURCE = '(?:[A-Za-z0-9]+[_-])*(?:SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY)(?:[_-][A-Za-z0-9]+)*';
const STRUCTURED_SECRET_KEY_SOURCE = '(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|secret|token)';
const DETECTION_CATEGORY = {
    'secret-assignment': { category: 'assignment', hardBlock: false },
    'known-token': { category: 'known-token', hardBlock: true },
    authorization: { category: 'authorization', hardBlock: true },
    'private-key': { category: 'private-key', hardBlock: true },
    jwt: { category: 'jwt', hardBlock: true },
    'credential-url': { category: 'credential-url', hardBlock: true },
    'structured-secret': { category: 'structured-secret', hardBlock: false },
};
function isCompleteRedactedValue(value) {
    return COMPLETE_REDACTED_VALUE.test(value);
}
function closingQuoteIndex(value, quote) {
    for (let index = 1; index < value.length; index += 1) {
        if (value[index] !== quote)
            continue;
        let backslashes = 0;
        for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
            backslashes += 1;
        }
        if (backslashes % 2 === 0)
            return index;
    }
    return -1;
}
function redactAssignmentValue(value) {
    if (isCompleteRedactedValue(value))
        return value;
    const first = value[0];
    if (first === '"' || first === "'") {
        const closing = closingQuoteIndex(value, first);
        if (closing >= 0) {
            return `${first}${REDACTION_SENTINEL}${first}${value.slice(closing + 1)}`;
        }
    }
    const comment = value.match(/[ \t]+(?:#|\/\/).*$/)?.[0] ?? '';
    return `${REDACTION_SENTINEL}${comment}`;
}
function assignmentReplacement(match, ...capturesAndContext) {
    const prefix = capturesAndContext[0];
    const value = capturesAndContext[1];
    if (typeof prefix !== 'string' || typeof value !== 'string')
        return match;
    return `${prefix}${redactAssignmentValue(value)}`;
}
function structuredSecretReplacement(match, ...capturesAndContext) {
    const prefix = capturesAndContext[0];
    const value = capturesAndContext[1];
    if (typeof prefix !== 'string' || typeof value !== 'string')
        return match;
    if (isCompleteRedactedValue(value))
        return match;
    const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
    return `${prefix}${quote}${REDACTION_SENTINEL}${quote}`;
}
function applyRedaction(value, candidate) {
    if (typeof candidate.replacement === 'string') {
        return value.replace(candidate.pattern, candidate.replacement);
    }
    return value.replace(candidate.pattern, candidate.replacement);
}
const SECRET_PATTERNS = [
    {
        label: 'private-key',
        pattern: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/g,
        replacement: '[REDACTED_PRIVATE_KEY]',
    },
    {
        label: 'authorization',
        pattern: /\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+\S+/gi,
        replacement: 'authorization: [REDACTED]',
    },
    {
        label: 'known-token',
        pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|lin_api_[A-Za-z0-9_-]{20,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|[sr]k_live_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g,
        replacement: '[REDACTED_TOKEN]',
    },
    {
        label: 'jwt',
        pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
        replacement: '[REDACTED_JWT]',
    },
    {
        label: 'secret-assignment',
        pattern: new RegExp(String.raw `^([ \t]*(?:export[ \t]+)?${ENVIRONMENT_SECRET_KEY_SOURCE}[ \t]*[=:][ \t]*)(\S.*)$`, 'gim'),
        replacement: assignmentReplacement,
        sensitiveCapture: 2,
    },
    {
        label: 'structured-secret',
        pattern: new RegExp(String.raw `((?:"|')?${STRUCTURED_SECRET_KEY_SOURCE}(?:"|')?[ \t]*[:=][ \t]*)("${REDACTION_SENTINEL_SOURCE}"|'${REDACTION_SENTINEL_SOURCE}'|${REDACTION_SENTINEL_SOURCE}|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,}\]\r\n#]+)`, 'gi'),
        replacement: structuredSecretReplacement,
        sensitiveCapture: 2,
    },
    {
        label: 'credential-url',
        pattern: /\b(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi,
        replacement: '$1[REDACTED]@',
    },
];
const PII_PATTERNS = [
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
export function compareSensitivity(left, right) {
    return SENSITIVITY_RANK[left] - SENSITIVITY_RANK[right];
}
export function maximumSensitivity(values) {
    return values.reduce((maximum, value) => (compareSensitivity(value, maximum) > 0 ? value : maximum), 'public');
}
export function assertSensitivityAllowed(sensitivity, ceiling) {
    if (compareSensitivity(sensitivity, ceiling) > 0) {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', `Evidence sensitivity ${sensitivity} exceeds the configured ${ceiling} ceiling.`);
    }
}
export function normalizeUntrustedText(value) {
    return value.normalize('NFC').replace(ANSI_ESCAPE, '').replace(BIDI_AND_INVISIBLE, '');
}
/**
 * Truncate by UTF-16 storage units without splitting a valid Unicode scalar.
 *
 * Operating evidence is later serialized with RFC 8785/JCS, which correctly
 * rejects lone surrogate units. JavaScript's String#slice can manufacture one
 * when a supplementary character (for example an emoji) straddles the limit.
 */
export function truncateUnicodeScalarText(value, maximumCodeUnits) {
    if (!Number.isSafeInteger(maximumCodeUnits) || maximumCodeUnits < 0) {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'Text truncation requires a non-negative safe-integer limit.');
    }
    if (value.length <= maximumCodeUnits)
        return value;
    const truncated = value.slice(0, maximumCodeUnits);
    const finalUnit = truncated.charCodeAt(truncated.length - 1);
    return finalUnit >= 0xd800 && finalUnit <= 0xdbff ? truncated.slice(0, -1) : truncated;
}
/**
 * Classify instruction-shaped text before it is exposed through a bounded mandate read.
 *
 * Evidence is allowed to discuss prompts and tools, so ordinary control-like
 * prose is annotated and then inert-framed. Direct tool/credential
 * exfiltration instructions are quarantined instead of being sent to a model.
 */
export function inspectEmbeddedInstructions(input) {
    const value = normalizeUntrustedText(input);
    const annotations = [];
    let quarantined = false;
    for (const candidate of EMBEDDED_INSTRUCTION_PATTERNS) {
        candidate.pattern.lastIndex = 0;
        if (!candidate.pattern.test(value))
            continue;
        annotations.push(candidate.label);
        quarantined ||= candidate.risk === 'quarantine';
    }
    return {
        annotations: [...new Set(annotations)].sort(),
        quarantined,
    };
}
/**
 * Redact, inspect, and deterministically frame one evidence excerpt.
 *
 * The digest-derived boundary prevents evidence from manufacturing a matching
 * closing marker. The framed value remains untrusted citation text inside the
 * runtime mandate and is never promoted to a system/developer instruction.
 */
export function prepareAdvisorEvidenceText(input) {
    if (Buffer.byteLength(input.value, 'utf8') > 16 * 1024) {
        return {
            value: '',
            annotations: ['oversized-evidence'],
            quarantined: true,
            reason: 'Evidence excerpt exceeds the bounded mandate-citation size.',
        };
    }
    let redacted;
    try {
        redacted = redactSensitiveText(input.value);
    }
    catch {
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
    const token = sha256Digest(Buffer.from(`${input.evidenceId}\0${input.digest}\0${redacted.inputDigest}`)).slice('sha256:'.length, 'sha256:'.length + 20);
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
export function redactSensitiveText(input, options = {}) {
    const inputDigest = sha256Digest(Buffer.from(input));
    let value = normalizeUntrustedText(input);
    const redactions = [];
    for (const candidate of [
        ...SECRET_PATTERNS,
        ...(options.redactPii === false ? [] : PII_PATTERNS),
    ]) {
        candidate.pattern.lastIndex = 0;
        if (candidate.pattern.test(value)) {
            redactions.push(candidate.label);
            candidate.pattern.lastIndex = 0;
            value = applyRedaction(value, candidate);
        }
    }
    const residual = detectSecretMetadata(value);
    if (residual.length > 0) {
        throw new OperateError('E_OPERATE_SECRET_DETECTED', 'Evidence still contains a secret-like value after redaction.', {
            ruleId: residual[0]?.ruleId,
            category: residual[0]?.category,
            line: residual[0]?.line,
            hardBlock: residual[0]?.hardBlock,
            contentDigest: inputDigest,
            valueDisclosed: false,
        });
    }
    return { value, redactions: [...new Set(redactions)].sort(), inputDigest };
}
export function detectSecretMetadata(value) {
    const detections = [];
    for (const { label, pattern, sensitiveCapture } of SECRET_PATTERNS) {
        pattern.lastIndex = 0;
        let match = pattern.exec(value);
        while (match) {
            const sensitiveValue = sensitiveCapture === undefined ? match[0] : (match[sensitiveCapture] ?? match[0]);
            if (!isCompleteRedactedValue(sensitiveValue)) {
                const policy = DETECTION_CATEGORY[label] ?? {
                    category: 'structured-secret',
                    hardBlock: false,
                };
                detections.push({
                    ruleId: `${label}.v1`,
                    category: policy.category,
                    line: value.slice(0, match.index).split('\n').length,
                    hardBlock: policy.hardBlock,
                });
            }
            if (!pattern.global)
                break;
            match = pattern.exec(value);
        }
    }
    return detections.sort((left, right) => left.line - right.line || left.ruleId.localeCompare(right.ruleId));
}
export function containsSecret(value) {
    return detectSecretMetadata(value).length > 0;
}
export function sanitizeEvidenceItem(input) {
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
        summary: truncateUnicodeScalarText(redacted.value, 4_096),
    };
}
export function sanitizeGeneratedPlainText(value) {
    const redacted = redactSensitiveText(value);
    return redacted.value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '[REMOVED_SCRIPT]')
        .replace(/\b(?:javascript|vbscript):/gi, 'blocked:')
        .replace(/!\[[^\]]*]\((?:https?:|data:)[^)]+\)/gi, '[REMOTE_IMAGE_REMOVED]');
}
//# sourceMappingURL=redaction.js.map