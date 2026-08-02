import type { ArtifactCollection, GeneratedFile } from '../models/types.js';
import { BaseGenerator } from './base-generator.js';
export declare class CodexGenerator extends BaseGenerator {
    getTargetName(): string;
    generate(_artifacts: ArtifactCollection): Promise<GeneratedFile[]>;
}
//# sourceMappingURL=codex-generator.d.ts.map