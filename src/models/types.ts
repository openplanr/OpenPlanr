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

export interface AIConfig {
  provider: AIProviderName;
  model?: string;
  ollamaBaseUrl?: string;
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
    slackChannel?: string;
    emailFrom?: string;
    emailSmtpHost?: string;
    weeklyRecipientAllowlist?: string[];
  };
  reportLinter?: ReportLinterConfig;
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
}

export interface Feature extends BaseArtifact {
  epicId: string;
  owner: string;
  status: TaskStatus;
  overview: string;
  functionalRequirements: string[];
  storyIds: string[];
}

export interface UserStory extends BaseArtifact {
  featureId: string;
  role: string;
  goal: string;
  benefit: string;
  acceptanceCriteria: string;
  additionalNotes?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  subtasks: TaskItem[];
}

export interface TaskList extends BaseArtifact {
  storyId?: string;
  tasks: TaskItem[];
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
// Stakeholder reports (EPIC-002)
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
