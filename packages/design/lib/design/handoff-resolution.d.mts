export type DesignReviewResolutionOutcome =
	| "accepted"
	| "open"
	| "blocking"
	| "deferred"
	| "declined";
export type DesignReviewResolutionStatus =
	| "ready"
	| "attention"
	| "blocked"
	| "stale";

export interface DesignHandoffResolutionInput {
	currentReviewOf?: string | null;
	historyComplete?: boolean;
	synchronizationPending?: boolean;
	synchronizationIssues?: Array<{
		reason?: string;
		pinId?: string;
		revisionId?: string;
	}>;
	pins?: Array<
		Record<string, unknown> & {
			id: string;
			reviewId?: string;
			revisionId?: string;
			reviewOf: string;
			stale?: boolean;
			screenId?: string;
			elementId?: string;
		}
	>;
	metadata?: {
		version?: number;
		categories?: Record<string, string>;
		dispositions?: Record<string, string | Record<string, unknown>>;
		byRevision?: Record<
			string,
			{
				categories?: Record<string, string>;
				dispositions?: Record<string, string | Record<string, unknown>>;
			}
		>;
	};
}

export interface DesignHandoffResolution {
	kind: "openplanr-design-handoff-resolution";
	schemaVersion: "1.0.0";
	currentReviewOf: string | null;
	status: DesignReviewResolutionStatus;
	complete: boolean;
	items: Array<
		Record<string, unknown> & {
			id: string;
			pinId: string;
			revisionId: string;
			reviewOf: string;
			current: boolean;
			outcome: DesignReviewResolutionOutcome;
			implementationScope: boolean;
		}
	>;
	implementationScope: string[];
	diagnostics: Array<
		Record<string, unknown> & { code: string; severity: "blocked" | "stale" }
	>;
}

export declare function compileDesignHandoffResolution(
	input?: DesignHandoffResolutionInput | null,
): DesignHandoffResolution;
export declare function designHandoffResolutionDigest(
	value: DesignHandoffResolution,
): `sha256:${string}`;
export declare function canApproveDesignHandoffResolution(
	value?: DesignHandoffResolution | null,
): boolean;
