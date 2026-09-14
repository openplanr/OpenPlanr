import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ArtifactEnvelope } from './artifact-pipeline-service.js';
import { resolvePipelinePackage } from './pipeline-package-service.js';

export function isDiagramManifestFile(file: string): boolean {
  if (!path.basename(file).endsWith('.manifest.json')) return false;
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    return value.kind === 'diagram-manifest' && typeof value.diagramId === 'string';
  } catch {
    return false;
  }
}

export interface DiagramStudioSession {
  ok: boolean;
  url: string;
  sessionId: string;
  reviewPath: string;
  close?: () => Promise<void>;
}

interface DiagramArtifactRuntime {
  createDiagramArtifactEnvelope(manifest: string): Promise<{
    envelope: ArtifactEnvelope;
    binding: Record<string, unknown>;
    htmlPath: string;
    manifest: Record<string, unknown>;
  }>;
}

async function loadDiagramArtifactRuntime(): Promise<DiagramArtifactRuntime> {
  const pipeline = resolvePipelinePackage(false);
  if (!pipeline) {
    throw new Error(
      'Diagram review requires the OpenPlanr workflow package. Install a compatible OpenPlanr release and retry.',
    );
  }
  const entry = path.join(pipeline.root, 'lib', 'artifact', 'diagram', 'index.mjs');
  const runtime = (await import(pathToFileURL(entry).href)) as Partial<DiagramArtifactRuntime>;
  if (typeof runtime.createDiagramArtifactEnvelope !== 'function') {
    throw new Error(
      `Installed planr-pipeline ${pipeline.version} does not support diagram review manifests. Update OpenPlanr first.`,
    );
  }
  return runtime as DiagramArtifactRuntime;
}

export async function prepareDiagramArtifact(file: string): Promise<ArtifactEnvelope> {
  const runtime = await loadDiagramArtifactRuntime();
  return (await runtime.createDiagramArtifactEnvelope(path.resolve(file))).envelope;
}

export async function openDiagramArtifact(
  file: string,
  options: Record<string, unknown>,
): Promise<DiagramStudioSession> {
  const pipeline = resolvePipelinePackage(false);
  if (!pipeline) throw new Error('Diagram studio requires the OpenPlanr workflow package.');
  const runtime = await import(
    pathToFileURL(path.join(pipeline.root, 'lib/artifact/diagram-review.mjs')).href
  );
  if (typeof runtime.startDiagramReview !== 'function')
    throw new Error(
      'The installed workflow package does not support the native diagram studio. Update OpenPlanr first.',
    );
  return runtime.startDiagramReview(path.resolve(file), options);
}
