import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  EFFORT_CLASSES,
  REFINEMENT_BUCKETS,
  REFUTER_LENSES,
  refinementDocumentSchema,
} from '../../src/models/sprint-refinement-schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const published = JSON.parse(
  readFileSync(
    path.resolve(here, '../../../../skills/planr-sprint/schemas/refinement.schema.json'),
    'utf8',
  ),
) as {
  required: string[];
  properties: Record<string, JsonSchemaNode>;
  $defs: Record<string, { enum?: string[] }>;
};

interface JsonSchemaNode {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
}

type ObjectSchema = z.ZodObject<Record<string, z.ZodType>>;

function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (;;) {
    const def = current._zod.def as { type: string; innerType?: z.ZodType; element?: z.ZodType };
    if (
      (def.type === 'optional' || def.type === 'default' || def.type === 'nullable') &&
      def.innerType
    ) {
      current = def.innerType;
      continue;
    }
    return current;
  }
}

function keysOf(schema: z.ZodType): string[] {
  return Object.keys((unwrap(schema) as ObjectSchema).shape).sort();
}

function requiredOf(schema: z.ZodType): string[] {
  return Object.entries((unwrap(schema) as ObjectSchema).shape)
    .filter(([, field]) => {
      const type = (field._zod.def as { type: string }).type;
      return type !== 'optional' && type !== 'default';
    })
    .map(([key]) => key)
    .sort();
}

function elementOf(schema: z.ZodType): z.ZodType {
  return (unwrap(schema)._zod.def as { element: z.ZodType }).element;
}

function compareObject(zodSchema: z.ZodType, json: JsonSchemaNode, label: string): void {
  expect(Object.keys(json.properties ?? {}).sort(), `${label} properties`).toEqual(
    keysOf(zodSchema),
  );
  expect([...(json.required ?? [])].sort(), `${label} required`).toEqual(requiredOf(zodSchema));
}

describe('planr-sprint refinement schema parity', () => {
  const shape = refinementDocumentSchema.shape;

  it('publishes the same document, inputs, buckets and applied fields as the CLI validates', () => {
    compareObject(refinementDocumentSchema, published as unknown as JsonSchemaNode, 'document');
    compareObject(shape.inputs, published.properties.inputs, 'inputs');
    compareObject(shape.buckets, published.properties.buckets, 'buckets');
    compareObject(shape.applied, published.properties.applied, 'applied');
    const appliedUpdates = published.properties.applied.properties?.updates.items as JsonSchemaNode;
    compareObject(
      elementOf((unwrap(shape.applied) as ObjectSchema).shape.updates),
      appliedUpdates,
      'applied.updates[]',
    );
  });

  it('publishes the same item, batch, refuted and leftover records', () => {
    compareObject(
      elementOf(shape.items),
      published.properties.items.items as JsonSchemaNode,
      'items[]',
    );
    compareObject(
      elementOf(shape.batches),
      published.properties.batches.items as JsonSchemaNode,
      'batches[]',
    );
    compareObject(
      elementOf(shape.refuted),
      published.properties.refuted.items as JsonSchemaNode,
      'refuted[]',
    );
    compareObject(
      elementOf(shape.leftovers),
      published.properties.leftovers.items as JsonSchemaNode,
      'leftovers[]',
    );
  });

  it('publishes the same bucket, effort and lens vocabularies', () => {
    expect(published.$defs.bucket.enum).toEqual([...REFINEMENT_BUCKETS]);
    expect(published.$defs.effort.enum).toEqual([...EFFORT_CLASSES]);
    expect(published.$defs.lens.enum).toEqual([...REFUTER_LENSES]);
  });
});
