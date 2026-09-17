import { describe, expect, it } from 'vitest';
import {
  type CapabilityMap,
  capabilityMapContext,
  leadSentence,
} from '../../src/services/capability-map-service.js';

const map: CapabilityMap = {
  kind: 'openplanr-capability-map',
  schemaVersion: '1.0.0',
  pluginVersion: '0.0.0',
  families: [
    { id: 'planning', title: 'Plan and specify' },
    { id: 'quality', title: 'Review and QA' },
    { id: 'design', title: 'Design' },
  ],
  skills: [
    {
      id: 'planr-plan',
      name: 'plan',
      family: 'planning',
      description: 'Turn intent into stories and tasks. Use for planning, not implementation.',
      useWhen: ['Break a specification into tasks', 'Plan a feature'],
      notFor: ['Implement code'],
      deferTo: [],
    },
    {
      id: 'planr-browser-qa',
      name: 'browser-qa',
      family: 'quality',
      description: "Test one feature's routes in a browser.",
      useWhen: ['Test this page'],
      notFor: [],
      deferTo: [],
    },
  ],
  agents: [{ id: 'planr-qa', description: 'Review an implementation. Never edits files.' }],
};

describe('capabilityMapContext', () => {
  it('groups skills by the family order of the map and drops empty families', () => {
    const context = capabilityMapContext(map, { prefix: '/planr:', includeAgents: true });
    expect(context.families.map((family) => family.title)).toEqual([
      'Plan and specify',
      'Review and QA',
    ]);
    expect(context.families[0].skills[0]).toEqual({
      name: 'plan',
      lead: 'Turn intent into stories and tasks.',
      useWhen: 'Break a specification into tasks; Plan a feature',
      notFor: 'Implement code',
    });
    expect(context.families[1].skills[0].notFor).toBe('');
    expect(context.prefix).toBe('/planr:');
  });

  it('includes agents only for hosts that run them', () => {
    expect(capabilityMapContext(map, { prefix: '$planr:', includeAgents: false }).agents).toEqual(
      [],
    );
    expect(capabilityMapContext(map, { prefix: '/planr:', includeAgents: true }).agents).toEqual([
      { id: 'planr-qa', summary: 'Review an implementation.' },
    ]);
  });
});

describe('leadSentence', () => {
  it('returns the first sentence and the whole text when there is none', () => {
    expect(leadSentence('One. Two.')).toBe('One.');
    expect(leadSentence('No terminator')).toBe('No terminator');
  });
});
