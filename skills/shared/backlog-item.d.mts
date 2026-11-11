/** Normalised fields of one backlog item. */
export interface BacklogFields {
  readonly title: string;
  readonly priority: string;
  readonly tags: readonly string[];
  readonly description: string;
  readonly acceptanceCriteria?: string | readonly string[];
  readonly notes?: string;
  readonly epicId?: string;
  readonly when?: string;
  readonly files?: readonly string[];
  readonly unverified?: true;
}

/** One open backlog item; `path` is project-relative. */
export interface OpenBacklogItem {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly path: string;
  readonly when?: string;
  readonly files: readonly string[];
}

/** One unreadable or invalid field; value is its raw YAML or "missing". */
export interface BacklogWarning {
  readonly path: string;
  readonly field: string;
  readonly value: string;
  readonly message: string;
}

/** Readable backlog items and per-field diagnostics. */
export interface BacklogList {
  readonly items: OpenBacklogItem[];
  readonly warnings: BacklogWarning[];
}

/** A stored scheduling decision. */
export interface BacklogWhen {
  readonly kind: 'next-unit' | 'sprint' | 'trigger' | 'declined';
  readonly value: string;
}

/** Filters on backlog frontmatter and evidence paths. */
export interface BacklogFilters {
  readonly files?: readonly string[];
  readonly noWhen?: boolean;
}

/** Parses a stored scheduling decision; rejects invalid forms and now. */
export declare function parseWhen(value: unknown): BacklogWhen;
/** Normalises distinct repo-relative paths; rejects traversal, absolute paths and line numbers. */
export declare function normalizeBacklogFiles(value: unknown): string[];

/** The command that installs the OpenPlanr CLI. */
export declare const CLI_INSTALL_COMMAND: 'npm install -g openplanr';
/** The one-time line shown after filing without the CLI. */
export declare const CLI_HINT: string;

/** Reserves the next `PREFIX-NNN` in `dir`, one past the highest file or reservation; never reissues a removed ID. */
export declare function reserveNextId(dir: string, prefix: string): Promise<string>;
/** Converts text to a filename-safe slug of at most `maxLength` characters, cut at a word boundary. */
export declare function slugify(text: string, maxLength?: number): string;
/** Normalises raw input; throws when the title is empty. */
export declare function backlogFields(input: Record<string, unknown>): BacklogFields;
/** Renders the default backlog item Markdown. */
export declare function renderBacklogItem(id: string, fields: BacklogFields, date: string): string;
/** Reserves an ID and writes the item into `backlogDir`. */
export declare function writeBacklogItem(
  backlogDir: string,
  prefix: string,
  fields: BacklogFields,
  date: string,
): Promise<{ id: string; filePath: string }>;
/** Creates an item in the backlog folder configured by `<projectDir>/.planr/config.json`. */
export declare function createBacklogItem(
  projectDir: string,
  input: Record<string, unknown>,
  date?: string,
): Promise<{ id: string; title: string; artifactPath: string }>;
/** Lists backlog items whose status is not `closed` or `done`. */
export declare function listOpenBacklog(
  projectDir: string,
  options?: BacklogFilters,
): Promise<BacklogList>;
/** Lists backlog items, optionally restricting them to open items. */
export declare function listBacklog(
  projectDir: string,
  options?: BacklogFilters & { readonly open?: boolean },
): Promise<BacklogList>;
/** Returns the install hint and records it in `.planr/config.json`, or null once it has been shown in this project. */
export declare function takeCliHint(projectDir: string): Promise<string | null>;
