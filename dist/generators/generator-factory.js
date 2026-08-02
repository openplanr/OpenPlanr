import { ClaudeGenerator } from './claude-generator.js';
import { CodexGenerator } from './codex-generator.js';
import { CursorGenerator } from './cursor-generator.js';
export function createGenerator(target, config, projectDir) {
    switch (target) {
        case 'cursor':
            return new CursorGenerator(config, projectDir);
        case 'claude':
            return new ClaudeGenerator(config, projectDir);
        case 'codex':
            return new CodexGenerator(config, projectDir);
        default:
            throw new Error(`Unknown target: ${target}`);
    }
}
export function createGenerators(config, projectDir) {
    return config.targets.map((target) => createGenerator(target, config, projectDir));
}
//# sourceMappingURL=generator-factory.js.map