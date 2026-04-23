import { describe, expect, it } from 'vitest';
import type { ParsedSubtask } from '../src/agents/task-parser.js';
import type { Epic, Feature, UserStory } from '../src/models/types.js';
import {
  buildEpicProjectDescription,
  buildFeatureIssueBody,
  buildStoryIssueBody,
  formatTaskCheckboxBody,
} from '../src/services/linear-push-service.js';

describe('linear-push-service', () => {
  it('formatTaskCheckboxBody matches parseTaskMarkdown style', () => {
    const parsed: ParsedSubtask[] = [
      { id: '1.0', title: 'A', done: true, parentId: null, depth: 0 },
      { id: '1.1', title: 'B', done: false, parentId: '1.0', depth: 1 },
    ];
    const md = formatTaskCheckboxBody(parsed);
    expect(md).toContain('- [x] **1.0** A');
    expect(md).toContain('  - [ ] 1.1 B');
  });

  it('buildEpicProjectDescription includes major sections', () => {
    const epic: Epic = {
      id: 'EPIC-001',
      title: 'T',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      filePath: 'x',
      owner: 'o',
      businessValue: 'v',
      targetUsers: 'u',
      problemStatement: 'p',
      solutionOverview: 's',
      successCriteria: 'c',
      keyFeatures: [],
      dependencies: 'd',
      risks: 'r',
      featureIds: [],
    };
    const d = buildEpicProjectDescription(epic);
    expect(d).toMatch(/Business value/);
    expect(d).toMatch(/v/);
  });

  it('buildFeatureIssueBody lists functional requirements', () => {
    const f: Feature = {
      id: 'FEAT-001',
      title: 'F',
      createdAt: 'a',
      updatedAt: 'a',
      filePath: 'x',
      epicId: 'EPIC-001',
      owner: 'o',
      status: 'pending',
      overview: 'ov',
      functionalRequirements: ['one', 'two'],
      storyIds: [],
    };
    expect(buildFeatureIssueBody(f)).toMatch(/one/);
  });

  it('buildStoryIssueBody includes acceptance criteria', () => {
    const s: UserStory = {
      id: 'US-001',
      title: 'S',
      createdAt: 'a',
      updatedAt: 'a',
      filePath: 'x',
      featureId: 'FEAT-001',
      role: 'r',
      goal: 'g',
      benefit: 'b',
      acceptanceCriteria: 'ac',
    };
    const body = buildStoryIssueBody(s);
    expect(body).toMatch(/r/);
    expect(body).toMatch(/ac/);
  });

  it('buildStoryIssueBody suppresses the "As a" sentence when role/goal/benefit are empty', () => {
    // Regression for the Modul Events user report: stories stubbed without
    // filled role/goal/benefit pushed "As a ****, I want **** so that ****."
    // verbatim into Linear. The sentence should be omitted entirely when
    // any of the three fields is blank.
    const s: UserStory = {
      id: 'US-002',
      title: 'Stubbed story',
      createdAt: 'a',
      updatedAt: 'a',
      filePath: 'x',
      featureId: 'FEAT-001',
      role: '',
      goal: '',
      benefit: '',
      acceptanceCriteria: '',
    };
    const body = buildStoryIssueBody(s);
    expect(body).toBe(''); // nothing to say — let Linear show just the title
    expect(body).not.toMatch(/\*\*\*\*/);
  });

  it('buildStoryIssueBody suppresses the "As a" sentence but keeps acceptance criteria when only AC is set', () => {
    const s: UserStory = {
      id: 'US-003',
      title: 'AC-only story',
      createdAt: 'a',
      updatedAt: 'a',
      filePath: 'x',
      featureId: 'FEAT-001',
      role: '',
      goal: '',
      benefit: '',
      acceptanceCriteria: 'Given ... When ... Then ...',
    };
    const body = buildStoryIssueBody(s);
    expect(body).toContain('Given ... When ... Then ...');
    expect(body).toContain('**Acceptance criteria**');
    expect(body).not.toMatch(/As a \*\*\*\*/);
  });

  it('buildStoryIssueBody suppresses the sentence when ANY field is blank (strict all-or-nothing)', () => {
    // Partial fill is still unsafe — "As a ****, I want code so that ****."
    // looks broken. The all-or-nothing rule is clearer to the user and
    // closer to the intent of a fully-authored user story.
    const s: UserStory = {
      id: 'US-004',
      title: 'Partial story',
      createdAt: 'a',
      updatedAt: 'a',
      filePath: 'x',
      featureId: 'FEAT-001',
      role: 'developer',
      goal: '', // missing
      benefit: 'ship faster',
      acceptanceCriteria: 'ac',
    };
    const body = buildStoryIssueBody(s);
    expect(body).not.toMatch(/As a \*\*developer\*\*/);
    expect(body).toContain('ac');
  });

  it('buildStoryIssueBody treats whitespace-only fields as empty', () => {
    const s: UserStory = {
      id: 'US-005',
      title: 'Whitespace story',
      createdAt: 'a',
      updatedAt: 'a',
      filePath: 'x',
      featureId: 'FEAT-001',
      role: '   ',
      goal: '\t',
      benefit: '\n',
      acceptanceCriteria: '',
    };
    const body = buildStoryIssueBody(s);
    expect(body).toBe('');
  });

  it('buildStoryIssueBody includes Gherkin scenarios when provided (the Modul-events gap)', () => {
    // Regression: stories following the OpenPlanr convention keep their
    // real acceptance criteria in `<storyId>-gherkin.feature`. Before this
    // fix, the push path never loaded the .feature content and Linear
    // stories rendered empty.
    const s: UserStory = {
      id: 'US-003',
      title: 'Decision matrix',
      createdAt: 'a',
      updatedAt: 'a',
      filePath: 'x',
      featureId: 'FEAT-001',
      role: 'product manager',
      goal: 'a clear decision matrix',
      benefit: 'I can make informed decisions',
      acceptanceCriteria: '',
    };
    const gherkin = [
      'Feature: Create Decision Matrix for Registration Path Selection',
      '',
      '  Scenario: Decision matrix guides registration path selection',
      '    Given I need to configure registration for an event',
      '    When I consult the decision matrix',
      '    Then I can determine whether to use paid or complimentary',
    ].join('\n');
    const body = buildStoryIssueBody(s, gherkin);
    expect(body).toContain('As a **product manager**');
    expect(body).toContain('**Gherkin scenarios**');
    expect(body).toContain('```gherkin');
    expect(body).toContain('Feature: Create Decision Matrix');
    expect(body).toContain('Scenario: Decision matrix guides');
  });

  it('buildStoryIssueBody renders Gherkin alone when all other fields are empty', () => {
    const s: UserStory = {
      id: 'US-006',
      title: 'Gherkin-only story',
      createdAt: 'a',
      updatedAt: 'a',
      filePath: 'x',
      featureId: 'FEAT-001',
      role: '',
      goal: '',
      benefit: '',
      acceptanceCriteria: '',
    };
    const body = buildStoryIssueBody(s, 'Feature: X\n  Scenario: Y');
    expect(body).toContain('**Gherkin scenarios**');
    expect(body).toContain('Feature: X');
    expect(body).not.toMatch(/As a \*\*/);
  });

  it('buildStoryIssueBody ignores null/undefined/whitespace-only Gherkin content', () => {
    const s: UserStory = {
      id: 'US-007',
      title: 'No-gherkin story',
      createdAt: 'a',
      updatedAt: 'a',
      filePath: 'x',
      featureId: 'FEAT-001',
      role: 'user',
      goal: 'a thing',
      benefit: 'a reason',
      acceptanceCriteria: '',
    };
    expect(buildStoryIssueBody(s, null)).toBe(
      'As a **user**, I want **a thing** so that **a reason**.',
    );
    expect(buildStoryIssueBody(s, undefined)).toBe(
      'As a **user**, I want **a thing** so that **a reason**.',
    );
    expect(buildStoryIssueBody(s, '   \n\n   ')).toBe(
      'As a **user**, I want **a thing** so that **a reason**.',
    );
  });
});
