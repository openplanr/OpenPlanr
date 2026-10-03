import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('../../src/services/pipeline-package-service.js', () => ({
  resolvePipelinePackage: () => ({ root: state.root, version: 'test' }),
}));
const directories: string[] = [];
afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
  vi.resetModules();
});
function temporary() {
  const value = mkdtempSync(join(tmpdir(), 'openplanr-artifact-input-'));
  directories.push(value);
  return value;
}
describe('artifact input diagnostics', () => {
  it('names the resolved missing input before loading a runtime', async () => {
    const root = temporary();
    const { prepareArtifactEnvelope } = await import(
      '../../src/services/artifact-pipeline-service.js'
    );
    await expect(
      prepareArtifactEnvelope({ file: join(root, 'missing.html'), root }),
    ).rejects.toMatchObject({
      code: 'E_ARTIFACT_INPUT',
      message: `The artifact file is missing: ${resolve(root, 'missing.html')}`,
    });
  });
  it('rejects a directory as a saved artifact', async () => {
    const root = temporary();
    const { prepareArtifactEnvelope } = await import(
      '../../src/services/artifact-pipeline-service.js'
    );
    await expect(prepareArtifactEnvelope({ file: root, root })).rejects.toMatchObject({
      code: 'E_ARTIFACT_INPUT',
      message: `Choose a saved artifact file: ${root}`,
    });
  });
  it('maps a file disappearing between inspection and bundling to the same actionable boundary', async () => {
    const root = temporary();
    state.root = root;
    mkdirSync(join(root, 'lib/pipeline'), { recursive: true });
    mkdirSync(join(root, 'lib/artifact'), { recursive: true });
    writeFileSync(
      join(root, 'lib/artifact/envelope.mjs'),
      'export const resolveArtifactHtml=()=>"";',
    );
    writeFileSync(
      join(root, 'lib/pipeline/index.mjs'),
      `export const bundleArtifact=async ({entry})=>{const error=new Error('private adapter raw contents');error.code='ENOENT';error.path=entry;throw error;};export const createArtifactEnvelope=()=>{};export const createReviewLinkPreview=()=>{};export const createReviewLink=()=>{};export const decodeReviewLink=()=>{};export const importArtifactReview=()=>{};export const startArtifactReview=()=>{};export const exportArtifactReviewSession=()=>{};`,
    );
    const file = join(root, 'artifact.html');
    writeFileSync(file, '<h1>Saved artifact</h1>');
    const { prepareArtifactEnvelope } = await import(
      '../../src/services/artifact-pipeline-service.js'
    );
    await expect(prepareArtifactEnvelope({ file, root })).rejects.toMatchObject({
      code: 'E_ARTIFACT_INPUT',
      message: `The artifact file is missing: ${file}`,
    });
  });
  it('maps permission-denied reads to the resolved actionable input boundary without raw adapter details', async () => {
    const root = temporary();
    state.root = root;
    mkdirSync(join(root, 'lib/pipeline'), { recursive: true });
    mkdirSync(join(root, 'lib/artifact'), { recursive: true });
    writeFileSync(
      join(root, 'lib/artifact/envelope.mjs'),
      'export const resolveArtifactHtml=()=>"";',
    );
    writeFileSync(
      join(root, 'lib/pipeline/index.mjs'),
      `export const bundleArtifact=async ({entry})=>{const error=new Error('private permission-denied adapter content');error.code='EACCES';error.path=entry;throw error;};export const createArtifactEnvelope=()=>{};export const createReviewLinkPreview=()=>{};export const createReviewLink=()=>{};export const decodeReviewLink=()=>{};export const importArtifactReview=()=>{};export const startArtifactReview=()=>{};export const exportArtifactReviewSession=()=>{};`,
    );
    const file = join(root, 'artifact.html');
    writeFileSync(file, '<h1>Saved artifact</h1>');
    const { prepareArtifactEnvelope } = await import(
      '../../src/services/artifact-pipeline-service.js'
    );
    await expect(prepareArtifactEnvelope({ file, root })).rejects.toMatchObject({
      code: 'E_ARTIFACT_INPUT',
      message: `The artifact file cannot be read: ${resolve(file)}`,
    });
  });
});
