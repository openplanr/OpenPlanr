import path from 'node:path';
import type { ArtifactCollection, GeneratedFile } from '../models/types.js';
import { listArtifacts } from '../services/artifact-service.js';
import { renderTemplate } from '../services/template-service.js';
import { OPENPLANR_PROTOCOL_VERSION } from '../utils/constants.js';
import { BaseGenerator } from './base-generator.js';

export class ClaudeGenerator extends BaseGenerator {
  getTargetName(): string {
    return 'claude';
  }

  async generate(_artifacts: ArtifactCollection): Promise<GeneratedFile[]> {
    const epics = await listArtifacts(this.projectDir, this.config, 'epic');
    const features = await listArtifacts(this.projectDir, this.config, 'feature');
    const date = new Date().toISOString().split('T')[0];
    const files: GeneratedFile[] = [];

    // Always render CLAUDE.md (the file's body adapts via {{#if pipelineScope}}).
    const claudeContent = await renderTemplate(
      'rules/claude/CLAUDE.md.hbs',
      {
        projectName: this.config.projectName,
        agilePath: this.config.outputPaths.agile,
        date,
        existingEpics: epics,
        existingFeatures: features,
        pipelineScope: this.includesPipeline(),
      },
      this.config.templateOverrides,
    );
    files.push({
      path: path.join(this.config.outputPaths.claudeConfig, 'CLAUDE.md'),
      content: claudeContent,
    });

    // When scope ⊇ pipeline, also write the sibling reference card.
    if (this.includesPipeline()) {
      const pipelineRefContent = await renderTemplate(
        'rules/claude/planr-pipeline.md.hbs',
        {
          projectName: this.config.projectName,
          agilePath: this.config.outputPaths.agile,
          date,
          protocolVersion: OPENPLANR_PROTOCOL_VERSION,
        },
        this.config.templateOverrides,
      );
      files.push({
        path: path.join(this.config.outputPaths.claudeConfig, 'planr-pipeline.md'),
        content: pipelineRefContent,
      });
    }

    return files;
  }
}
