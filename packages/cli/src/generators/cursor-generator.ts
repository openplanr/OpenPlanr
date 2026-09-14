import path from 'node:path';
import type { ArtifactCollection, GeneratedFile } from '../models/types.js';
import { renderTemplate } from '../services/template-service.js';
import { BaseGenerator } from './base-generator.js';

/** Agile-mode rules — 6 `.mdc` files for the agile workflow (epic → feature → story → task). */
const AGILE_CURSOR_TEMPLATES = [
  'agile-checklist.mdc.hbs',
  'create-epic.mdc.hbs',
  'create-features.mdc.hbs',
  'create-user-story.mdc.hbs',
  'create-task-list.mdc.hbs',
  'implement-task-list.mdc.hbs',
];

export class CursorGenerator extends BaseGenerator {
  getTargetName(): string {
    return 'cursor';
  }

  async generate(artifacts: ArtifactCollection): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];
    const rulesDir = this.config.outputPaths.cursorRules;
    const implementationGuidance = this.includesAgile()
      ? await this.renderImplementationGuidance()
      : '';

    const baseData = {
      projectName: this.config.projectName,
      agilePath: this.config.outputPaths.agile,
      existingEpics: artifacts.epics.map((e) => ({ id: e.id, title: e.title })),
      existingFeatures: artifacts.features.map((f) => ({ id: f.id, title: f.title })),
      existingStories: artifacts.stories.map((s) => ({ id: s.id, title: s.title })),
      implementationGuidance,
    };

    // ── Agile-mode rules ─────────────────────────────────────────────────
    if (this.includesAgile()) {
      files.push(...(await this.renderMdcTemplates(AGILE_CURSOR_TEMPLATES, baseData, rulesDir)));
    }

    // Pipeline scope contributes concise project guidance only. The complete
    // canonical skill rules are installed by `planr setup` from the bundled
    // Protocol 1.8 host package.
    if (this.includesPipeline()) {
      files.push({
        path: path.join(rulesDir, 'openplanr.mdc'),
        content: await renderTemplate(
          'rules/cursor/openplanr.mdc.hbs',
          baseData,
          this.config.templateOverrides,
        ),
      });
    }

    return files;
  }

  /** Render a list of `.mdc.hbs` templates and emit one `GeneratedFile` per template. */
  private async renderMdcTemplates(
    templateFilenames: string[],
    data: Record<string, unknown>,
    rulesDir: string,
  ): Promise<GeneratedFile[]> {
    const out: GeneratedFile[] = [];
    for (const filename of templateFilenames) {
      const content = await renderTemplate(
        `rules/cursor/${filename}`,
        data,
        this.config.templateOverrides,
      );
      out.push({
        path: path.join(rulesDir, filename.replace('.hbs', '')),
        content,
      });
    }
    return out;
  }
}
