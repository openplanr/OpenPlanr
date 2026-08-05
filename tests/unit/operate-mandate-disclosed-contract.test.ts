import { describe, expect, it } from 'vitest';
import {
  attachMandateResponseContract,
  buildOperatingMandate,
  collectAdvisorResponseContractIssues,
  createRegistryReconciledAdvisorBrief,
  type OperatingMandate,
} from '../../src/services/operate/advisors.js';
import { loadOperatingProtocol } from '../../src/services/operate/protocol.js';
import type { OperatingRoleId } from '../../src/services/operate/types.js';

// DEFECT under test: a Protocol v1.4 mandate ENFORCES
// `operating-advisor-response@1.4.0` but disclosed the frozen v1.2 contract,
// because the disclosure was serialized from the pack-style brief (a v1.2
// compatibility projection). An advisor that followed the disclosed contract
// literally was rejected by the enforced schema. The disclosed contract must be
// the enforced one.

const PINNED_REVISION = '4f2c1b9d6e3a7c5081b2d4e6f8a0c2b4d6e8f012';

async function disclosedMandate(roleId: OperatingRoleId): Promise<OperatingMandate> {
  const protocol = await loadOperatingProtocol();
  const mandate = await buildOperatingMandate({ roleId, roots: ['src', '.planr'] });
  return attachMandateResponseContract(
    mandate,
    createRegistryReconciledAdvisorBrief(protocol, roleId),
  );
}

function disclosedSchema(mandate: OperatingMandate): Record<string, unknown> {
  const jsonSchema = mandate.output?.jsonSchema;
  if (!jsonSchema) throw new Error(`${mandate.roleId} mandate disclosed no response JSON Schema.`);
  return jsonSchema;
}

function schemaNode(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON Schema object node.');
  }
  return value as Record<string, unknown>;
}

/**
 * Author the response the DISCLOSED contract asks for — selected by the disclosed
 * schema's own `$id`, never by what the enforcer happens to want. Before the fix
 * the disclosed `$id` is the v1.2 document, so this authors the v1.2 payload and
 * the enforced v1.4 validation rejects it; after the fix it authors the v1.4
 * payload the enforcer accepts.
 */
function authorResponseForDisclosedContract(mandate: OperatingMandate): Record<string, unknown> {
  const identifier = disclosedSchema(mandate).$id;
  if (typeof identifier !== 'string') {
    throw new Error(`${mandate.roleId} mandate disclosed a schema without an $id.`);
  }
  if (identifier.includes('/v1.4.0/')) {
    const citations = [
      {
        kind: 'repository',
        path: 'src/services/operate/advisors.ts',
        startLine: 1,
        endLine: 12,
        revision: PINNED_REVISION,
      },
    ];
    return {
      outcome: 'actions',
      analysisMarkdown: '# Lens\n\nThe disclosed contract is the enforced contract.',
      claims: [
        {
          id: 'CLM-1',
          statement: 'The prepared mandate discloses the schema its runtime is validated against.',
          epistemicStatus: 'observed',
          confidence: 4,
          citations,
        },
      ],
      actions: [
        {
          actionKey: 'ACT-1',
          title: 'Keep the disclosed and enforced response contracts identical',
          summary: 'Resolve the disclosed response schema from the mandate responseSchema.',
          lane: 'DEV',
          routeKind: 'quick-task',
          horizon: 'immediate',
          confidence: 4,
          citations,
        },
      ],
      gaps: [],
      conflicts: [],
    };
  }
  if (identifier.includes('/v1.2.0/') || identifier.includes('/v1.3.0/')) {
    return { outcome: 'quiet', proposals: [], gaps: [], conflicts: [] };
  }
  throw new Error(`Unrecognized disclosed response schema: ${identifier}`);
}

describe('the prepared mandate discloses the response contract it enforces', () => {
  it('discloses a v1.4 schema whose $id and version equal the mandate responseSchema', async () => {
    const mandate = await disclosedMandate('strategy-finance');

    expect(mandate.protocolVersion).toBe('1.4.0');
    expect(mandate.responseSchema).toBe('operating-advisor-response@1.4.0');
    // The disclosed schema NAME is the enforced one …
    expect(mandate.output?.schema).toBe(mandate.responseSchema);
    // … and so is the disclosed DOCUMENT: same kind, same protocol version.
    const version = mandate.responseSchema.split('@')[1];
    expect(disclosedSchema(mandate).$id).toBe(
      `https://openplanr.dev/schemas/v${version}/operating-advisor-response.schema.json`,
    );

    // The disclosed document is the v1.4 narrative contract, not the v1.2 one.
    const schema = disclosedSchema(mandate);
    expect(schema.required).toEqual([
      'outcome',
      'analysisMarkdown',
      'claims',
      'actions',
      'gaps',
      'conflicts',
    ]);
    expect(schemaNode(schemaNode(schema.properties).outcome).enum).toEqual([
      'actions',
      'quiet',
      'partial',
    ]);
    expect(schemaNode(schema.properties).proposals).toBeUndefined();

    // The citation resource the schema references travels with it, so the
    // disclosure has no reference a mandate-only runtime cannot dereference.
    expect(schemaNode(schemaNode(schema.$defs)['operating-citation']).$id).toBe(
      `https://openplanr.dev/schemas/v${version}/operating-citation.schema.json`,
    );
  });

  it('discloses bounds a v1.4 response can actually express, within the enforced set', async () => {
    const protocol = await loadOperatingProtocol();
    for (const roleId of ['strategy-finance', 'chair'] as OperatingRoleId[]) {
      const mandate = await disclosedMandate(roleId);
      const brief = createRegistryReconciledAdvisorBrief(protocol, roleId);
      // A v1.4 action carries a routeKind, and only `decision` maps to a decision
      // proposal — no v1.4 action can express data-gap/merge/sequence.
      expect(mandate.output?.allowedProposalTypes, roleId).toEqual(['decision', 'finding']);
      // Disclosed bounds stay inside the bounds the record path enforces.
      for (const type of mandate.output?.allowedProposalTypes ?? []) {
        expect(brief.output.allowedProposalTypes, roleId).toContain(type);
      }
      expect(mandate.output?.maximumProposals, roleId).toBe(brief.output.maximumProposals);
      expect(mandate.output?.maximumOutputBytes, roleId).toBe(brief.output.maximumOutputBytes);
    }
  });

  it('accepts a response authored per the DISCLOSED schema under the ENFORCED validation', async () => {
    const protocol = await loadOperatingProtocol();
    const mandate = await disclosedMandate('strategy-finance');
    const response = authorResponseForDisclosedContract(mandate);

    // The authored payload really does follow the disclosure: its top-level keys
    // are exactly the disclosed required set.
    expect(Object.keys(response).sort()).toEqual(
      [...(disclosedSchema(mandate).required as string[])].sort(),
    );

    // …and the contract the record path actually enforces accepts it.
    const issues = await collectAdvisorResponseContractIssues({
      brief: createRegistryReconciledAdvisorBrief(protocol, mandate.roleId),
      response,
      protocolVersion: mandate.protocolVersion,
    });
    expect(issues).toEqual([]);
  });
});
