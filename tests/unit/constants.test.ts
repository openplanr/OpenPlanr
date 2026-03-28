import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  CONFIG_FILENAME,
  DEFAULT_AGILE_DIR,
  DEFAULT_CURSOR_RULES_DIR,
  ARTIFACT_DIRS,
  ID_PREFIXES,
  getTemplatesDir,
} from '../../src/utils/constants.js';

describe('constants', () => {
  it('CONFIG_FILENAME is planr.config.json', () => {
    expect(CONFIG_FILENAME).toBe('planr.config.json');
  });

  it('DEFAULT_AGILE_DIR is docs/agile', () => {
    expect(DEFAULT_AGILE_DIR).toBe('docs/agile');
  });

  it('DEFAULT_CURSOR_RULES_DIR is .cursor/rules', () => {
    expect(DEFAULT_CURSOR_RULES_DIR).toBe('.cursor/rules');
  });

  it('ARTIFACT_DIRS has all artifact types', () => {
    expect(ARTIFACT_DIRS.epics).toBe('epics');
    expect(ARTIFACT_DIRS.features).toBe('features');
    expect(ARTIFACT_DIRS.stories).toBe('stories');
    expect(ARTIFACT_DIRS.tasks).toBe('tasks');
    expect(ARTIFACT_DIRS.adrs).toBe('adrs');
    expect(ARTIFACT_DIRS.checklists).toBe('checklists');
  });

  it('ID_PREFIXES maps types to prefixes', () => {
    expect(ID_PREFIXES.epic).toBe('EPIC');
    expect(ID_PREFIXES.feature).toBe('FEAT');
    expect(ID_PREFIXES.story).toBe('US');
    expect(ID_PREFIXES.task).toBe('TASK');
    expect(ID_PREFIXES.adr).toBe('ADR');
  });
});

describe('getTemplatesDir', () => {
  it('returns a path ending in templates', () => {
    const dir = getTemplatesDir();
    expect(dir).toMatch(/templates$/);
  });

  it('returns an absolute path', () => {
    const dir = getTemplatesDir();
    expect(path.isAbsolute(dir)).toBe(true);
  });
});
