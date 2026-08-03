import type {
  ArtifactCollection,
  GeneratedFile,
  GenerationScope,
  OpenPlanrConfig,
} from '../models/types.js';

export abstract class BaseGenerator {
  /**
   * Which template set to render. Defaults to `'agile'` so existing call sites
   * (no scope passed) preserve current behaviour byte-for-byte.
   */
  protected scope: GenerationScope = 'agile';

  constructor(
    protected config: OpenPlanrConfig,
    protected projectDir: string,
  ) {}

  /**
   * Set the generation scope before calling `generate()`. Returns `this` for
   * fluent chaining.
   */
  setScope(scope: GenerationScope): this {
    this.scope = scope;
    return this;
  }

  /** True iff the current scope includes pipeline-aware rule files. */
  protected includesPipeline(): boolean {
    return this.scope === 'pipeline' || this.scope === 'all';
  }

  /** True iff the current scope includes agile-mode rule files. */
  protected includesAgile(): boolean {
    return this.scope === 'agile' || this.scope === 'all';
  }

  abstract generate(artifacts: ArtifactCollection): Promise<GeneratedFile[]>;
  abstract getTargetName(): string;
}
