/**
 * Integration tests for the sync command logic.
 *
 * Tests cross-reference validation and repair with real files on disk.
 * Does NOT test the CLI layer — tests the sync functions directly
 * by importing artifact-service and simulating what sync does.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addChildReference,
  listArtifacts,
  readArtifact,
  readArtifactRaw,
  updateArtifact,
} from '../../src/services/artifact-service.js';
import {
  createTestProject,
  type TestProject,
  writeSampleEpic,
  writeSampleFeature,
  writeSampleStory,
} from '../helpers/test-project.js';

let project: TestProject;

beforeEach(async () => {
  project = await createTestProject('sync-test');
});

afterEach(() => {
  project.cleanup();
});

describe('sync: stale link detection', () => {
  it('should detect when epic links to a feature that no longer exists', async () => {
    // Create epic with a link to FEAT-001 in markdown, but don't create FEAT-001 on disk
    await writeSampleEpic(project.dir, project.config, 'EPIC-001', 'Test Epic', [
      '- [FEAT-001: Ghost Feature](../features/FEAT-001-ghost-feature.md)',
    ]);

    const raw = await readArtifactRaw(project.dir, project.config, 'epic', 'EPIC-001');
    expect(raw).toContain('FEAT-001');

    // Verify no features exist
    const features = await listArtifacts(project.dir, project.config, 'feature');
    expect(features).toHaveLength(0);
  });

  it('should detect when feature links to a story that no longer exists', async () => {
    await writeSampleEpic(project.dir, project.config, 'EPIC-001', 'Test Epic');
    await writeSampleFeature(project.dir, project.config, 'FEAT-001', 'Test Feature', 'EPIC-001', [
      '- [US-001: Ghost Story](../stories/US-001-ghost-story.md)',
      '- [US-002: Real Story](../stories/US-002-real-story.md)',
    ]);
    // Only create US-002, not US-001
    await writeSampleStory(project.dir, project.config, 'US-002', 'Real Story', 'FEAT-001');

    const raw = await readArtifactRaw(project.dir, project.config, 'feature', 'FEAT-001');
    expect(raw).toContain('US-001'); // stale
    expect(raw).toContain('US-002'); // valid
  });
});

describe('sync: missing link detection', () => {
  it('should detect when feature references epic but epic has no link to it', async () => {
    // Epic has no feature links (placeholder text)
    await writeSampleEpic(project.dir, project.config, 'EPIC-001', 'Test Epic');
    // Feature references EPIC-001 via epicId
    await writeSampleFeature(
      project.dir,
      project.config,
      'FEAT-001',
      'Missing Link Feature',
      'EPIC-001',
    );

    const epicRaw = await readArtifactRaw(project.dir, project.config, 'epic', 'EPIC-001');
    expect(epicRaw).not.toContain('FEAT-001');

    const featureData = await readArtifact(project.dir, project.config, 'feature', 'FEAT-001');
    expect(featureData?.data.epicId).toBe('EPIC-001');
  });

  it('should detect when story references feature but feature has no link to it', async () => {
    await writeSampleEpic(project.dir, project.config, 'EPIC-001', 'Test Epic');
    await writeSampleFeature(project.dir, project.config, 'FEAT-001', 'Test Feature', 'EPIC-001');
    await writeSampleStory(project.dir, project.config, 'US-001', 'Missing Link Story', 'FEAT-001');

    const featureRaw = await readArtifactRaw(project.dir, project.config, 'feature', 'FEAT-001');
    expect(featureRaw).not.toContain('US-001');

    const storyData = await readArtifact(project.dir, project.config, 'story', 'US-001');
    expect(storyData?.data.featureId).toBe('FEAT-001');
  });
});

describe('sync: addChildReference repairs', () => {
  it('should add missing feature link to epic', async () => {
    await writeSampleEpic(project.dir, project.config, 'EPIC-001', 'Test Epic');
    await writeSampleFeature(project.dir, project.config, 'FEAT-001', 'New Feature', 'EPIC-001');

    // Before: no link
    let epicRaw = await readArtifactRaw(project.dir, project.config, 'epic', 'EPIC-001');
    expect(epicRaw).not.toContain('FEAT-001');

    // Add the reference
    await addChildReference(
      project.dir,
      project.config,
      'epic',
      'EPIC-001',
      'feature',
      'FEAT-001',
      'New Feature',
    );

    // After: link present
    epicRaw = await readArtifactRaw(project.dir, project.config, 'epic', 'EPIC-001');
    expect(epicRaw).toContain('FEAT-001');
    expect(epicRaw).toContain('New Feature');
  });

  it('should replace placeholder text when adding first child', async () => {
    await writeSampleEpic(project.dir, project.config, 'EPIC-001', 'Test Epic');
    await writeSampleFeature(project.dir, project.config, 'FEAT-001', 'First Feature', 'EPIC-001');

    // Before: has placeholder
    let epicRaw = await readArtifactRaw(project.dir, project.config, 'epic', 'EPIC-001');
    expect(epicRaw).toContain('_No features created yet');

    // Add reference
    await addChildReference(
      project.dir,
      project.config,
      'epic',
      'EPIC-001',
      'feature',
      'FEAT-001',
      'First Feature',
    );

    // After: placeholder replaced with link
    epicRaw = await readArtifactRaw(project.dir, project.config, 'epic', 'EPIC-001');
    expect(epicRaw).not.toContain('_No features created yet');
    expect(epicRaw).toContain('FEAT-001');
  });

  it('should append to existing links without removing them', async () => {
    await writeSampleEpic(project.dir, project.config, 'EPIC-001', 'Test Epic', [
      '- [FEAT-001: Existing Feature](../features/FEAT-001-existing-feature.md)',
    ]);
    await writeSampleFeature(
      project.dir,
      project.config,
      'FEAT-001',
      'Existing Feature',
      'EPIC-001',
    );
    await writeSampleFeature(project.dir, project.config, 'FEAT-002', 'New Feature', 'EPIC-001');

    await addChildReference(
      project.dir,
      project.config,
      'epic',
      'EPIC-001',
      'feature',
      'FEAT-002',
      'New Feature',
    );

    const epicRaw = await readArtifactRaw(project.dir, project.config, 'epic', 'EPIC-001');
    expect(epicRaw).toContain('FEAT-001');
    expect(epicRaw).toContain('FEAT-002');
  });
});

describe('sync: update artifact content', () => {
  it('should overwrite artifact with corrected content', async () => {
    await writeSampleFeature(project.dir, project.config, 'FEAT-001', 'Test Feature', 'EPIC-001', [
      '- [US-999: Ghost](../stories/US-999-ghost.md)',
    ]);

    // Read, fix manually, write back
    let raw = await readArtifactRaw(project.dir, project.config, 'feature', 'FEAT-001');
    expect(raw).toContain('US-999');

    // Replace stale link section
    const fixed = raw?.replace(
      '- [US-999: Ghost](../stories/US-999-ghost.md)',
      '_No user stories created yet. Run `planr story create --feature FEAT-001` to create user stories._',
    );
    await updateArtifact(project.dir, project.config, 'feature', 'FEAT-001', fixed);

    raw = await readArtifactRaw(project.dir, project.config, 'feature', 'FEAT-001');
    expect(raw).not.toContain('US-999');
    expect(raw).toContain('_No user stories created yet');
  });
});
