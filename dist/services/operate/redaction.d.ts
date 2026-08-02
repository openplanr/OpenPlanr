import { type CollectedEvidenceItem, type OperatingEvidenceItem, type OperatingSensitivity } from './types.js';
export interface SecretDetectionMetadata {
    ruleId: string;
    category: 'assignment' | 'known-token' | 'authorization' | 'private-key' | 'jwt' | 'credential-url' | 'structured-secret';
    line: number;
    hardBlock: boolean;
}
export declare function compareSensitivity(left: OperatingSensitivity, right: OperatingSensitivity): number;
export declare function maximumSensitivity(values: readonly OperatingSensitivity[]): OperatingSensitivity;
export declare function assertSensitivityAllowed(sensitivity: OperatingSensitivity, ceiling: OperatingSensitivity): void;
export declare function normalizeUntrustedText(value: string): string;
/**
 * Truncate by UTF-16 storage units without splitting a valid Unicode scalar.
 *
 * Operating evidence is later serialized with RFC 8785/JCS, which correctly
 * rejects lone surrogate units. JavaScript's String#slice can manufacture one
 * when a supplementary character (for example an emoji) straddles the limit.
 */
export declare function truncateUnicodeScalarText(value: string, maximumCodeUnits: number): string;
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
 * Classify instruction-shaped text before it is exposed through a bounded mandate read.
 *
 * Evidence is allowed to discuss prompts and tools, so ordinary control-like
 * prose is annotated and then inert-framed. Direct tool/credential
 * exfiltration instructions are quarantined instead of being sent to a model.
 */
export declare function inspectEmbeddedInstructions(input: string): EmbeddedInstructionInspection;
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
 * closing marker. The framed value remains untrusted citation text inside the
 * runtime mandate and is never promoted to a system/developer instruction.
 */
export declare function prepareAdvisorEvidenceText(input: {
    evidenceId: string;
    digest: `sha256:${string}`;
    value: string;
}): AdvisorEvidenceText;
export declare function redactSensitiveText(input: string, options?: {
    redactPii?: boolean;
}): RedactionResult;
export declare function detectSecretMetadata(value: string): SecretDetectionMetadata[];
export declare function containsSecret(value: string): boolean;
export declare function sanitizeEvidenceItem(input: CollectedEvidenceItem): OperatingEvidenceItem;
export declare function sanitizeGeneratedPlainText(value: string): string;
//# sourceMappingURL=redaction.d.ts.map