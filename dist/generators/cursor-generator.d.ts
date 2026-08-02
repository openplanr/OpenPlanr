import type { ArtifactCollection, GeneratedFile } from '../models/types.js';
import { BaseGenerator } from './base-generator.js';
export declare class CursorGenerator extends BaseGenerator {
    getTargetName(): string;
    generate(artifacts: ArtifactCollection): Promise<GeneratedFile[]>;
    /** Render a list of `.mdc.hbs` templates and emit one `GeneratedFile` per template. */
    private renderMdcTemplates;
}
//# sourceMappingURL=cursor-generator.d.ts.map