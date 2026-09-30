import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  previewDiagramShare,
  runDiagramShareAction,
} from '../../src/services/diagram-artifact-service.js';

const runtime = vi.hoisted(() => ({ root: '' }));
vi.mock('../../src/services/pipeline-package-service.js', () => ({
  resolvePipelinePackage: () => ({ root: runtime.root, version: '0.0.0' }),
}));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it('blocks a runtime without native sharing with a bounded compatibility error', async () => {
  runtime.root = mkdtempSync(join(tmpdir(), 'planr-incompatible-sharing-'));
  roots.push(runtime.root);
  for (const operation of [
    previewDiagramShare('diagram.manifest.json'),
    runDiagramShareAction('diagram.manifest.json', 'share'),
  ]) {
    await expect(operation).rejects.toMatchObject({ code: 'E_PIPELINE_VERSION_INCOMPATIBLE' });
    await expect(operation).rejects.not.toThrow(runtime.root);
  }
});
