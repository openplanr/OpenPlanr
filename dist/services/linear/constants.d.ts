/**
 * Linear integration constants + id-shape validators + input-safety helpers.
 *
 * All field-limit values here are enforced at the SDK-wrapper layer in
 * `src/services/linear-service.ts` so that every caller gets the guard for
 * free. Shape validators (`isLikelyLinear*Id`) fence off stale frontmatter
 * before it reaches the Linear API.
 */
/** Credential-service provider key under which the Linear PAT is stored. */
export declare const LINEAR_CREDENTIAL_KEY: "linear";
/**
 * Linear's backend enforces per-field length limits on every create/update
 * mutation. Defend at the SDK-wrapper layer so callers don't have to think
 * about them. Names / titles: confirmed or best-known caps; descriptions:
 * conservative floors well under Linear's real ceilings (markdown + HTML
 * are both accepted; real limits are in the tens of thousands).
 */
export declare const LINEAR_FIELD_LIMITS: {
    /** ProjectMilestone.name — confirmed 80 by `Argument Validation Error`. */
    readonly milestoneName: 80;
    /** IssueLabel.name — Linear team labels cap ~64 chars. */
    readonly labelName: 64;
    /** Project.name — generous cap. */
    readonly projectName: 256;
    /** Issue.title — Linear issue title cap ~255. */
    readonly issueTitle: 255;
    /** Project.description — conservative floor; real Linear ceiling is higher. */
    readonly projectDescription: 50000;
    /** ProjectMilestone.description. */
    readonly milestoneDescription: 50000;
    /** IssueLabel.description — labels rarely need long descriptions. */
    readonly labelDescription: 500;
    /** Issue.description (markdown body). */
    readonly issueDescription: 65000;
};
/**
 * Truncate a string to Linear's character limit for a given field. Logs a
 * warning on truncation so the operator can spot it in the push output.
 */
export declare function truncateForLinear(value: string, maxLen: number, fieldLabel: string): string;
/**
 * Non-empty guard for required Linear name/title fields. Fails fast with an
 * actionable message before the API would reject the call.
 */
export declare function requireNonEmpty(value: string | null | undefined, fieldLabel: string): string;
/**
 * Heuristic: Linear workflow state id (uuid) vs human-readable state name.
 * The `/i` flag is intentional — Linear's API canonicalizes UUIDs to
 * lowercase, but defensive acceptance of uppercase hex matches RFC 4122
 * and protects against tools that normalize differently.
 */
export declare function isLikelyLinearWorkflowStateId(s: string): boolean;
/**
 * Validate that a value plausibly identifies a Linear issue. Two valid shapes:
 *   1. UUIDv4 (e.g. `9b2f4c3e-...`) — canonical API form
 *   2. Linear identifier (e.g. `ENG-42`) — human-readable, also accepted by `client.issue()`
 * Anything else is treated as stale/corrupted frontmatter and skipped before
 * hitting the API.
 */
export declare function isLikelyLinearIssueId(s: string): boolean;
//# sourceMappingURL=constants.d.ts.map