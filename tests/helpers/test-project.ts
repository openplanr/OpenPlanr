/**
 * Test helper: creates a temporary project directory with valid config
 * and sample artifacts for integration testing.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenPlanrConfig } from '../../src/models/types.js';
import { createDefaultConfig } from '../../src/services/config-service.js';
import { ensureDir, writeFile } from '../../src/utils/fs.js';

export interface TestProject {
  dir: string;
  config: OpenPlanrConfig;
  cleanup: () => void;
}

/**
 * Create a temporary project with .planr/config.json and artifact directories.
 */
export async function createTestProject(projectName = 'test-project'): Promise<TestProject> {
  const dir = mkdtempSync(join(tmpdir(), 'planr-integration-'));
  const config = createDefaultConfig(projectName);

  // Write config
  await writeFile(join(dir, '.planr', 'config.json'), `${JSON.stringify(config, null, 2)}\n`);

  // Create artifact directories
  const agileDir = join(dir, config.outputPaths.agile);
  await ensureDir(join(agileDir, 'epics'));
  await ensureDir(join(agileDir, 'features'));
  await ensureDir(join(agileDir, 'stories'));
  await ensureDir(join(agileDir, 'tasks'));

  return {
    dir,
    config,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Write a sample epic markdown file.
 */
export async function writeSampleEpic(
  projectDir: string,
  config: OpenPlanrConfig,
  id: string,
  title: string,
  featureLinks: string[] = [],
): Promise<void> {
  const slug = title.toLowerCase().replace(/\s+/g, '-');
  const filename = `${id}-${slug}.md`;
  const dir = join(projectDir, config.outputPaths.agile, 'epics');

  const featuresSection =
    featureLinks.length > 0
      ? featureLinks.join('\n')
      : `_No features created yet. Run \`planr feature create --epic ${id}\` to create features._`;

  const content = `---
id: "${id}"
title: "${title}"
owner: "Engineering"
created: "2026-03-28"
updated: "2026-03-28"
status: "planning"
project: "${config.projectName}"
---

# ${id}: ${title}

## Business Value
Test business value.

## Target Users
Test users.

## Problem Statement
Test problem.

## Solution Overview
Test solution.

## Success Criteria
- Criterion 1
- Criterion 2

## Key Features
- Feature 1
- Feature 2

## Dependencies
None

## Risks
None

## Features
${featuresSection}
`;

  await writeFile(join(dir, filename), content);
}

/**
 * Write a sample feature markdown file.
 */
export async function writeSampleFeature(
  projectDir: string,
  config: OpenPlanrConfig,
  id: string,
  title: string,
  epicId: string,
  storyLinks: string[] = [],
): Promise<void> {
  const slug = title.toLowerCase().replace(/\s+/g, '-');
  const filename = `${id}-${slug}.md`;
  const dir = join(projectDir, config.outputPaths.agile, 'features');

  const storiesSection =
    storyLinks.length > 0
      ? storyLinks.join('\n')
      : `_No user stories created yet. Run \`planr story create --feature ${id}\` to create user stories._`;

  const content = `---
id: "${id}"
title: "${title}"
epicId: "${epicId}"
owner: "Engineering"
created: "2026-03-28"
updated: "2026-03-28"
status: "planning"
---

# ${id}: ${title}

**Epic:** [${epicId}](../epics/${epicId}-test-epic.md)

## Overview
Test overview for ${title}.

## Functional Requirements
- Requirement 1
- Requirement 2

## User Stories
${storiesSection}

## Dependencies
None

## Technical Considerations
None

## Risks
None

## Success Metrics
Test metrics.
`;

  await writeFile(join(dir, filename), content);
}

/**
 * Write a sample story markdown file.
 */
export async function writeSampleStory(
  projectDir: string,
  config: OpenPlanrConfig,
  id: string,
  title: string,
  featureId: string,
  taskLinks: string[] = [],
): Promise<void> {
  const slug = title.toLowerCase().replace(/\s+/g, '-');
  const filename = `${id}-${slug}.md`;
  const dir = join(projectDir, config.outputPaths.agile, 'stories');

  const tasksSection =
    taskLinks.length > 0
      ? taskLinks.join('\n')
      : `_Run \`planr task create --story ${id}\` to generate tasks._`;

  const content = `---
id: "${id}"
title: "${title}"
featureId: "${featureId}"
created: "2026-03-28"
updated: "2026-03-28"
status: "planning"
---

# ${id}: ${title}

**Feature:** [${featureId}](../features/${featureId}-test-feature.md)

## User Story
**As a** developer
**I want to** ${title.toLowerCase()}
**So that** I can be productive

## Acceptance Criteria
See [${id}-gherkin.feature](./${id}-gherkin.feature) for detailed Gherkin scenarios.

## Tasks
${tasksSection}
`;

  await writeFile(join(dir, filename), content);
}
