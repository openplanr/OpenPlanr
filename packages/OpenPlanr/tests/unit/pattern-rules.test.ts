import { describe, expect, it } from 'vitest';
import { detectPatternRules } from '../../src/ai/codebase/pattern-rules.js';

describe('detectPatternRules', () => {
  describe('generic-crud detector', () => {
    it('detects generic CRUD when service has only generic exports', () => {
      const arch = new Map([
        [
          'src/services/artifact-service.ts',
          `export async function createArtifact(dir, config, type) {}
export async function readArtifact(dir, config, type, id) {}
export async function listArtifacts(dir, config, type) {}
export async function updateArtifact(dir, config, type, id, content) {}`,
        ],
      ]);

      const rules = detectPatternRules(arch, '');
      const crud = rules.find((r) => r.name === 'generic-crud');
      expect(crud).toBeDefined();
      expect(crud?.rule).toContain('artifact-service.ts');
      expect(crud?.antiPattern).toContain('Do NOT create entity-specific');
    });

    it('does not emit rule when service has entity-specific functions', () => {
      const arch = new Map([
        [
          'src/services/user-service.ts',
          `export async function createUser(data) {}
export async function deleteUser(id) {}`,
        ],
      ]);

      const rules = detectPatternRules(arch, '');
      const crud = rules.find((r) => r.name === 'generic-crud');
      expect(crud).toBeUndefined();
    });

    it('does not emit rule when fewer than 2 CRUD functions', () => {
      const arch = new Map([['src/services/helper.ts', 'export function formatDate(d) {}']]);

      const rules = detectPatternRules(arch, '');
      const crud = rules.find((r) => r.name === 'generic-crud');
      expect(crud).toBeUndefined();
    });
  });

  describe('command-registration detector', () => {
    it('detects command registration pattern', () => {
      const arch = new Map([
        [
          'src/cli/index.ts',
          `registerEpicCommand(program);
registerFeatureCommand(program);
registerStoryCommand(program);`,
        ],
      ]);

      const rules = detectPatternRules(arch, '');
      const cmd = rules.find((r) => r.name === 'command-registration');
      expect(cmd).toBeDefined();
      expect(cmd?.rule).toContain('registerEpicCommand');
      expect(cmd?.rule).toContain('src/cli/index.ts');
    });

    it('does not emit rule with fewer than 2 register calls', () => {
      const arch = new Map([['src/index.ts', 'registerMainCommand(program);']]);

      const rules = detectPatternRules(arch, '');
      const cmd = rules.find((r) => r.name === 'command-registration');
      expect(cmd).toBeUndefined();
    });
  });

  describe('central-types detector', () => {
    it('detects central types file with 5+ exports', () => {
      const arch = new Map([
        [
          'src/models/types.ts',
          `export type ArtifactType = 'epic' | 'feature';
export interface OpenPlanrConfig {}
export interface BaseArtifact {}
export interface Epic extends BaseArtifact {}
export interface Feature extends BaseArtifact {}
export type TaskStatus = 'pending' | 'done';`,
        ],
      ]);

      const inventory = 'src/models/: types.ts, schema.ts';
      const rules = detectPatternRules(arch, inventory);
      const types = rules.find((r) => r.name === 'central-types');
      expect(types).toBeDefined();
      expect(types?.rule).toContain('src/models/types.ts');
      expect(types?.rule).toContain('6 exports');
    });

    it('does not emit rule when fewer than 5 type exports', () => {
      const arch = new Map([
        [
          'src/types.ts',
          `export type Foo = string;
export interface Bar {}`,
        ],
      ]);

      const rules = detectPatternRules(arch, '');
      const types = rules.find((r) => r.name === 'central-types');
      expect(types).toBeUndefined();
    });
  });

  describe('id-generation detector', () => {
    it('detects ID generation with prefix parameter', () => {
      const arch = new Map([
        [
          'src/services/id-service.ts',
          `export async function getNextId(dir: string, prefix: string): Promise<string> {}
export function parseId(id: string) {}`,
        ],
      ]);

      const rules = detectPatternRules(arch, '');
      const id = rules.find((r) => r.name === 'id-generation');
      expect(id).toBeDefined();
      expect(id?.rule).toContain('getNextId');
      expect(id?.rule).toContain('prefix');
    });

    it('does not emit rule without prefix concept', () => {
      const arch = new Map([['src/utils/id.ts', 'export function generateUUID() {}']]);

      const rules = detectPatternRules(arch, '');
      const id = rules.find((r) => r.name === 'id-generation');
      expect(id).toBeUndefined();
    });
  });

  describe('template-rendering detector', () => {
    it('detects Handlebars template pattern', () => {
      const inventory = 'src/templates/: epic.md.hbs, feature.md.hbs, task-list.md.hbs';

      const rules = detectPatternRules(new Map(), inventory);
      const tpl = rules.find((r) => r.name === 'template-rendering');
      expect(tpl).toBeDefined();
      expect(tpl?.rule).toContain('Handlebars');
      expect(tpl?.antiPattern).toContain('.md.hbs');
    });

    it('does not emit rule without template files', () => {
      const rules = detectPatternRules(new Map(), 'src/utils/: helpers.ts');
      const tpl = rules.find((r) => r.name === 'template-rendering');
      expect(tpl).toBeUndefined();
    });
  });

  describe('multiple detectors', () => {
    it('emits multiple rules when multiple patterns are detected', () => {
      const arch = new Map([
        [
          'src/services/artifact-service.ts',
          `export async function createArtifact(dir, config, type) {}
export async function listArtifacts(dir, config, type) {}`,
        ],
        [
          'src/cli/index.ts',
          `registerEpicCommand(program);
registerQuickCommand(program);
registerTaskCommand(program);`,
        ],
        [
          'src/services/id-service.ts',
          `export async function getNextId(dir: string, prefix: string) {}`,
        ],
      ]);

      const inventory = 'src/templates/: epic.md.hbs, task.md.hbs';
      const rules = detectPatternRules(arch, inventory);

      expect(rules.find((r) => r.name === 'generic-crud')).toBeDefined();
      expect(rules.find((r) => r.name === 'command-registration')).toBeDefined();
      expect(rules.find((r) => r.name === 'id-generation')).toBeDefined();
      expect(rules.find((r) => r.name === 'template-rendering')).toBeDefined();
    });
  });
});
