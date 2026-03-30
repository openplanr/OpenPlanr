export type ArtifactType = 'epic' | 'feature' | 'story' | 'task' | 'quick' | 'adr' | 'checklist';
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
  };
  ai?: AIConfig;
  defaultAgent?: CodingAgentName;
  templateOverrides?: string;
  author?: string;
  createdAt: string;
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

export interface ArtifactCollection {
  epics: Epic[];
  features: Feature[];
  stories: UserStory[];
  tasks: TaskList[];
}

export interface GeneratedFile {
  path: string;
  content: string;
}
