import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findProjectRoot } from '../../src/services/config-service.js';

/**
 * Tests for findProjectRoot() — the monorepo-aware project root resolver.
 *
 * Uses real temp directories instead of mocks so we exercise the actual
 * filesystem walk (existsSync, path.dirname, path.parse).
 */
describe('findProjectRoot', () => {
  let root: string;

  beforeEach(() => {
    root = path.join(tmpdir(), `planr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function createPlanrConfig(dir: string) {
    const configDir = path.join(dir, '.planr');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(path.join(configDir, 'config.json'), '{}');
  }

  it('finds .planr/config.json in the current directory', () => {
    createPlanrConfig(root);
    expect(findProjectRoot(root)).toBe(root);
  });

  it('finds .planr/config.json in the parent directory', () => {
    createPlanrConfig(root);
    const child = path.join(root, 'packages', 'app');
    mkdirSync(child, { recursive: true });

    expect(findProjectRoot(child)).toBe(root);
  });

  it('finds .planr/config.json two levels up', () => {
    createPlanrConfig(root);
    const deep = path.join(root, 'packages', 'app', 'src', 'components');
    mkdirSync(deep, { recursive: true });

    expect(findProjectRoot(deep)).toBe(root);
  });

  it('returns the nearest ancestor when multiple .planr dirs exist', () => {
    // Outer project root
    createPlanrConfig(root);
    // Nested project root (closer to startDir)
    const nested = path.join(root, 'packages', 'app');
    createPlanrConfig(nested);
    const deep = path.join(nested, 'src');
    mkdirSync(deep, { recursive: true });

    expect(findProjectRoot(deep)).toBe(nested);
  });

  it('returns startDir when no .planr/config.json found', () => {
    // root exists but has no .planr/ — simulates `planr init` on a fresh project
    expect(findProjectRoot(root)).toBe(root);
  });

  it('does not blow up at filesystem root', () => {
    // Starting from / (or C:\ on Windows) should return startDir, not throw
    const fsRoot = path.parse(root).root;
    expect(() => findProjectRoot(fsRoot)).not.toThrow();
    expect(findProjectRoot(fsRoot)).toBe(fsRoot);
  });
});
