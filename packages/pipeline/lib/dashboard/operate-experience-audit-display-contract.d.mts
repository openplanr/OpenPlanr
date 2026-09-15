import type {
	OperateExperienceClaimV1,
	OperateExperienceDomainMetricV1,
	OperateExperienceEvidenceV1,
	OperateExperienceHistoryV1,
	OperateExperienceLearningV1,
	OperateExperienceOutcomeV1,
	OperateExperienceRationaleV1,
	OperateExperienceReplayV1,
	ProtocolValidationError,
} from "../protocol/index.js";
import type { OperateExperienceSurfaceBaseV1 } from "./operate-experience-surface-contract.mjs";

export type OperateAuditEventHeadV1 =
	| Readonly<{ sequence: 0; hash: null }>
	| Readonly<{ sequence: number; hash: string }>;

type NullableDeepLink<T extends object> = Readonly<
	Omit<T, "deepLink"> & { deepLink: string | null }
>;

export type OperateAuditDisplayBindingV1 = Readonly<{
	actorId: string;
	scopeId: string;
	domainId: string;
	domainVersion: string;
	cycleId: string;
	subjectId: string | null;
	surface:
		| "evidence"
		| "outcomes"
		| "outcome"
		| "history"
		| "search"
		| "export";
	query: string | null;
	format: "json" | "html" | null;
	generatedAt: string;
	eventHead: OperateAuditEventHeadV1;
	viewHash: string;
}>;

export type OperateAuditDisplayIntegrityV1 = Readonly<{
	algorithm: "sha-256-jcs";
	domain: "openplanr:operate-experience-audit-display-surface:1.0.0";
	sourceViewHash: string;
	contentHash: string;
}>;

export type OperateAuditEvidenceV1 = Readonly<
	Omit<OperateExperienceEvidenceV1, "deepLink" | "causalLinks"> & {
		deepLink: string | null;
		causalLinks: readonly NullableDeepLink<
			OperateExperienceEvidenceV1["causalLinks"][number]
		>[];
	}
>;

export type OperateAuditClaimV1 = Readonly<
	Omit<OperateExperienceClaimV1, "deepLink" | "causalLinks"> & {
		deepLink: string | null;
		causalLinks: readonly NullableDeepLink<
			OperateExperienceClaimV1["causalLinks"][number]
		>[];
	}
>;

export type OperateAuditDomainMetricV1 = Readonly<
	Omit<OperateExperienceDomainMetricV1, "dueVerification"> & {
		dueVerification: readonly NullableDeepLink<
			OperateExperienceDomainMetricV1["dueVerification"][number]
		>[];
	}
>;

export type OperateAuditOutcomeV1 = Readonly<
	Omit<
		OperateExperienceOutcomeV1,
		"deepLink" | "decision" | "execution" | "rollback"
	> & {
		deepLink: string | null;
		decision: null | NullableDeepLink<
			NonNullable<OperateExperienceOutcomeV1["decision"]>
		>;
		execution: readonly NullableDeepLink<
			OperateExperienceOutcomeV1["execution"][number]
		>[];
		rollback: readonly NullableDeepLink<
			OperateExperienceOutcomeV1["rollback"][number]
		>[];
	}
>;

type AuditPayloadBase = Readonly<
	Omit<
		OperateExperienceSurfaceBaseV1,
		"surface" | "mutationEnabled" | "eventHead"
	> & {
		mutationEnabled: false;
		eventHead: OperateAuditEventHeadV1;
	}
>;

type OperateAuditReplayV1 = Readonly<
	Omit<OperateExperienceReplayV1, "checkpoint" | "finalHead"> & {
		checkpoint: null | Readonly<
			Omit<
				NonNullable<OperateExperienceReplayV1["checkpoint"]>,
				"eventHead"
			> & { eventHead: OperateAuditEventHeadV1 }
		>;
		finalHead: OperateAuditEventHeadV1;
	}
>;

export type OperateExperienceAuditDisplaySurfacePayloadV1 = AuditPayloadBase &
	(
		| Readonly<{
				surface: "evidence";
				data: Readonly<{
					evidence: readonly OperateAuditEvidenceV1[];
					claims: readonly OperateAuditClaimV1[];
					rationale: readonly OperateExperienceRationaleV1[];
				}>;
		  }>
		| Readonly<{
				surface: "outcomes";
				data: Readonly<{
					domainMetrics: readonly OperateAuditDomainMetricV1[];
					outcomes: readonly OperateAuditOutcomeV1[];
					learnings: readonly OperateExperienceLearningV1[];
				}>;
		  }>
		| Readonly<{
				surface: "outcome";
				data: Readonly<{
					outcome: OperateAuditOutcomeV1;
					learnings: readonly OperateExperienceLearningV1[];
				}>;
		  }>
		| Readonly<{
				surface: "history";
				data: Readonly<{
					history: readonly OperateExperienceHistoryV1[];
					replay: OperateAuditReplayV1;
				}>;
		  }>
		| Readonly<{
				surface: "search";
				data: Readonly<{
					query: string;
					results: readonly Readonly<{
						kind: string;
						subjectId: string;
						title: string;
						summary: string;
						state: string;
						deepLink?: string;
					}>[];
				}>;
		  }>
		| Readonly<{
				surface: "export";
				data: Readonly<{
					format: "json" | "html";
					mediaType: "application/json" | "text/html; charset=utf-8";
					content: string;
				}>;
		  }>
	);

export type OperateExperienceAuditDisplaySurfaceV1 = Readonly<{
	kind: "operate-experience-audit-display-surface";
	schemaVersion: "1.0.0";
	protocolVersion: "2.0.0";
	requestBinding: OperateAuditDisplayBindingV1;
	payload: OperateExperienceAuditDisplaySurfacePayloadV1;
	integrity: OperateAuditDisplayIntegrityV1;
}>;

export function validateOperateExperienceAuditDisplaySurfaceV1(
	value: unknown,
	expected?: OperateAuditDisplayBindingV1,
): ProtocolValidationError[];
export function assertOperateExperienceAuditDisplaySurfaceV1(
	value: unknown,
	expected?: OperateAuditDisplayBindingV1,
): OperateExperienceAuditDisplaySurfaceV1;
export function issueOperateExperienceAuditDisplaySurfaceV1(
	payload: OperateExperienceAuditDisplaySurfacePayloadV1,
	binding: OperateAuditDisplayBindingV1,
): OperateExperienceAuditDisplaySurfaceV1;

export const OPERATE_EXPERIENCE_AUDIT_DISPLAY_SURFACE_SCHEMA_V1: Readonly<
	Record<string, unknown>
>;
