/**
 * Shared artifact-gathering utilities for task generation prompts.
 *
 * Collects all related artifacts (stories, gherkin, ADRs, epic, feature)
 * into a single context object that `buildTasksPrompt()` consumes.
 */
import path from 'node:path';
import { listFiles, readFile } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import { getArtifactDir, listArtifacts, readArtifact, readArtifactRaw, } from './artifact-service.js';
/**
 * Gather all context for a single user story.
 * Used by `--story` flag and `planr plan` per-story generation.
 */
export async function gatherStoryArtifacts(projectDir, config, storyId) {
    const storyRaw = await readArtifactRaw(projectDir, config, 'story', storyId);
    if (!storyRaw)
        throw new Error(`Story ${storyId} not found.`);
    const stories = [{ id: storyId, raw: storyRaw }];
    // Read gherkin for this story
    const gherkinScenarios = [];
    const gherkinContent = await findGherkinContent(projectDir, config, storyId);
    if (gherkinContent) {
        gherkinScenarios.push({ storyId, content: gherkinContent });
    }
    // Read parent feature + epic
    const storyData = await readArtifact(projectDir, config, 'story', storyId);
    const featureId = storyData?.data.featureId;
    let featureRaw;
    let epicRaw;
    if (featureId) {
        featureRaw = (await readArtifactRaw(projectDir, config, 'feature', featureId)) || undefined;
        const featureData = await readArtifact(projectDir, config, 'feature', featureId);
        const epicId = featureData?.data.epicId;
        if (epicId) {
            epicRaw = (await readArtifactRaw(projectDir, config, 'epic', epicId)) || undefined;
        }
    }
    // Read ADRs
    const adrs = await readAllADRs(projectDir, config);
    // Build codebase context
    const codebaseResult = await buildCodebaseStr(projectDir, storyRaw + (featureRaw || ''));
    return {
        stories,
        gherkinScenarios,
        featureRaw,
        epicRaw,
        adrs,
        codebaseContext: codebaseResult?.formatted,
        codebaseRawContext: codebaseResult?.context,
    };
}
/**
 * Gather all context for a feature — all stories + gherkin + ADRs + parent epic.
 * Used by `--feature` flag.
 */
export async function gatherFeatureArtifacts(projectDir, config, featureId) {
    const featureRaw = await readArtifactRaw(projectDir, config, 'feature', featureId);
    if (!featureRaw)
        throw new Error(`Feature ${featureId} not found.`);
    // Read parent epic
    const featureData = await readArtifact(projectDir, config, 'feature', featureId);
    const epicId = featureData?.data.epicId;
    let epicRaw;
    if (epicId) {
        epicRaw = (await readArtifactRaw(projectDir, config, 'epic', epicId)) || undefined;
    }
    // Find all stories under this feature
    const allStories = await listArtifacts(projectDir, config, 'story');
    const stories = [];
    const gherkinScenarios = [];
    for (const s of allStories) {
        const data = await readArtifact(projectDir, config, 'story', s.id);
        if (data && data.data.featureId === featureId) {
            const raw = await readArtifactRaw(projectDir, config, 'story', s.id);
            if (raw) {
                stories.push({ id: s.id, raw });
                const gherkin = await findGherkinContent(projectDir, config, s.id);
                if (gherkin) {
                    gherkinScenarios.push({ storyId: s.id, content: gherkin });
                }
            }
        }
    }
    if (stories.length === 0) {
        throw new Error(`No user stories found for feature ${featureId}. Create stories first with: planr story create --feature ${featureId}`);
    }
    // Read ADRs
    const adrs = await readAllADRs(projectDir, config);
    // Build codebase context from all story + feature content
    const allText = `${stories.map((s) => s.raw).join('\n')}\n${featureRaw}`;
    const codebaseResult = await buildCodebaseStr(projectDir, allText);
    return {
        stories,
        gherkinScenarios,
        featureRaw,
        epicRaw,
        adrs,
        codebaseContext: codebaseResult?.formatted,
        codebaseRawContext: codebaseResult?.context,
    };
}
/**
 * Read a gherkin file for a given story ID. Returns content or null.
 */
export async function findGherkinContent(projectDir, config, storyId) {
    const storyDir = path.join(projectDir, getArtifactDir(config, 'story'));
    const files = await listFiles(storyDir, new RegExp(`^${storyId}-gherkin\\.feature$`));
    if (files.length === 0)
        return null;
    return readFile(path.join(storyDir, files[0]));
}
/**
 * Read all ADR artifacts in the project.
 */
async function readAllADRs(projectDir, config) {
    const adrs = [];
    try {
        const allAdrs = await listArtifacts(projectDir, config, 'adr');
        for (const a of allAdrs) {
            const raw = await readArtifactRaw(projectDir, config, 'adr', a.id);
            if (raw)
                adrs.push({ id: a.id, content: raw });
        }
    }
    catch (err) {
        logger.debug('Failed to read ADR artifacts', err);
        // ADRs may not exist — graceful fallback
    }
    return adrs;
}
/**
 * Build formatted codebase context string from text content.
 */
async function buildCodebaseStr(projectDir, textContent) {
    try {
        const { buildCodebaseContext, formatCodebaseContext, extractKeywords } = await import('../ai/codebase/index.js');
        const keywords = extractKeywords(textContent);
        const ctx = await buildCodebaseContext(projectDir, keywords);
        return { formatted: formatCodebaseContext(ctx), context: ctx };
    }
    catch (err) {
        logger.debug('Failed to build codebase context', err);
        return undefined;
    }
}
//# sourceMappingURL=artifact-gathering.js.map