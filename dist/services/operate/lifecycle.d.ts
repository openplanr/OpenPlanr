import { type OperatingState } from './types.js';
type Collection = 'cycles' | 'findings' | 'decisions' | 'gaps' | 'routes' | 'evidence' | 'migrations';
export declare function readOperatingCollection(input: {
    projectRoot: string;
    collection: Collection;
    id?: string;
    localRoot?: string;
}): Promise<unknown>;
export declare function readOperatingReview(input: {
    projectRoot: string;
    cycleId?: string;
    brief?: boolean;
    /**
     * FR3/E-003: render the human review gate as report Markdown (brief +
     * per-role lens reports + exact next actions) by reusing `reports.ts`'s
     * `readOperatingReport` assembly, instead of returning the raw state object a
     * machine (`--json`) surface consumes. `--json` callers omit `human` and keep
     * receiving the exact, byte-unchanged raw state.
     */
    human?: boolean;
    localRoot?: string;
}): Promise<unknown>;
/**
 * Marks elapsed decision deadlines as due for explicit owner review. This
 * transition deliberately carries no selected option and executes no default.
 */
export declare function reconcileOperatingDecisionDeadlines(input: {
    projectRoot: string;
    now?: Date;
    localRoot?: string;
}): Promise<{
    transitioned: number;
    state: OperatingState;
}>;
export declare function transitionOperatingCycle(input: {
    projectRoot: string;
    cycleId: string;
    action: 'resume' | 'cancel' | 'recover' | 'close';
    confirmed: boolean;
    localRoot?: string;
}): Promise<unknown>;
/**
 * A non-quiet operating cycle may close only after every surfaced finding has
 * either reached a terminal governance state or had its accepted route
 * applied, and every owner decision has reached a terminal state.
 */
export declare function assertOperatingCycleDisposable(state: OperatingState, cycleId: string): void;
export declare function governOperatingFinding(input: {
    projectRoot: string;
    findingId: string;
    action: 'accept' | 'reject' | 'supersede';
    confirmed: boolean;
    reason?: string;
    impact?: unknown;
    confidence?: unknown;
    ease?: unknown;
    localRoot?: string;
}): Promise<unknown>;
export declare function decideOperatingDecision(input: {
    projectRoot: string;
    decisionId: string;
    value: string;
    reason?: string;
    confirmed: boolean;
    localRoot?: string;
}): Promise<unknown>;
export declare function answerOperatingGap(input: {
    projectRoot: string;
    gapId: string;
    value: string;
    confirmed: boolean;
    localRoot?: string;
}): Promise<unknown>;
/**
 * A human answer is not evidence by itself. Verification requires explicit
 * evidence identifiers, then records verified and closed transitions before a
 * resumed cycle may rely on newly collected provider evidence.
 */
export declare function verifyOperatingGap(input: {
    projectRoot: string;
    gapId: string;
    evidenceRefs: string[];
    confirmed: boolean;
    localRoot?: string;
}): Promise<unknown>;
export declare function applyOrRollbackRoute(input: {
    projectRoot: string;
    routeId: string;
    action: 'apply' | 'rollback';
    previewDigest?: string;
    preview?: boolean;
    confirmed: boolean;
    localRoot?: string;
}): Promise<unknown>;
export {};
//# sourceMappingURL=lifecycle.d.ts.map