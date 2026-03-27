import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to mock fs before importing template-service since it registers
// Handlebars helpers at module load time
vi.mock('../../src/utils/fs.js', () => ({
  readFile: vi.fn(),
  fileExists: vi.fn(),
}));

vi.mock('../../src/utils/constants.js', () => ({
  CONFIG_FILENAME: 'planr.config.json',
  getTemplatesDir: vi.fn(() => '/default/templates'),
}));

import { renderTemplate } from '../../src/services/template-service.js';
import { readFile, fileExists } from '../../src/utils/fs.js';
const mockReadFile = vi.mocked(readFile);
const mockFileExists = vi.mocked(fileExists);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('renderTemplate', () => {
  it('renders a simple Handlebars template', async () => {
    mockReadFile.mockResolvedValue('# {{title}}\n\nBy {{author}}');

    const result = await renderTemplate('test.md.hbs', {
      title: 'My Epic',
      author: 'Jane',
    });

    expect(result).toBe('# My Epic\n\nBy Jane');
  });

  it('renders with the join helper', async () => {
    mockReadFile.mockResolvedValue('Tags: {{join tags ", "}}');

    const result = await renderTemplate('join-test.hbs', {
      tags: ['security', 'auth', 'login'],
    });

    expect(result).toBe('Tags: security, auth, login');
  });

  it('renders with the uppercase helper', async () => {
    mockReadFile.mockResolvedValue('Status: {{uppercase status}}');

    const result = await renderTemplate('upper-test.hbs', {
      status: 'active',
    });

    expect(result).toBe('Status: ACTIVE');
  });

  it('renders with the checkboxList helper', async () => {
    mockReadFile.mockResolvedValue('{{checkboxList items}}');

    const result = await renderTemplate('checkbox-test.hbs', {
      items: ['Task A', 'Task B'],
    });

    expect(result).toBe('- [ ] Task A\n- [ ] Task B');
  });

  it('handles missing data gracefully', async () => {
    mockReadFile.mockResolvedValue('Hello {{name}}!');

    const result = await renderTemplate('missing-test.hbs', {});
    expect(result).toBe('Hello !');
  });

  it('uses override directory when file exists there', async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue('OVERRIDE: {{title}}');

    const result = await renderTemplate('test.hbs', { title: 'Test' }, '/custom/templates');

    expect(mockFileExists).toHaveBeenCalledWith('/custom/templates/test.hbs');
    expect(result).toBe('OVERRIDE: Test');
  });

  it('falls back to default templates when override not found', async () => {
    mockFileExists.mockResolvedValue(false);
    mockReadFile.mockResolvedValue('DEFAULT: {{title}}');

    const result = await renderTemplate('test.hbs', { title: 'Test' }, '/custom/templates');

    expect(mockReadFile).toHaveBeenCalledWith('/default/templates/test.hbs');
    expect(result).toBe('DEFAULT: Test');
  });
});
