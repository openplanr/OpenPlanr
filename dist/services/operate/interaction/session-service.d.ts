import { type GuidedAnswer, type GuidedQuestionnaire, type GuidedSession, type GuidedSessionState } from '../types.js';
export declare const GUIDED_SESSION_TTL_MS: number;
export declare const GUIDED_ANSWER_MAX_BYTES: number;
export interface GuidedSessionBindings {
    projectIdentity: `sha256:${string}`;
    projectHead: `sha256:${string}`;
    configHead: `sha256:${string}`;
}
export declare function createGuidedSessionId(): string;
export declare function currentGuidedSessionBindings(projectRoot: string): Promise<GuidedSessionBindings>;
export declare function createGuidedSession(input: {
    projectRoot: string;
    questionnaire: GuidedQuestionnaire;
    persistedAnswers?: GuidedAnswer[];
    localRoot?: string;
    now?: Date;
}): Promise<GuidedSession>;
export declare function readGuidedSession(input: {
    projectRoot: string;
    sessionId: string;
    localRoot?: string;
    now?: Date;
    bindings?: GuidedSessionBindings;
}): Promise<GuidedSession>;
export declare function updateGuidedSession(input: {
    projectRoot: string;
    session: GuidedSession;
    localRoot?: string;
}): Promise<void>;
export declare function cancelGuidedSession(input: {
    projectRoot: string;
    sessionId: string;
    localRoot?: string;
}): Promise<{
    sessionId: string;
    state: 'cancelled';
    removed: true;
}>;
export declare function guidedSessionStatus(input: {
    projectRoot: string;
    localRoot?: string;
    now?: Date;
}): Promise<{
    active: number;
    expired: number;
    files: number;
}>;
export declare function purgeGuidedSessions(input: {
    projectRoot: string;
    localRoot?: string;
}): Promise<{
    removed: number;
}>;
export declare function guidedSessionState(session: GuidedSession, state: GuidedSessionState, now: Date, values?: Partial<GuidedSession>): GuidedSession;
//# sourceMappingURL=session-service.d.ts.map