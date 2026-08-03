import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { OperateError, } from './types.js';
const require = createRequire(import.meta.url);
let cached;
const OPERATING_MANDATE_SCHEMA = ['schemas', 'v1.4.0', 'operating-mandate.schema.json'];
const OPERATING_MANDATE_MODULE = ['lib', 'operate', 'mandate.mjs'];
function candidateRoots() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const roots = [];
    if (process.env.OPENPLANR_PIPELINE_ROOT)
        roots.push(process.env.OPENPLANR_PIPELINE_ROOT);
    try {
        roots.push(path.resolve(path.dirname(require.resolve('planr-pipeline/protocol')), '../..'));
    }
    catch {
        try {
            roots.push(path.resolve(path.dirname(require.resolve('planr-pipeline')), '../..'));
        }
        catch {
            // The planning-only installer intentionally omits the portable pipeline.
        }
    }
    roots.push(path.resolve(here, '../../../../planr-pipeline'), path.resolve(process.cwd(), '../planr-pipeline'));
    return [...new Set(roots.map((root) => path.resolve(root)))];
}
export function resolveOperatingPipelineRoot(options = {}) {
    for (const root of candidateRoots()) {
        const hasBaseContract = existsSync(path.join(root, 'lib', 'protocol', 'loader.mjs')) &&
            existsSync(path.join(root, 'schemas', 'v1.2.0', 'operating-event.schema.json'));
        if (!hasBaseContract)
            continue;
        // The base v1.2 reader remains available for existing artifacts. Agent-native
        // execution additionally requires the Protocol v1.4 mandate contract.
        if (options.requireMission &&
            !(existsSync(path.join(root, ...OPERATING_MANDATE_SCHEMA)) &&
                existsSync(path.join(root, ...OPERATING_MANDATE_MODULE)))) {
            continue;
        }
        return root;
    }
    return null;
}
export function operatingPipelineAvailable() {
    return resolveOperatingPipelineRoot() !== null;
}
/** Whether a Protocol v1.4 agent-native pipeline install is resolvable. */
export function operatingMissionProtocolAvailable() {
    return resolveOperatingPipelineRoot({ requireMission: true }) !== null;
}
export async function loadOperatingProtocol() {
    const root = resolveOperatingPipelineRoot();
    if (!root) {
        throw new OperateError('E_PIPELINE_NOT_INSTALLED', 'Operating Board requires the full pipeline package with Protocol v1.2.', {
            recovery: 'Run `npm install -g openplanr@latest` (without `--omit=optional`), then `planr setup --scope user`.',
        });
    }
    cached ??= import(pathToFileURL(path.join(root, 'lib', 'protocol', 'loader.mjs')).href).then((value) => value);
    return cached;
}
export async function assertOperatingArtifact(kind, value) {
    const protocol = await loadOperatingProtocol();
    try {
        protocol.assertProtocolArtifact(kind, value);
    }
    catch (error) {
        throw new OperateError('E_OPERATE_STATE_INVALID', error instanceof Error ? error.message : `${kind} failed Protocol v1.2 validation.`, { kind });
    }
    return value;
}
export async function validateOperatingArtifact(kind, value) {
    return (await loadOperatingProtocol()).validateProtocolArtifact(kind, value);
}
//# sourceMappingURL=protocol.js.map