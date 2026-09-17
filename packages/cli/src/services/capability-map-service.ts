import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CapabilitySkill {
  id: string;
  name: string;
  family: string;
  description: string;
  useWhen: string[];
  notFor: string[];
  deferTo: string[];
}

export interface CapabilityAgent {
  id: string;
  description: string;
}

/** The inventory generated into `lib/host-packages/capability-map.json` at build time. */
export interface CapabilityMap {
  kind: 'openplanr-capability-map';
  schemaVersion: string;
  pluginVersion: string;
  families: Array<{ id: string; title: string }>;
  skills: CapabilitySkill[];
  agents: CapabilityAgent[];
}

export interface CapabilityMapContext {
  prefix: string;
  families: Array<{
    title: string;
    skills: Array<{ name: string; lead: string; useWhen: string; notFor: string }>;
  }>;
  agents: Array<{ id: string; summary: string }>;
}

function locateCapabilityMap(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    path.resolve(here, '../../lib/host-packages/capability-map.json'),
    path.resolve(here, '../../../lib/host-packages/capability-map.json'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Read the shipped capability map. `null` only when the package was built without
 * its host packages (a source checkout before `npm run build`); a present but
 * malformed file is an error, not a missing section.
 */
export function readCapabilityMap(): CapabilityMap | null {
  const location = locateCapabilityMap();
  if (!location) return null;
  const parsed = JSON.parse(readFileSync(location, 'utf8')) as Partial<CapabilityMap>;
  if (parsed.kind !== 'openplanr-capability-map' || !Array.isArray(parsed.skills)) {
    throw new Error(`Capability map at ${location} is not an openplanr-capability-map document.`);
  }
  return parsed as CapabilityMap;
}

/** The first sentence of a description, used where a full description would repeat the triggers. */
export function leadSentence(text: string): string {
  const match = /^(.*?[.!?])(?:\s|$)/u.exec(text.trim());
  return match ? match[1] : text.trim();
}

/**
 * Shape the map for the instruction templates: skills grouped in the map's family
 * order under a host-specific invocation prefix, agents only for hosts that run them.
 */
export function capabilityMapContext(
  map: CapabilityMap,
  options: { prefix: string; includeAgents: boolean },
): CapabilityMapContext {
  const families = map.families
    .map((family) => ({
      title: family.title,
      skills: map.skills
        .filter((skill) => skill.family === family.id)
        .map((skill) => ({
          name: skill.name,
          lead: leadSentence(skill.description),
          useWhen: skill.useWhen.join('; '),
          notFor: skill.notFor.join('; '),
        })),
    }))
    .filter((family) => family.skills.length > 0);
  const agents = options.includeAgents
    ? map.agents.map((agent) => ({ id: agent.id, summary: leadSentence(agent.description) }))
    : [];
  return { prefix: options.prefix, families, agents };
}
