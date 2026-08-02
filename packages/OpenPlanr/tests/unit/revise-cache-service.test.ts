import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hashArtifactContent,
  hashCodebaseContext,
  loadCache,
  recordOutcome,
  saveCache,
  shouldSkipArtifact,
} from '../../src/services/revise-cache-service.js';

describe('revise-cache-service', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'planr-revise-cache-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('loadCache returns an empty cache when the file is missing', () => {
    const cache = loadCache(tmpDir);
    expect(cache.entries).toEqual({});
  });

  it('saveCache + loadCache round-trip entries', async () => {
    const initial = { entries: {} };
    const updated = recordOutcome(
      initial,
      'EPIC-001',
      hashArtifactContent('hello'),
      hashCodebaseContext('## Tech Stack'),
      'skipped-by-agent',
    );
    await saveCache(tmpDir, updated);
    const loaded = loadCache(tmpDir);
    expect(loaded.entries['EPIC-001'].lastOutcome).toBe('skipped-by-agent');
    expect(loaded.entries['EPIC-001'].artifactHash).toEqual(hashArtifactContent('hello'));
  });

  it('loadCache is resilient to malformed JSON (returns empty)', async () => {
    const path = join(tmpDir, '.planr', 'reports', '.revise-cache.json');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(tmpDir, '.planr', 'reports'), { recursive: true });
    writeFileSync(path, '{{ not json');
    const cache = loadCache(tmpDir);
    expect(cache.entries).toEqual({});
  });

  it('shouldSkipArtifact returns false with no prior entry', () => {
    const cache = { entries: {} };
    expect(shouldSkipArtifact(cache, 'EPIC-001', 'abc', 'code-abc')).toBe(false);
  });

  it('shouldSkipArtifact returns true when both hashes match and outcome was skipped-by-agent', () => {
    const cache = recordOutcome(
      { entries: {} },
      'EPIC-001',
      'artifact-abc',
      'code-abc',
      'skipped-by-agent',
    );
    expect(shouldSkipArtifact(cache, 'EPIC-001', 'artifact-abc', 'code-abc')).toBe(true);
  });

  it('shouldSkipArtifact returns false when artifact content changed', () => {
    const cache = recordOutcome(
      { entries: {} },
      'EPIC-001',
      'artifact-abc',
      'code-abc',
      'skipped-by-agent',
    );
    expect(shouldSkipArtifact(cache, 'EPIC-001', 'artifact-new', 'code-abc')).toBe(false);
  });

  it('shouldSkipArtifact returns false when codebase hash changed', () => {
    const cache = recordOutcome(
      { entries: {} },
      'EPIC-001',
      'artifact-abc',
      'code-abc',
      'skipped-by-agent',
    );
    expect(shouldSkipArtifact(cache, 'EPIC-001', 'artifact-abc', 'code-new')).toBe(false);
  });

  it("does NOT skip when the prior outcome was not 'skipped-by-agent'", () => {
    // An artifact that was revised or flagged previously should be re-checked —
    // cache-skip is conservative and only applies to clean-bill-of-health runs.
    const applied = recordOutcome({ entries: {} }, 'EPIC-001', 'h', 'c', 'applied');
    expect(shouldSkipArtifact(applied, 'EPIC-001', 'h', 'c')).toBe(false);
    const flagged = recordOutcome({ entries: {} }, 'EPIC-001', 'h', 'c', 'flagged');
    expect(shouldSkipArtifact(flagged, 'EPIC-001', 'h', 'c')).toBe(false);
  });

  it('hashArtifactContent is deterministic and hex-encoded', () => {
    const h = hashArtifactContent('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashArtifactContent('hello')).toEqual(h);
    expect(hashArtifactContent('world')).not.toEqual(h);
  });

  it('hashCodebaseContext returns undefined when input is undefined', () => {
    expect(hashCodebaseContext(undefined)).toBeUndefined();
    expect(hashCodebaseContext('ctx')).toMatch(/^[0-9a-f]{64}$/);
  });
});
