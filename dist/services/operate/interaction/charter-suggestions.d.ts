declare const ENGINE_VERSION = "1.0.0";
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
    gaps: Array<'purpose' | 'stage' | 'businessModel' | 'idealCustomer' | 'goals' | 'successMetrics' | 'guardrails' | 'knownUnknowns'>;
}
/**
 * Produce bounded, provider-free charter drafts from local metadata.
 *
 * Only purpose is eligible at launch. Product stage, commercial facts,
 * customers, goals, metrics, guardrails, and unknowns remain human-owned.
 */
export declare function buildOperatingCharterSuggestions(input: {
    projectRoot: string;
}): Promise<OperatingCharterSuggestionResult>;
export {};
//# sourceMappingURL=charter-suggestions.d.ts.map