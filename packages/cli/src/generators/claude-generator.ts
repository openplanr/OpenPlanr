import path from 'node:path';
import type { ArtifactCollection, GeneratedFile } from '../models/types.js';
import { listArtifacts } from '../services/artifact-service.js';
import { renderTemplate } from '../services/template-service.js';
import { BaseGenerator } from './base-generator.js';

export class ClaudeGenerator extends BaseGenerator {
  getTargetName(): string {
    return 'claude';
  }

  async generate(_artifacts: ArtifactCollection): Promise<GeneratedFile[]> {
    const epics = await listArtifacts(this.projectDir, this.config, 'epic');
    const features = await listArtifacts(this.projectDir, this.config, 'feature');
    const date = new Date().toISOString().split('T')[0];
    const implementationGuidance = this.includesAgile()
      ? await this.renderImplementationGuidance()
      : '';
    const hostNativeGuidance = this.includesPipeline()
      ? await renderTemplate(
          'rules/shared/host-native-guidance.md.hbs',
          {
            specInvocation: '/planr:spec',
            planInvocation: '/planr:plan',
            shipInvocation: '/planr:ship',
          },
          this.config.templateOverrides,
        )
      : '';
    const files: GeneratedFile[] = [];

    // CLAUDE.md is planr-managed as a whole — splice via marker so
    // hand-written content above/below the managed block is preserved.
    const claudeContent = await renderTemplate(
      'rules/claude/CLAUDE.md.hbs',
      {
        projectName: this.config.projectName,
        agilePath: this.config.outputPaths.agile,
        date,
        existingEpics: epics,
        existingFeatures: features,
        pipelineScope: this.includesPipeline(),
        implementationGuidance,
        hostNativeGuidance,
      },
      this.config.templateOverrides,
    );
    files.push({
      path: path.join(this.config.outputPaths.claudeConfig, 'CLAUDE.md'),
      content: claudeContent,
      markerName: 'agile',
    });

    return files;
  }
}
