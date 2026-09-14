import type {
	JsonValue,
	OperateExperienceAccessLevelV1,
	OperateExperienceAttentionV1,
	OperateExperienceCycleV1,
	OperateExperienceDomainMetricV1,
	OperateExperienceEventHeadV1,
	OperateExperienceInboxItemV1,
	OperateExperienceActionV1,
	OperateExperienceOutcomeV1,
	OperateExperienceLearningV1,
	OperateExperienceEvidenceV1,
	OperateExperienceClaimV1,
	OperateExperienceRationaleV1,
	OperateExperienceHistoryV1,
	OperateExperienceReplayV1,
	OperateExperienceViewV1,
	ProtocolValidationError,
} from "../protocol/index.js";
import type { OperateSharedTruthSummaryV1 } from "./operate-review-workspace-projection-v2.mjs";

export type OperateExperienceSurfaceStatusV1 =
	OperateExperienceViewV1["status"];
export interface OperateExperienceSurfaceBaseV1 {
	ok: true;
	kind: "operate-experience-surface";
	schemaVersion: "1.0.0";
	protocolVersion: "2.0.0";
	surface:
		| "today"
		| "inbox"
		| "cycles"
		| "cycle"
		| "actions"
		| "action"
		| "evidence"
		| "outcomes"
		| "outcome"
		| "history"
		| "search"
		| "export";
	readOnly: true;
	mutationEnabled: boolean;
	scopeId: string;
	domainId: string;
	domainVersion: string;
	actorId: string;
	accessLevel: OperateExperienceAccessLevelV1;
	generatedAt: string;
	eventHead: OperateExperienceEventHeadV1;
	viewHash: string;
	truthSummary: OperateSharedTruthSummaryV1;
	status: OperateExperienceSurfaceStatusV1;
	reasonCodes: string[];
}
export type OperateExperienceTodaySurfaceV1 = OperateExperienceSurfaceBaseV1 & {
	surface: "today";
	data: {
		attention: OperateExperienceAttentionV1[];
		domainMetrics: OperateExperienceDomainMetricV1[];
		activeCycle: OperateExperienceCycleV1 | null;
		inbox: OperateExperienceInboxItemV1[];
		actions: OperateExperienceActionV1[];
		outcomes: OperateExperienceOutcomeV1[];
		allowedActions: OperateExperienceViewV1["allowedActions"];
	};
};
export type OperateExperienceSurfaceV1 = OperateExperienceSurfaceBaseV1 &
	(
		| { surface: "today"; data: OperateExperienceTodaySurfaceV1["data"] }
		| {
				surface: "inbox";
				data: {
					inbox: OperateExperienceInboxItemV1[];
					requestBinding: {
						projectId: string;
						generation: number;
						subjectId: string | null;
					};
				};
		  }
		| { surface: "cycles"; data: { cycles: OperateExperienceCycleV1[] } }
		| { surface: "cycle"; data: { cycle: OperateExperienceCycleV1 } }
		| {
				surface: "actions";
				data: {
					actions: OperateExperienceActionV1[];
					requestBinding: { projectId: string; generation: number };
				};
		  }
		| {
				surface: "action";
				data: {
					action: OperateExperienceActionV1;
				};
		  }
		| {
				surface: "evidence";
				data: {
					evidence: OperateExperienceEvidenceV1[];
					claims: OperateExperienceClaimV1[];
					rationale: OperateExperienceRationaleV1[];
				};
		  }
		| {
				surface: "outcomes";
				data: {
					domainMetrics: OperateExperienceDomainMetricV1[];
					outcomes: OperateExperienceOutcomeV1[];
					learnings: OperateExperienceLearningV1[];
				};
		  }
		| {
				surface: "outcome";
				data: {
					outcome: OperateExperienceOutcomeV1;
					learnings: OperateExperienceLearningV1[];
				};
		  }
		| {
				surface: "history";
				data: {
					history: OperateExperienceHistoryV1[];
					replay: OperateExperienceReplayV1;
				};
		  }
		| {
				surface: "search";
				data: {
					query: string;
					results: Array<{
						kind: string;
						subjectId: string;
						title: string;
						summary: string;
						state: string;
						deepLink?: string;
					}>;
				};
		  }
		| {
				surface: "export";
				data: {
					format: "json" | "html";
					mediaType: "application/json" | "text/html; charset=utf-8";
					content: string;
				};
		  }
	);

export function validateOperateExperienceSurfaceV1(
	value: unknown,
): ProtocolValidationError[];
export function assertOperateExperienceSurfaceV1<T>(value: T): T;
export const OPERATE_EXPERIENCE_SURFACE_SCHEMA_V1: Readonly<
	Record<string, JsonValue>
>;
