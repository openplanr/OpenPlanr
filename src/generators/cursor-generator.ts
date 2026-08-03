import path from 'node:path';
import type { ArtifactCollection, GeneratedFile } from '../models/types.js';
import { resolvePipelinePackage } from '../services/pipeline-package-service.js';
import { renderTemplate } from '../services/template-service.js';
import { readFile } from '../utils/fs.js';
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

interface PortableRole {
  id: string;
  phase: string;
  activation: string;
  capability: string;
  writeBoundary: string;
}

export class CursorGenerator extends BaseGenerator {
  getTargetName(): string {
    return 'cursor';
  }

  async generate(artifacts: ArtifactCollection): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];
    const rulesDir = this.config.outputPaths.cursorRules;

    const baseData = {
      projectName: this.config.projectName,
      agilePath: this.config.outputPaths.agile,
      existingEpics: artifacts.epics.map((e) => ({ id: e.id, title: e.title })),
      existingFeatures: artifacts.features.map((f) => ({ id: f.id, title: f.title })),
      existingStories: artifacts.stories.map((s) => ({ id: s.id, title: s.title })),
    };

    // ── Agile-mode rules ─────────────────────────────────────────────────
    if (this.includesAgile()) {
      files.push(...(await this.renderMdcTemplates(AGILE_CURSOR_TEMPLATES, baseData, rulesDir)));
    }

    // ── Pipeline-mode rules (Cursor adapter for planr-pipeline) ──────
    if (this.includesPipeline()) {
      const pipeline = resolvePipelinePackage();
      if (!pipeline) throw new Error('E_PIPELINE_NOT_INSTALLED');
      const portableRule = await readFile(
        path.join(pipeline.root, 'adapters', 'cursor', 'rules', 'openplanr.mdc'),
      );
      files.push({ path: path.join(rulesDir, 'openplanr.mdc'), content: portableRule });

      const roleRegistry = JSON.parse(await readFile(pipeline.roleRegistryPath)) as {
        roles: PortableRole[];
      };
      for (const role of roleRegistry.roles) {
        const content = [
          `# ${role.id}`,
          '',
          `Capability tier: \`${role.capability}\``,
          `Phase: \`${role.phase}\``,
          `Activation: \`${role.activation}\``,
          '',
          `- ${role.writeBoundary}`,
          '',
        ].join('\n');
        files.push({ path: path.join(rulesDir, 'openplanr-roles', `${role.id}.md`), content });
      }

      const deprecation =
        '---\ndescription: Deprecated OpenPlanr pipeline alias\nalwaysApply: false\n---\n\nThis compatibility alias is deprecated. Use the portable `openplanr.mdc` rule.\n';
      for (const legacy of [
        'planr-pipeline.mdc',
        'planr-pipeline-plan.mdc',
        'planr-pipeline-ship.mdc',
      ]) {
        files.push({ path: path.join(rulesDir, legacy), content: deprecation });
      }
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
