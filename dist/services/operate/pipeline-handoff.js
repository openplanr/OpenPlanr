import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalDigest } from './canonical.js';
import { resolveOperatingPipelineRoot } from './protocol.js';
import { OperateError } from './types.js';
import { resolveContainedPath } from './workspace.js';
async function loadPortablePipelineModule() {
    const root = resolveOperatingPipelineRoot();
    if (!root) {
        throw new OperateError('E_PIPELINE_NOT_INSTALLED', 'Operating Board routing requires the full planr-pipeline package.');
    }
    return import(pathToFileURL(path.join(root, 'lib', 'pipeline', 'index.mjs')).href);
}
export async function loadPipelinePoBridge() {
    const module = (await loadPortablePipelineModule());
    if (typeof module.preparePlan !== 'function' || typeof module.completePlan !== 'function') {
        throw new OperateError('E_PIPELINE_NOT_INSTALLED', 'The installed pipeline does not expose the required PLAN engine API.');
    }
    return module;
}
export async function loadOperatingGeneratorBridge() {
    const module = (await loadPortablePipelineModule());
    if (typeof module.prepareOperatingArtifactGeneration !== 'function' ||
        typeof module.renderOperatingArtifactTemplate !== 'function' ||
        typeof module.startOperatingArtifactGeneration !== 'function' ||
        typeof module.validateOperatingArtifactOutput !== 'function' ||
        typeof module.commitOperatingArtifactGeneration !== 'function' ||
        typeof module.failOperatingArtifactGeneration !== 'function' ||
        typeof module.resumeOperatingArtifactGeneration !== 'function') {
        throw new OperateError('E_PIPELINE_NOT_INSTALLED', 'The installed pipeline does not expose the Protocol v1.2 operating artifact generator.');
    }
    return module;
}
async function walkFiles(root, maximum = 2_000) {
    const files = [];
    const queue = [root];
    while (queue.length > 0) {
        const current = queue.shift();
        for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
            if (files.length >= maximum) {
                throw new OperateError('E_OPERATE_PLANNER_CONFLICT', 'Planning producer inspection exceeded its bounded file count.');
            }
            const candidate = path.join(current, entry.name);
            if (entry.isSymbolicLink()) {
                throw new OperateError('E_OPERATE_PATH_ESCAPE', 'Planning targets cannot contain symlinks.');
            }
            if (entry.isDirectory())
                queue.push(candidate);
            else if (entry.isFile())
                files.push(candidate);
        }
    }
    return files.sort();
}
export async function inspectPlanningProducer(input) {
    const target = await resolveContainedPath(input.projectRoot, input.targetPath);
    const present = await access(target).then(() => true, () => false);
    const files = present
        ? (await stat(target)).isDirectory()
            ? await walkFiles(target)
            : [target]
        : [];
    const relativeFiles = files.map((file) => path.relative(input.projectRoot, file).split(path.sep).join('/'));
    const planningFiles = relativeFiles.filter((file) => /(?:^|\/)(?:stories|tasks)\/.+\.(?:md|feature)$/i.test(file));
    const producers = new Set();
    const provenancePath = path.join(input.projectRoot, '.planr', 'provenance.jsonl');
    const provenance = await readFile(provenancePath, 'utf8').catch(() => '');
    for (const line of provenance.split('\n')) {
        if (!line.trim())
            continue;
        try {
            const event = JSON.parse(line);
            if (event.artifact_path &&
                (event.artifact_path === input.targetPath ||
                    event.artifact_path.startsWith(`${input.targetPath.replace(/\/$/, '')}/`))) {
                if (event.producer?.product === 'planr-pipeline' && event.producer.phase === 'po') {
                    producers.add('pipeline-po');
                }
                else if (event.producer?.product === 'openplanr') {
                    producers.add('openplanr');
                }
            }
        }
        catch {
            // Invalid provenance is diagnosed elsewhere; it cannot prove producer ownership.
        }
    }
    if (producers.size > 1) {
        throw new OperateError('E_OPERATE_PLANNER_CONFLICT', 'The target contains provenance from more than one planning producer.', { producers: [...producers].sort(), files: relativeFiles });
    }
    const producer = [...producers][0];
    return {
        populated: planningFiles.length > 0,
        ...(producer ? { producer } : {}),
        files: relativeFiles,
    };
}
export async function hasPipelinePoCompletionProvenance(input) {
    const normalizedTarget = input.targetPath.replace(/\/$/, '');
    const provenancePath = path.join(input.projectRoot, '.planr', 'provenance.jsonl');
    const provenance = await readFile(provenancePath, 'utf8').catch(() => '');
    for (const line of provenance.split('\n')) {
        if (!line.trim())
            continue;
        try {
            const event = JSON.parse(line);
            const artifactPath = typeof event.artifact_path === 'string' ? event.artifact_path : '';
            if (event.run_id === input.runId &&
                event.operation === 'decomposed' &&
                event.producer?.product === 'planr-pipeline' &&
                event.producer.phase === 'po' &&
                (artifactPath === normalizedTarget || artifactPath.startsWith(`${normalizedTarget}/`))) {
                return true;
            }
        }
        catch {
            // Invalid provenance cannot prove completion.
        }
    }
    return false;
}
export async function assertPlanningProducer(input) {
    const inspection = await inspectPlanningProducer(input);
    if (inspection.populated && (!inspection.producer || inspection.producer !== input.selected)) {
        throw new OperateError('E_OPERATE_PLANNER_CONFLICT', 'The target already contains planning artifacts from another or unknown producer.', {
            selected: input.selected,
            existing: inspection.producer ?? 'unknown',
            files: inspection.files,
        });
    }
}
export async function preparePipelinePoHandoff(input) {
    await assertPlanningProducer({
        projectRoot: input.projectRoot,
        targetPath: input.targetPath,
        selected: 'pipeline-po',
    });
    const prepared = await input.bridge.preparePlan({
        projectRoot: input.projectRoot,
        feature: input.feature,
        scaffold: false,
        createStackTemplate: false,
    });
    return {
        planningEngine: 'pipeline-po',
        feature: input.feature,
        runId: input.runId,
        preparedDigest: canonicalDigest(prepared),
        prepared,
        invocation: `planr pipeline plan ${JSON.stringify(input.feature)} --runtime ${input.runtime}`,
        state: 'awaiting-native-plan',
        shipInvoked: false,
    };
}
export async function completePipelinePoHandoff(input) {
    if (input.nativePlanCompleted !== true ||
        canonicalDigest(input.handoff.prepared) !== input.handoff.preparedDigest) {
        throw new OperateError('E_OPERATE_PLANNER_CONFLICT', 'Pipeline PO completion requires the unchanged prepared handoff and explicit PLAN completion.');
    }
    const result = await input.bridge.completePlan({
        projectRoot: input.projectRoot,
        feature: input.handoff.feature,
        runtime: input.runtime,
        runId: input.handoff.runId,
    });
    return {
        planningEngine: 'pipeline-po',
        runId: input.handoff.runId,
        state: 'plan-completed',
        result,
        shipInvoked: false,
    };
}
//# sourceMappingURL=pipeline-handoff.js.map