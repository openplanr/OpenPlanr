export type ArtifactType =
  | 'epic'
  | 'feature'
  | 'story'
  | 'task'
  | 'quick'
  | 'backlog'
  | 'sprint'
  | 'adr'
  | 'checklist';
export type TargetCLI = 'cursor' | 'claude' | 'codex';
export type TaskStatus = 'pending' | 'in-progress' | 'done';
export type AIProviderName = 'anthropic' | 'openai' | 'ollama';
export type CodingAgentName = 'claude' | 'cursor' | 'codex';

/**
 * How an OpenPlanr Epic is mapped into Linear's object model. Stored
 * per-epic in frontmatter; missing = `'project'` (one-to-one Epic →
 * Linear Project, the default).
 */
export type LinearMappingStrategy = 'project' | 'milestone-of' | 'label-on';

export interface AIConfig {
  provider: AIProviderName;
  model?: string;
  ollamaBaseUrl?: string;
}

/**
 * Linear integration config. `teamId` is persisted in `.planr/config.json`
 * after `planr linear init`. The PAT is stored via `credentials-service`
 * (provider key `linear`), never in the config file — use optional `token`
 * only for in-memory flows.
 */
export interface LinearConfig {
  teamId: string;
  /** Team key (e.g. ENG) for display; not required for API calls. */
  teamKey?: string;
  /** Optional Linear user id to set as project lead on created/updated projects. */
  defaultProjectLead?: string;
  /**
   * Pull: Linear **workflow state name** (any casing) → `pending` |
   * `in-progress` | `done`. Merged with built-in defaults. For legacy
   * projects, the same key previously held **push** UUIDs keyed by
   * OpenPlanr status; those `uuid`-shaped values are ignored for pull and
   * handled via `pushStateIds` / legacy push heuristics.
   */
  statusMap?: Record<string, string>;
  /**
   * Push: OpenPlanr status key → Linear workflow **state id** (UUID).
   */
  pushStateIds?: Record<string, string>;
  /**
   * Linear project (UUID) that hosts `QT-*` and `BL-*` pushes. When unset,
   * the first QT/BL push prompts for a project (or to create one).
   */
  standaloneProjectId?: string;
  /** Display-only name for the standalone project (shown in logs + prompts). */
  standaloneProjectName?: string;
  /**
   * Skip the first-push mapping-strategy prompt by supplying a default.
   * Useful for CI / non-interactive consumers.
   */
  defaultEpicStrategy?: LinearMappingStrategy;
  /**
   * Override the auto-applied type label names. Linear push attaches one
   * label per artifact (GitHub-style filtering) — `feature` for features,
   * `story` for user stories, `task` for tasklists, `quick-task` for QTs,
   * `backlog` for backlog items. Users can rename them here without
   * breaking anything (e.g., `{ story: "user-story" }`). Missing keys fall
   * back to the defaults.
   */
  typeLabels?: {
    feature?: string;
    story?: string;
    task?: string;
    quick?: string;
    backlog?: string;
  };
  /** In-memory / tests only; not persisted in `config.json`. */
  token?: string;
}

/** Options for `planr linear sync` and related flows. */
export interface LinearSyncOptions {
  /**
   * When true, compute and print what would change without writing local files or mutating Linear issue bodies.
   * Read-only Linear API calls may still run to compare remote state.
   */
  dryRun?: boolean;
  /**
   * For `planr linear push`: skip creating new Linear projects/issues; only update existing linked entities.
   * For `planr linear sync`: only affects flows that would create remote entities (sync is update-only by default).
   */
  updateOnly?: boolean;
  /** Checkbox merge strategy for the tasklist step. */
  onConflict?: 'prompt' | 'local' | 'linear';
}

/** One row for `planr linear status` (local mapping table). */
export interface LinearMappingTableRow {
  kind: 'epic' | 'feature' | 'story' | 'task' | 'quick' | 'backlog';
  openPlanrId: string;
  linearIdentifier: string;
  linearUrl: string;
  /** OpenPlanr `status` when present, em dash when N/A. */
  lastKnownState: string;
  /** e.g. stale-id warning */
  note?: string;
}

export interface OpenPlanrConfig {
  projectName: string;
  targets: TargetCLI[];
  outputPaths: {
    agile: string;
    cursorRules: string;
    claudeConfig: string;
    codexConfig: string;
  };
  idPrefix: {
    epic: string;
    feature: string;
    story: string;
    task: string;
    quick: string;
    backlog: string;
    sprint: string;
  };
  ai?: AIConfig;
  defaultAgent?: CodingAgentName;
  templateOverrides?: string;
  author?: string;
  createdAt: string;
  /** Branding and extra sections for stakeholder reports */
  reports?: ReportBranding;
  /** Optional delivery channel settings */
  distribution?: {
    slackWebhookUrl?: string;
    /** Reserved: Incoming Webhooks encode the channel in the URL; not read by v1 `push slack`. */
    slackChannel?: string;
    emailFrom?: string;
    emailSmtpHost?: string;
    /** Reserved for future SMTP allowlists; not read while email delivery is stubbed. */
    weeklyRecipientAllowlist?: string[];
  };
  reportLinter?: ReportLinterConfig;
  /** Set after `planr linear init`; token is not saved in JSON. */
  linear?: LinearConfig;
}

export interface BaseArtifact {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  filePath: string;
}

export interface Epic extends BaseArtifact {
  owner: string;
  businessValue: string;
  targetUsers: string;
  problemStatement: string;
  solutionOverview: string;
  successCriteria: string;
  keyFeatures: string[];
  dependencies: string;
  risks: string;
  featureIds: string[];
  /** Linear project id (UUID) after a successful `planr linear push`. */
  linearProjectId?: string;
  /** Human-readable project label in Linear (e.g. name or slug). */
  linearProjectIdentifier?: string;
  linearProjectUrl?: string;
  /**
   * How this epic maps into Linear. Missing ⇒ treated as `'project'`
   * for backward compatibility with v1 pushes.
   */
  linearMappingStrategy?: LinearMappingStrategy;
  /** Set when strategy === `'milestone-of'`. UUID of the ProjectMilestone. */
  linearMilestoneId?: string;
  /** Set when strategy === `'label-on'`. UUID of the IssueLabel. */
  linearLabelId?: string;
}

export interface Feature extends BaseArtifact {
  epicId: string;
  owner: string;
  status: TaskStatus;
  overview: string;
  functionalRequirements: string[];
  storyIds: string[];
  /** Top-level project issue in Linear (linked via project + team). */
  linearIssueId?: string;
  linearIssueIdentifier?: string;
  linearIssueUrl?: string;
  /** Set when the parent epic's strategy is `'milestone-of'`. */
  linearProjectMilestoneId?: string;
  /** Set when the parent epic's strategy is `'label-on'`. */
  linearLabelIds?: string[];
}

export interface UserStory extends BaseArtifact {
  featureId: string;
  status?: TaskStatus;
  role: string;
  goal: string;
  benefit: string;
  acceptanceCriteria: string;
  additionalNotes?: string;
  linearIssueId?: string;
  linearIssueIdentifier?: string;
  linearIssueUrl?: string;
  /** Parent feature issue id in Linear (sub-issues). */
  linearParentIssueId?: string;
  /** Set when the containing epic's strategy is `'milestone-of'`. */
  linearProjectMilestoneId?: string;
  /** Set when the containing epic's strategy is `'label-on'`. */
  linearLabelIds?: string[];
}

export interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  subtasks: TaskItem[];
}

export interface TaskList extends BaseArtifact {
  storyId?: string;
  featureId?: string;
  tasks: TaskItem[];
  linearIssueId?: string;
  linearIssueIdentifier?: string;
  linearIssueUrl?: string;
  linearParentIssueId?: string;
  /** ISO date-time of last task checklist sync to Linear. */
  linearTaskChecklistSyncedAt?: string;
  /**
   * Last agreed checkbox state for this file, compact: `1.0:1,1.1:0,2.0:1` (sorted by id).
   * Used for three-way sync between local markdown and the Linear tasklist issue.
   */
  linearChecklistReconciled?: string;
  /** Set when the containing epic's strategy is `'milestone-of'`. */
  linearProjectMilestoneId?: string;
  /** Set when the containing epic's strategy is `'label-on'`. */
  linearLabelIds?: string[];
}

export type BacklogPriority = 'critical' | 'high' | 'medium' | 'low';
export type BacklogStatus = 'open' | 'promoted' | 'closed';
export type SprintStatus = 'planned' | 'active' | 'closed';

export interface BacklogItem extends BaseArtifact {
  priority: BacklogPriority;
  tags: string[];
  status: BacklogStatus;
  description: string;
  acceptanceCriteria?: string;
  notes?: string;
  /**
   * Optional parent epic link. When set, `planr linear push` attaches this
   * backlog item to the epic's Linear container (project / milestone / label)
   * instead of the standalone bucket.
   */
  epicId?: string;
  linearIssueId?: string;
  linearIssueIdentifier?: string;
  linearIssueUrl?: string;
  /** Set when the containing epic's strategy is `'milestone-of'`. */
  linearProjectMilestoneId?: string;
  /** Set when the containing epic's strategy is `'label-on'` — includes the `backlog` label plus any epic label. */
  linearLabelIds?: string[];
}

export interface Sprint extends BaseArtifact {
  name: string;
  startDate: string;
  endDate: string;
  duration: string;
  status: SprintStatus;
  goals: string[];
  taskIds: string[];
  retrospective?: string;
}

export interface ArtifactCollection {
  epics: Epic[];
  features: Feature[];
  stories: UserStory[];
  tasks: TaskList[];
}

/** Frontmatter fields common to all artifact types. */
export interface ArtifactFrontmatter {
  id: string;
  title: string;
  status?: string;
  createdAt?: string;
  [key: string]: unknown; // allow extra fields per artifact type
}

export interface GeneratedFile {
  path: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Stakeholder reports
// ---------------------------------------------------------------------------

export type StakeholderReportType =
  | 'sprint'
  | 'weekly'
  | 'executive'
  | 'standup'
  | 'retro'
  | 'release';

export type StakeholderReportFormat = 'markdown' | 'html';

export interface GitHubCommitSummary {
  sha: string;
  shortSha: string;
  message: string;
  authorLogin: string;
  committedDate: string;
  url: string;
}

export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  state: string;
  url: string;
  authorLogin: string;
  updatedAt: string;
  mergedAt: string | null;
}

export interface ReportGitHubSignals {
  commits: GitHubCommitSummary[];
  pullRequests: GitHubPullRequestSummary[];
  warning?: string;
  fetchedAt: string;
}

export interface ArtifactStatusLine {
  id: string;
  title: string;
  status: string;
  type: 'epic' | 'feature' | 'story' | 'task' | 'sprint';
}

export interface SprintContextSlice {
  sprintId: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  goals: string[];
  taskIds: string[];
}

/** Serializable context used by report templates and `planr context`. */
export interface StakeholderReportContext {
  projectName: string;
  generatedAt: string;
  reportType: StakeholderReportType;
  daysLookback: number;
  sprint?: SprintContextSlice;
  artifacts: {
    epics: ArtifactStatusLine[];
    features: ArtifactStatusLine[];
    stories: ArtifactStatusLine[];
    tasks: ArtifactStatusLine[];
  };
  github?: ReportGitHubSignals;
  branding?: ReportBranding;
  /** Placeholder-friendly flags when data is missing */
  placeholders: {
    noSprint: boolean;
    noGitHub: boolean;
    noStoriesCompleted: boolean;
  };
  /** Evidence entries for templates (commits, PRs, artifacts) */
  evidence: ReportEvidenceItem[];
}

export interface ReportBranding {
  orgName?: string;
  logoUrl?: string;
  accentColor?: string;
  /** Extra markdown sections name -> body */
  customSections?: Record<string, string>;
}

export interface ReportEvidenceItem {
  id: string;
  kind: 'commit' | 'pull_request' | 'artifact';
  label: string;
  url?: string;
  detail?: string;
}

export interface EvidenceLink {
  claimId: string;
  sources: ReportEvidenceItem[];
}

export interface ClaimValidationResult {
  claimId: string;
  ok: boolean;
  missingReason?: string;
}

export interface EvidenceSummary {
  evidenceId: string;
  title: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Report linter
// ---------------------------------------------------------------------------

export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintFinding {
  severity: LintSeverity;
  ruleId: string;
  message: string;
  suggestion?: string;
  span?: { start: number; end: number };
}

export interface CoachingFeedback {
  ruleId: string;
  message: string;
  educational?: string;
  positive?: boolean;
}

export interface ReportLintResult {
  ok: boolean;
  findings: LintFinding[];
  coaching: CoachingFeedback[];
}

export interface VaguePhraseRule {
  pattern: string;
  alternatives: string[];
  hint?: string;
}

export interface ReportLinterRuleConfig {
  id: string;
  enabled: boolean;
  minEvidenceLinks?: number;
  requireSections?: string[];
}

export interface ReportLinterConfig {
  rules: ReportLinterRuleConfig[];
  vaguePhrases: VaguePhraseRule[];
}

// ---------------------------------------------------------------------------
// Distribution / export (stakeholder deliverables)
// ---------------------------------------------------------------------------

export type DistributionChannel = 'github_issue' | 'slack' | 'email' | 'file';

export interface DistributionResult {
  channel: DistributionChannel;
  ok: boolean;
  message: string;
  url?: string;
}

export interface StakeholderExportOptions {
  format: StakeholderReportFormat;
  /** When true, attempt PDF (may be unsupported in OSS build). */
  pdf?: boolean;
}

// ---------------------------------------------------------------------------
// Voice / standup dictation (file- and stdin-based; mic is optional future)
// ---------------------------------------------------------------------------

export type VoiceSessionStatus = 'idle' | 'recording' | 'processing' | 'done' | 'error';

export interface VoiceStandupSession {
  status: VoiceSessionStatus;
  transcript: string;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Plan revision
//
// Types for `planr revise` — the agentic revision command that aligns
// planning artifacts with codebase reality.
// ---------------------------------------------------------------------------

export type ReviseAction = 'revise' | 'skip' | 'flag';

/**
 * Typed evidence kinds the agent must use when citing why a revision or
 * flag is justified. Every kind is verifiable by the post-flight guard:
 * - `file_exists` / `file_absent` — fs.stat check against `ref`
 * - `grep_match` — substring match in the provided codebase context
 * - `sibling_artifact` — quote from another artifact within the same scope
 * - `source_quote` — quote from a declared source (PRD, design, ADR, rule file)
 * - `pattern_rule` — an architectural pattern rule detected by existing pattern-rules
 */
export type ReviseEvidenceType =
  | 'file_exists'
  | 'file_absent'
  | 'grep_match'
  | 'sibling_artifact'
  | 'source_quote'
  | 'pattern_rule';

export interface ReviseEvidence {
  type: ReviseEvidenceType;
  /** What the evidence points at — a file path, artifact id, or rule id. */
  ref: string;
  /** Verbatim snippet supporting the evidence (when applicable to the type). */
  quote?: string;
}

export interface ReviseAmbiguity {
  /** Section of the target artifact the ambiguity touches. */
  section: string;
  /** Why the agent could not resolve this without a human decision. */
  reason: string;
}

/**
 * One agent decision for one artifact. Produced by the revise agent,
 * validated by `aiReviseDecisionSchema`, verified by the post-flight guard.
 *
 * Invariants (enforced by the zod schema, not the TS type):
 * - `action === 'revise'` requires non-empty `revisedMarkdown` and at least one `evidence` entry
 * - `action === 'flag'` requires at least one `ambiguous` entry
 * - `action === 'skip'` has no `revisedMarkdown` and no `ambiguous` entries
 */
export interface ReviseDecision {
  artifactId: string;
  action: ReviseAction;
  /** Proposed full artifact markdown; required when action === 'revise'. */
  revisedMarkdown?: string;
  rationale: string;
  /** Typed evidence citations — post-flight verifies these. Always present, empty when none. */
  evidence: ReviseEvidence[];
  /** Ambiguities requiring human decision — populated when action === 'flag', empty otherwise. */
  ambiguous: ReviseAmbiguity[];
}

/** Audit log output format. */
export type ReviseAuditFormat = 'md' | 'json';

/**
 * Terminal state recorded in the audit log for a single artifact in a
 * revise run. Superset of the agent's `ReviseAction` so we can also record
 * human overrides (skipped / quit) and system outcomes (failed / demoted).
 */
export type ReviseAuditOutcome =
  | 'applied'
  | 'would-apply' // dry-run equivalent of 'applied'
  | 'unchanged-by-agent' // agent returned revisedMarkdown equal to the original; no write
  | 'skipped-by-agent'
  | 'skipped-by-user'
  | 'flagged'
  | 'failed'
  | 'demoted' // evidence verifier flipped revise → flag
  | 'applied-from-plan' // written by the apply-from-audit replay path
  | 'stale-skipped' // replay found artifact changed since dry-run; entry skipped
  | 'conflict-skipped'; // replay diff did not apply cleanly; entry skipped

/**
 * One row in the revise audit log. Flushed to disk as soon as it is
 * produced so an interrupted run still leaves an accurate on-disk record
 * of what was written.
 */
export interface ReviseAuditEntry {
  artifactId: string;
  artifactPath?: string;
  outcome: ReviseAuditOutcome;
  rationale: string;
  evidence: ReviseEvidence[];
  ambiguous: ReviseAmbiguity[];
  /** Cascade level the entry was produced at; omitted for single-artifact runs. */
  cascadeLevel?: 'epic' | 'features' | 'stories' | 'tasks';
  /** Unified diff against the pre-revise artifact body; present when outcome wrote content. */
  diff?: string;
  /** Present when outcome === 'failed'. */
  error?: string;
  timestamp: string;
}

/** Aggregate audit record covering a single revise run. */
export interface ReviseAudit {
  scope: string;
  cascade: boolean;
  dryRun: boolean;
  startedAt: string;
  completedAt?: string;
  entries: ReviseAuditEntry[];
  /** Populated when the run stopped before normal completion. */
  interrupted?: {
    reason: 'q' | 'sigint' | 'agent_error' | 'graph_rollback';
    atArtifactId?: string;
  };
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * One level in a top-down cascade. Tracks which artifact type the level
 * covers and the ordered artifact ids processed at that level.
 */
export interface CascadeLevel {
  type: ArtifactType;
  label: 'epic' | 'features' | 'stories' | 'tasks';
  artifactIds: string[];
}

/**
 * Plan for a cascade run. Built by `buildCascadeOrder` and consumed by the
 * cascade executor; immutable after construction.
 */
export interface CascadePlan {
  /** Root artifact that started the cascade (epic / feature / story / task). */
  rootId: string;
  rootType: ArtifactType;
  levels: CascadeLevel[];
  /** Convenience: flat list of all artifact ids in cascade order. */
  orderedIds: string[];
}

/** Live progress snapshot emitted during cascade execution. */
export interface CascadeProgress {
  completed: number;
  total: number;
  currentArtifactId: string;
  currentLevelLabel: CascadeLevel['label'];
  /** Rolling estimate of remaining time in seconds; null until enough samples collected. */
  etaSeconds: number | null;
}
