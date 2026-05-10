import path from 'node:path';
import type { ArtifactCollection, GeneratedFile } from '../models/types.js';
import { renderTemplate } from '../services/template-service.js';
import { OPENPLANR_PROTOCOL_VERSION } from '../utils/constants.js';
import { BaseGenerator } from './base-generator.js';

export class CodexGenerator extends BaseGenerator {
  getTargetName(): string {
    return 'codex';
  }

  async generate(_artifacts: ArtifactCollection): Promise<GeneratedFile[]> {
    const baseData = {
      projectName: this.config.projectName,
      agilePath: this.config.outputPaths.agile,
      date: new Date().toISOString().split('T')[0],
    };
    const targetPath = path.join(this.config.outputPaths.codexConfig, 'AGENTS.md');
    const files: GeneratedFile[] = [];

    if (this.includesAgile()) {
      const content = await renderTemplate(
        'rules/codex/AGENTS.md.hbs',
        baseData,
        this.config.templateOverrides,
      );
      files.push({ path: targetPath, content, markerName: 'agile' });
    }

    if (this.includesPipeline()) {
      const pipelineData = { ...baseData, protocolVersion: OPENPLANR_PROTOCOL_VERSION };
      const content = await renderTemplate(
        'rules/codex/_pipeline-section.md.hbs',
        pipelineData,
        this.config.templateOverrides,
      );
      files.push({ path: targetPath, content, markerName: 'pipeline' });
    }

    return files;
  }
}
