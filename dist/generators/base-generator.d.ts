import type { ArtifactCollection, GeneratedFile, GenerationScope, OpenPlanrConfig } from '../models/types.js';
export declare abstract class BaseGenerator {
    protected config: OpenPlanrConfig;
    protected projectDir: string;
    /**
     * Which template set to render. Defaults to `'agile'` so existing call sites
     * (no scope passed) preserve current behaviour byte-for-byte.
     */
    protected scope: GenerationScope;
    constructor(config: OpenPlanrConfig, projectDir: string);
    /**
     * Set the generation scope before calling `generate()`. Returns `this` for
     * fluent chaining.
     */
    setScope(scope: GenerationScope): this;
    /** True iff the current scope includes pipeline-aware rule files. */
    protected includesPipeline(): boolean;
    /** True iff the current scope includes agile-mode rule files. */
    protected includesAgile(): boolean;
    abstract generate(artifacts: ArtifactCollection): Promise<GeneratedFile[]>;
    abstract getTargetName(): string;
}
//# sourceMappingURL=base-generator.d.ts.map