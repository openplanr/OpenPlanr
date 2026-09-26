export type CapabilityState = 'available' | 'unavailable' | 'denied';
export type ResolutionStatus = 'completed' | 'unavailable' | 'denied' | 'cancelled' | 'blocked';
export type InteractionSurface = 'native' | 'chat' | 'terminal' | 'headless';
export type ProtocolInteraction = 'native' | 'chat' | 'terminal' | 'none';
export type AnswerValue = string | boolean | ReadonlyArray<string>;
export type RuntimeCapabilityId = 'attached-terminal' | 'native-questions' | 'structured-chat';

export interface RuntimeCapabilityState {
  readonly state: CapabilityState;
  readonly source?: string;
}

export type RuntimeCapabilityReport = Readonly<
  Record<string, CapabilityState | RuntimeCapabilityState>
>;

export interface NativeHostInteractionBinding {
  readonly surface: 'native';
  readonly protocolInteraction: 'native';
  readonly capabilityId: 'native-questions';
}

export interface ChatHostInteractionBinding {
  readonly surface: 'chat';
  readonly protocolInteraction: 'chat';
  readonly capabilityId: 'structured-chat';
}

export interface TerminalHostInteractionBinding {
  readonly surface: 'terminal';
  readonly protocolInteraction: 'terminal';
  readonly capabilityId: 'attached-terminal';
}

export interface HeadlessHostInteractionBinding {
  readonly surface: 'headless';
  readonly protocolInteraction: 'none';
  readonly capabilityId?: never;
}

export type HostInteractionBinding =
  | NativeHostInteractionBinding
  | ChatHostInteractionBinding
  | TerminalHostInteractionBinding
  | HeadlessHostInteractionBinding;

export type InteractiveHostInteractionBinding =
  | NativeHostInteractionBinding
  | ChatHostInteractionBinding
  | TerminalHostInteractionBinding;

export type HostInteractionBindings =
  | readonly [HeadlessHostInteractionBinding]
  | readonly [InteractiveHostInteractionBinding]
  | readonly [InteractiveHostInteractionBinding, HeadlessHostInteractionBinding]
  | readonly [InteractiveHostInteractionBinding, InteractiveHostInteractionBinding]
  | readonly [
      InteractiveHostInteractionBinding,
      InteractiveHostInteractionBinding,
      HeadlessHostInteractionBinding,
    ]
  | readonly [
      InteractiveHostInteractionBinding,
      InteractiveHostInteractionBinding,
      InteractiveHostInteractionBinding,
    ]
  | readonly [
      InteractiveHostInteractionBinding,
      InteractiveHostInteractionBinding,
      InteractiveHostInteractionBinding,
      HeadlessHostInteractionBinding,
    ];

export interface HostProfile {
  readonly hostProfileId: string;
  readonly hostProfileVersion: string;
  readonly host: 'claude-code' | 'codex' | 'cursor' | 'pipeline';
  readonly runtimeCapabilities: ReadonlyArray<RuntimeCapabilityId>;
  readonly interactionBindings: HostInteractionBindings;
  readonly [key: string]: unknown;
}

export interface CapabilityResult {
  readonly capabilityId: string;
  readonly requirement: 'required' | 'optional';
  readonly state: CapabilityState;
  readonly declared: boolean;
  readonly source: string;
}

export interface RuntimeDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly repair: string | null;
  readonly [key: string]: unknown;
}

export interface CapabilityResolution {
  readonly status: 'completed' | 'unavailable' | 'denied';
  readonly host: string | null;
  readonly hostProfileId: string;
  readonly hostProfileVersion: string | null;
  readonly declaredCapabilities: ReadonlyArray<string>;
  readonly required: ReadonlyArray<CapabilityResult>;
  readonly optional: ReadonlyArray<CapabilityResult>;
  readonly diagnostic: RuntimeDiagnostic;
}

export interface GuidedQuestion {
  readonly kind: 'guided-question';
  readonly schemaVersion: '1.0.0';
  readonly protocolVersion: '1.2.0';
  readonly questionId: string;
  readonly questionVersion: string;
  readonly type:
    | 'text'
    | 'secret'
    | 'single-select'
    | 'multi-select'
    | 'confirmation'
    | 'path'
    | 'repeated-text'
    | 'informational';
  readonly label: string;
  readonly explanation: string;
  readonly required: boolean;
  readonly sensitivity: 'public' | 'internal' | 'sensitive';
  readonly persistence: 'none' | 'session';
  readonly valueSemantics: 'none' | 'suggestion' | 'default';
  readonly suggestedValue?: AnswerValue;
  readonly suggestionReason?: string;
  readonly defaultValue?: AnswerValue;
  readonly defaultReason?: string;
  readonly choices?: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly description?: string;
    readonly preselected?: boolean;
  }>;
  readonly validation?: Readonly<{
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly minItems?: number;
    readonly maxItems?: number;
  }>;
  readonly visibleWhen?: ReadonlyArray<GuidedQuestionVisibilityCondition>;
}

export type GuidedQuestionVisibilityCondition = Readonly<
  | {
      questionId: string;
      operator: 'equals' | 'not-equals' | 'contains' | 'not-contains';
      value: AnswerValue;
    }
  | {
      questionId: string;
      operator: 'answered' | 'not-answered';
      value?: never;
    }
>;

export interface RepositoryContextValue {
  readonly value: AnswerValue;
  readonly source: string;
  readonly confidence: 'exact';
  readonly safe: true;
}

export type RepositoryContext = Readonly<Record<string, RepositoryContextValue>>;

export interface HeadlessQuestionPolicy {
  readonly materiality: 'non-material' | 'material';
  readonly defaultSafety: 'safe' | 'unsafe';
}

export interface ProtocolSkillSessionInput {
  readonly kind: 'skill-session';
  readonly schemaVersion: '1.0.0';
  readonly protocolVersion: '1.6.0';
  readonly documentVersion: string;
  readonly digestAlgorithm: 'sha256';
  readonly canonicalization: 'rfc8785';
  readonly documentDigest: `sha256:${string}`;
  readonly sessionId: string;
  readonly skillId: string;
  readonly startedAt: string;
  readonly state: 'open' | 'answered' | 'closed' | 'expired';
  readonly questions: ReadonlyArray<GuidedQuestion>;
}

export interface LegacyInteractionSessionMetadata {
  readonly kind?: never;
  readonly protocolVersion?: '1.6.0';
  readonly sessionId?: string;
  readonly skillId?: string;
  readonly questions?: ReadonlyArray<GuidedQuestion>;
  readonly questionnaireDigest?: `sha256:${string}`;
  readonly questionnaireVersion?: string;
  readonly command?: string;
  readonly projectIdentity?: `sha256:${string}`;
  readonly projectHead?: `sha256:${string}`;
  readonly configHead?: `sha256:${string}`;
}

export type InteractionSessionInput = ProtocolSkillSessionInput | LegacyInteractionSessionMetadata;

/** Internal fields copied from the active guided questionnaire, never requested from the user. */
export interface QuestionnaireBindingInput {
  readonly sessionId?: string;
  readonly digest: `sha256:${string}`;
  readonly questionnaireVersion: string;
  readonly command: string;
  readonly projectIdentity: `sha256:${string}`;
  readonly projectHead: `sha256:${string}`;
  readonly configHead: `sha256:${string}`;
}

export interface ResolvedInteractionSession {
  readonly sessionId: string;
  readonly questionnaireDigest: `sha256:${string}` | null;
  readonly questionnaireVersion: string;
  readonly command: string | null;
  readonly projectIdentity: `sha256:${string}` | null;
  readonly projectHead: `sha256:${string}` | null;
  readonly configHead: `sha256:${string}` | null;
}

export interface InteractionAnswer {
  readonly questionId: string;
  readonly questionVersion: string;
  readonly sensitivity: 'public' | 'internal' | 'sensitive';
  readonly value: AnswerValue;
  readonly source: string;
  readonly inferred: boolean;
}

export interface InteractionResolution {
  readonly status: 'completed' | 'unavailable' | 'denied' | 'blocked';
  readonly phase: 'awaiting-input' | 'answered' | 'unanswered';
  readonly sessionId: string;
  readonly session: ResolvedInteractionSession;
  readonly host: HostProfile['host'];
  readonly hostProfileId: string;
  readonly hostProfileVersion: string;
  readonly surface: InteractionSurface | null;
  readonly protocolInteraction: ProtocolInteraction | null;
  readonly questions: ReadonlyArray<GuidedQuestion>;
  readonly informational: ReadonlyArray<GuidedQuestion>;
  readonly answers: ReadonlyArray<InteractionAnswer>;
  readonly inferredAnswers: ReadonlyArray<InteractionAnswer>;
  readonly diagnostic: RuntimeDiagnostic;
  readonly [key: string]: unknown;
}

export interface AnswerBindingResult {
  readonly status: 'completed' | 'cancelled' | 'blocked';
  readonly phase: 'answered' | 'cancelled' | 'unanswered';
  readonly sessionId: string;
  readonly surface: InteractionSurface;
  readonly diagnostic: RuntimeDiagnostic;
  readonly answers?: ReadonlyArray<InteractionAnswer>;
  readonly envelope?: Readonly<Record<string, unknown>>;
  readonly unknown?: ReadonlyArray<string>;
  readonly [key: string]: unknown;
}

export declare const CAPABILITY_STATES: readonly CapabilityState[];
export declare const RESOLUTION_STATUSES: readonly ResolutionStatus[];
export declare const INTERACTION_SURFACES: readonly InteractionSurface[];

export declare function resolveCapabilities(options: {
  hostProfile: HostProfile;
  runtimeCapabilities?: RuntimeCapabilityReport;
  required?: ReadonlyArray<string>;
  optional?: ReadonlyArray<string>;
}): CapabilityResolution;

export declare function resolveInteraction(options: {
  hostProfile: HostProfile;
  runtimeCapabilities?: RuntimeCapabilityReport;
  questions?: ReadonlyArray<GuidedQuestion>;
  repositoryContext?: RepositoryContext;
  session?: InteractionSessionInput;
  questionnaire?: QuestionnaireBindingInput;
  headlessQuestionPolicy?: Readonly<Record<string, HeadlessQuestionPolicy>>;
}): InteractionResolution;

export declare function bindInteractionAnswers(options: {
  resolution: InteractionResolution;
  answers?: Readonly<Record<string, AnswerValue>> | ReadonlyMap<string, AnswerValue>;
  submittedAt?: string;
  cancelled?: boolean;
  cancellationReason?: string;
}): AnswerBindingResult;
