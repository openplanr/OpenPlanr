import { type CitationBearingProposal, type CitationResolutionContext, type ProposalCitationEnforcement } from '../citation-resolution.js';
import { type GuidedConfirmation, type OperatingActionEffect, type StructuredOperatingAction } from '../types.js';
import { type OperatingConfirmationMaterial } from './confirmation-service.js';
export declare function createOperatingAction(input: {
    id: string;
    label: string;
    description?: string;
    command: string;
    effect: OperatingActionEffect;
    providerUse?: boolean;
    recommended?: boolean;
    confirmation?: Omit<OperatingConfirmationMaterial, 'actionId' | 'command' | 'effect' | 'providerUse'>;
}): Promise<{
    action: StructuredOperatingAction;
    confirmation: GuidedConfirmation | null;
}>;
/**
 * Citation gate for the `adapter record`/`finalize` steps (FR3/E-003).
 *
 * After a native advisor returns, but before its proposals can reach
 * `consolidation.ts`, every citation each proposal carries is resolved and
 * snapshotted against the cycle's pinned revision. A proposal whose citations
 * all resolve is returned in `accepted` with the minted evidence IDs attached; a
 * proposal with ANY unresolvable citation is dropped and a single
 * unresolvable-citation gap is opened in its place. The record/finalize step
 * persists `accepted` and the opened `gaps`, so a proposal built on a
 * fabricated, drifted, or uncommitted citation can never reach consolidation.
 *
 * The full resolution/precedence/snapshot logic lives in `citation-resolution.ts`;
 * this is the wiring seam the record/finalize path invokes.
 */
export declare function enforceRecordedProposalCitations<P extends CitationBearingProposal>(proposals: readonly P[], context: CitationResolutionContext): Promise<ProposalCitationEnforcement<P>>;
export declare function sanitizeActionDestination(projectRoot: string, target: string): string;
//# sourceMappingURL=action-service.d.ts.map