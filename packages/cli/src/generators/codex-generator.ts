import path from 'node:path';
import type { ArtifactCollection, GeneratedFile } from '../models/types.js';
import { renderTemplate } from '../services/template-service.js';
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
      const implementationGuidance = await this.renderImplementationGuidance();
      const content = await renderTemplate(
        'rules/codex/AGENTS.md.hbs',
        { ...baseData, implementationGuidance },
        this.config.templateOverrides,
      );
      files.push({ path: targetPath, content, markerName: 'agile' });
    }

    if (this.includesPipeline()) {
      const content = await renderTemplate(
        'rules/shared/host-native-guidance.md.hbs',
        {
          specInvocation: '$planr:spec',
          planInvocation: '$planr:plan',
          shipInvocation: '$planr:ship',
        },
        this.config.templateOverrides,
      );
      files.push({ path: targetPath, content, markerName: 'pipeline' });
    }

    return files;
  }
}
