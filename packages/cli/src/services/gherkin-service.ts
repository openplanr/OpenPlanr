import path from 'node:path';
import type { OpenPlanrConfig } from '../models/types.js';
import { listFiles, readFile } from '../utils/fs.js';
import { getArtifactDir } from './artifact-service.js';

export async function findGherkinContent(
  projectDir: string,
  config: OpenPlanrConfig,
  storyId: string,
): Promise<string | null> {
  const storyDir = path.join(projectDir, getArtifactDir(config, 'story'));
  const files = await listFiles(storyDir, new RegExp(`^${storyId}-gherkin\\.feature$`));
  return files.length > 0 ? readFile(path.join(storyDir, files[0])) : null;
}
