import path from 'node:path';
import type { ArtifactCollection, GeneratedFile } from '../models/types.js';
import { renderTemplate } from '../services/template-service.js';
import { getTemplatesDir, OPENPLANR_PROTOCOL_VERSION } from '../utils/constants.js';
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

/** Pipeline-mode rules — 3 `.mdc` files driving the planr-pipeline two-phase flow on Cursor. */
const PIPELINE_MDC_TEMPLATES = [
  'planr-pipeline.mdc.hbs',
  'planr-pipeline-plan.mdc.hbs',
  'planr-pipeline-ship.mdc.hbs',
];

/**
 * 8 named subagent roles dispatched by the pipeline rules. Body files (system
 * prompts) are vendored from `planr-pipeline/agents/` at build time and
 * copied verbatim to `.cursor/rules/agents/` at generation time. They are NOT
 * Handlebars templates — Cursor's Composer reads them as plain system prompts.
 *
 * Keep in sync with `planr-pipeline/agents/{name}.md` body content.
 */
const PIPELINE_AGENT_NAMES = [
  'db-agent',
  'designer-agent',
  'specification-agent',
  'frontend-agent',
  'backend-agent',
  'qa-agent',
  'devops-agent',
  'doc-gen-agent',
];

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
      const pipelineData = {
        ...baseData,
        protocolVersion: OPENPLANR_PROTOCOL_VERSION,
        cursorRulesRoot: rulesDir,
        agentNames: PIPELINE_AGENT_NAMES,
      };
      files.push(
        ...(await this.renderMdcTemplates(PIPELINE_MDC_TEMPLATES, pipelineData, rulesDir)),
      );
      files.push(...(await this.copyAgentBodies(PIPELINE_AGENT_NAMES, rulesDir)));
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

  /** Copy vendored agent body files verbatim (no Handlebars) under `<rulesDir>/agents/`. */
  private async copyAgentBodies(agentNames: string[], rulesDir: string): Promise<GeneratedFile[]> {
    const out: GeneratedFile[] = [];
    const srcDir = path.join(getTemplatesDir(), 'rules', 'cursor', 'agents');
    for (const name of agentNames) {
      const content = await readFile(path.join(srcDir, `${name}.md`));
      out.push({
        path: path.join(rulesDir, 'agents', `${name}.md`),
        content,
      });
    }
    return out;
  }
}
