/**
 * Integration tests for artifact lifecycle:
 * create artifacts → verify parent references → verify read/list operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import {
  createTestProject,
  writeSampleEpic,
  writeSampleFeature,
  writeSampleStory,
  type TestProject,
} from '../helpers/test-project.js';
import {
  listArtifacts,
  readArtifact,
  readArtifactRaw,
  findArtifactTypeById,
  addChildReference,
  updateArtifact,
} from '../../src/services/artifact-service.js';
import { readFile } from '../../src/utils/fs.js';

let project: TestProject;

beforeEach(async () => {
  project = await createTestProject('lifecycle-test');
});

afterEach(() => {
  project.cleanup();
});

describe('artifact lifecycle', () => {
  it('should list artifacts from disk', async () => {
    await writeSampleEpic(project.dir, project.config, 'EPIC-001', 'Test Epic');

    const epics = await listArtifacts(project.dir, project.config, 'epic');
    expect(epics).toHaveLength(1);
    expect(epics[0].id).toBe('EPIC-001');
  });

  it('should read artifact with parsed frontmatter', async () => {
    await writeSampleEpic(project.dir, project.config, 'EPIC-001', 'Test Epic');

    const result = await readArtifact(project.dir, project.config, 'epic', 'EPIC-001');
    expect(result).not.toBeNull();
    expect(result!.data.id).toBe('EPIC-001');
    expect(result!.data.title).toBe('Test Epic');
    expect(result!.data.status).toBe('planning');
    expect(result!.content).toContain('## Business Value');
  });

  it('should read raw artifact content', async () => {
    await writeSampleEpic(project.dir, project.config, 'EPIC-001', 'Test Epic');

    const raw = await readArtifactRaw(project.dir, project.config, 'epic', 'EPIC-001');
    expect(raw).not.toBeNull();
    expect(raw).toContain('---');
    expect(raw).toContain('id: "EPIC-001"');
    expect(raw).toContain('## Business Value');
  });

  it('should return null for non-existent artifact', async () => {
    const result = await readArtifact(project.dir, project.config, 'epic', 'EPIC-999');
    expect(result).toBeNull();
  });

  it('should list multiple artifacts sorted', async () => {
    await writeSampleFeature(project.dir, project.config, 'FEAT-001', 'Alpha Feature', 'EPIC-001');
    await writeSampleFeature(project.dir, project.config, 'FEAT-002', 'Beta Feature', 'EPIC-001');
    await writeSampleFeature(project.dir, project.config, 'FEAT-003', 'Gamma Feature', 'EPIC-001');

    const features = await listArtifacts(project.dir, project.config, 'feature');
    expect(features).toHaveLength(3);
    expect(features[0].id).toBe('FEAT-001');
    expect(features[2].id).toBe('FEAT-003');
  });

  it('should update artifact content', async () => {
    await writeSampleEpic(project.dir, project.config, 'EPIC-001', 'Test Epic');

    const newContent = `---
id: "EPIC-001"
title: "Updated Epic"
owner: "Product"
created: "2026-03-28"
updated: "2026-03-28"
status: "active"
project: "lifecycle-test"
---

# EPIC-001: Updated Epic

## Business Value
Updated business value.
`;

    await updateArtifact(project.dir, project.config, 'epic', 'EPIC-001', newContent);

    const result = await readArtifact(project.dir, project.config, 'epic', 'EPIC-001');
    expect(result!.data.title).toBe('Updated Epic');
    expect(result!.data.status).toBe('active');
  });

  it('should add child reference to parent artifact', async () => {
    await writeSampleEpic(project.dir, project.config, 'EPIC-001', 'Test Epic');
    await writeSampleFeature(project.dir, project.config, 'FEAT-001', 'New Feature', 'EPIC-001');

    await addChildReference(
      project.dir,
      project.config,
      'epic',
      'EPIC-001',
      'feature',
      'FEAT-001',
      'New Feature'
    );

    const raw = await readArtifactRaw(project.dir, project.config, 'epic', 'EPIC-001');
    expect(raw).toContain('FEAT-001');
    expect(raw).toContain('New Feature');
  });

  it('should identify artifact type from ID prefix', () => {
    expect(findArtifactTypeById('EPIC-001')).toBe('epic');
    expect(findArtifactTypeById('FEAT-002')).toBe('feature');
    expect(findArtifactTypeById('US-003')).toBe('story');
    expect(findArtifactTypeById('TASK-004')).toBe('task');
    expect(findArtifactTypeById('UNKNOWN-001')).toBeNull();
  });
});

describe('parent-child hierarchy', () => {
  it('should create epic → feature → story chain and verify references', async () => {
    // Create hierarchy
    await writeSampleEpic(project.dir, project.config, 'EPIC-001', 'Parent Epic');
    await writeSampleFeature(project.dir, project.config, 'FEAT-001', 'Child Feature', 'EPIC-001');
    await writeSampleStory(project.dir, project.config, 'US-001', 'Grandchild Story', 'FEAT-001');

    // Add references
    await addChildReference(
      project.dir, project.config, 'epic', 'EPIC-001', 'feature', 'FEAT-001', 'Child Feature'
    );
    await addChildReference(
      project.dir, project.config, 'feature', 'FEAT-001', 'story', 'US-001', 'Grandchild Story'
    );

    // Verify epic → feature link
    const epicRaw = await readArtifactRaw(project.dir, project.config, 'epic', 'EPIC-001');
    expect(epicRaw).toContain('FEAT-001');

    // Verify feature → story link
    const featureRaw = await readArtifactRaw(project.dir, project.config, 'feature', 'FEAT-001');
    expect(featureRaw).toContain('US-001');

    // Verify story references feature
    const storyData = await readArtifact(project.dir, project.config, 'story', 'US-001');
    expect(storyData!.data.featureId).toBe('FEAT-001');
  });

  it('should handle multiple children under same parent', async () => {
    await writeSampleEpic(project.dir, project.config, 'EPIC-001', 'Parent Epic');
    await writeSampleFeature(project.dir, project.config, 'FEAT-001', 'Feature One', 'EPIC-001');
    await writeSampleFeature(project.dir, project.config, 'FEAT-002', 'Feature Two', 'EPIC-001');

    await addChildReference(
      project.dir, project.config, 'epic', 'EPIC-001', 'feature', 'FEAT-001', 'Feature One'
    );
    await addChildReference(
      project.dir, project.config, 'epic', 'EPIC-001', 'feature', 'FEAT-002', 'Feature Two'
    );

    const epicRaw = await readArtifactRaw(project.dir, project.config, 'epic', 'EPIC-001');
    expect(epicRaw).toContain('FEAT-001');
    expect(epicRaw).toContain('FEAT-002');
  });
});
