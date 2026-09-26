import { withDocumentDigest } from '../src/canonical-json.mjs';
import { SKILL_SOURCE_V17_REGISTRIES } from '../src/skill-source-contracts.mjs';
import {
  buildSkillSourceRegistries,
  buildSkillSourceSchemas,
} from './skill-source-definitions.mjs';

function successor(value) {
  return JSON.parse(
    JSON.stringify(value).replaceAll('1.6.0', '1.7.0').replaceAll('Protocol 1.6', 'Protocol 1.7'),
  );
}

/** Additive successors; Protocol 1.6 generation remains byte-identical. */
export function buildSkillSourceSchemasV17() {
  const schemas = new Map(
    [...buildSkillSourceSchemas()].map(([name, value]) => [name, successor(value)]),
  );
  const common = schemas.get('common.schema.json');
  common.$defs.capabilityAuthority.enum.push('local-execution');
  common.$defs.capabilityAuthority.enum.sort();
  common.$defs.authorityCeiling.properties.repositoryAccess.enum.unshift('request-scope');
  common.$defs.authorityCeiling.properties.repositoryAccess.description =
    'Narrowing order request-scope -> declared-paths -> read-only -> none.';
  return schemas;
}

export function buildSkillSourceRegistriesV17() {
  return new Map(
    [...buildSkillSourceRegistries()].map(([name, value]) => {
      const descriptor = SKILL_SOURCE_V17_REGISTRIES[name];
      if (!descriptor) throw new Error(`Protocol 1.7 registry descriptor missing for ${name}.`);
      return [
        name,
        withDocumentDigest({
          ...value,
          protocolVersion: '1.7.0',
          schemaVersion: descriptor.schemaVersion,
          documentVersion: descriptor.documentVersion,
        }),
      ];
    }),
  );
}
