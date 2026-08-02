export class BaseGenerator {
    config;
    projectDir;
    /**
     * Which template set to render. Defaults to `'agile'` so existing call sites
     * (no scope passed) preserve current behaviour byte-for-byte.
     */
    scope = 'agile';
    constructor(config, projectDir) {
        this.config = config;
        this.projectDir = projectDir;
    }
    /**
     * Set the generation scope before calling `generate()`. Returns `this` for
     * fluent chaining.
     */
    setScope(scope) {
        this.scope = scope;
        return this;
    }
    /** True iff the current scope includes pipeline-aware rule files. */
    includesPipeline() {
        return this.scope === 'pipeline' || this.scope === 'all';
    }
    /** True iff the current scope includes agile-mode rule files. */
    includesAgile() {
        return this.scope === 'agile' || this.scope === 'all';
    }
}
//# sourceMappingURL=base-generator.js.map