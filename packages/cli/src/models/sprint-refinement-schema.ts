import { z } from 'zod';

export const REFINEMENT_SCHEMA_VERSION = 1;
export const REFINEMENT_BUCKETS = ['inProgress', 'planNext', 'blocked', 'closeOrDemote'] as const;
export const EFFORT_CLASSES = ['hours', 'day', 'days', 'week+'] as const;
export const REFUTER_LENSES = ['evidence', 'capacity', 'impact'] as const;

export type RefinementBucket = (typeof REFINEMENT_BUCKETS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'expected an ISO date (YYYY-MM-DD)');
const artifactId = z.string().regex(/^[A-Z]+-\d+$/u, 'expected an artifact id such as BL-012');
const sprintId = z.string().regex(/^SPRINT-\d+$/u, 'expected a sprint id such as SPRINT-004');
const text = z.string().trim().min(1);

const inputsSchema = z.strictObject({
  capacityDays: z.number().positive().optional(),
  releaseCut: isoDate.optional(),
  gitRevision: text.optional(),
  previousSprintId: sprintId.optional(),
  operateCycleId: text.optional(),
  sources: z.array(text).default([]),
  defaulted: z.array(text).default([]),
  notes: text.optional(),
});

const itemSchema = z.strictObject({
  id: artifactId,
  title: text,
  claim: text.optional(),
  evidenceDate: isoDate.nullable().default(null),
  codePath: text.nullable().optional(),
  codePathExists: z.boolean().nullable().optional(),
  stale: z.boolean().default(false),
  blockedBy: z.array(text).default([]),
  unblockQuestion: text.optional(),
  effort: z.enum(EFFORT_CLASSES),
  score: z.number(),
  bucket: z.enum(REFINEMENT_BUCKETS),
  reason: text,
  evidence: text.optional(),
  targetStatus: text.optional(),
  targetPriority: text.optional(),
});

const batchSchema = z.strictObject({
  title: text,
  effortDays: z.number().positive().optional(),
  itemIds: z.array(artifactId).min(1),
});

const refutedSchema = z.strictObject({
  itemId: artifactId,
  lens: z.enum(REFUTER_LENSES),
  change: text,
  from: z.enum(REFINEMENT_BUCKETS).optional(),
  to: z.enum([...REFINEMENT_BUCKETS, 'dropped']).optional(),
});

const leftoverSchema = z.strictObject({
  id: artifactId,
  reason: z.enum(['unchecked', 'not-done']),
});

const appliedSchema = z.strictObject({
  at: text,
  updates: z.array(
    z.strictObject({
      id: artifactId,
      type: text,
      fields: z.record(z.string(), z.string()),
    }),
  ),
});

const bucketsSchema = z.strictObject({
  inProgress: z.array(artifactId),
  planNext: z.array(artifactId),
  blocked: z.array(artifactId),
  closeOrDemote: z.array(artifactId),
});

function custom(ctx: z.RefinementCtx, path: (string | number)[], rule: string, message: string) {
  ctx.addIssue({ code: 'custom', path, message, params: { rule } });
}

export const refinementDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(REFINEMENT_SCHEMA_VERSION),
    sprintId,
    refinedAt: isoDate,
    inputs: inputsSchema,
    items: z.array(itemSchema),
    buckets: bucketsSchema,
    batches: z.array(batchSchema).default([]),
    refuted: z.array(refutedSchema).default([]),
    leftovers: z.array(leftoverSchema).optional(),
    applied: appliedSchema.optional(),
  })
  .superRefine((doc, ctx) => {
    const byId = new Map<string, (typeof doc.items)[number]>();
    doc.items.forEach((item, index) => {
      if (byId.has(item.id))
        custom(ctx, ['items', index, 'id'], 'duplicate-item', `${item.id} appears more than once`);
      byId.set(item.id, item);
    });

    for (const bucket of REFINEMENT_BUCKETS) {
      doc.buckets[bucket].forEach((id, index) => {
        const item = byId.get(id);
        if (!item) {
          custom(ctx, ['buckets', bucket, index], 'unknown-item', `${id} is not in items`);
        } else if (item.bucket !== bucket) {
          custom(
            ctx,
            ['buckets', bucket, index],
            'bucket-mismatch',
            `${id} is listed under ${bucket} but its item says ${item.bucket}`,
          );
        }
      });
    }
    doc.items.forEach((item, index) => {
      if (!doc.buckets[item.bucket].includes(item.id))
        custom(
          ctx,
          ['items', index, 'bucket'],
          'bucket-missing',
          `${item.id} is not listed under buckets.${item.bucket}`,
        );
    });

    if (doc.batches.length > 0) {
      const inProgress = new Set(doc.buckets.inProgress);
      const seen = new Set<string>();
      doc.batches.forEach((batch, batchIndex) => {
        batch.itemIds.forEach((id, index) => {
          const path = ['batches', batchIndex, 'itemIds', index];
          if (!inProgress.has(id))
            custom(ctx, path, 'batch-not-in-progress', `${id} is batched but not in progress`);
          if (seen.has(id)) custom(ctx, path, 'batch-duplicate', `${id} is in more than one batch`);
          seen.add(id);
        });
      });
      for (const id of inProgress) {
        if (!seen.has(id))
          custom(ctx, ['batches'], 'batch-incomplete', `${id} is in progress but in no batch`);
      }
    }
  });

export type RefinementDocument = z.infer<typeof refinementDocumentSchema>;
export type RefinementItem = RefinementDocument['items'][number];
export type RefinementBatch = RefinementDocument['batches'][number];
export type RefinementLeftover = NonNullable<RefinementDocument['leftovers']>[number];
export type RefinementApplied = NonNullable<RefinementDocument['applied']>;

/** Items selected for a sprint at creation time, before a refinement document exists. */
export const sprintBatchesInputSchema = z.array(
  z.strictObject({
    title: text,
    effortDays: z.number().positive().optional(),
    items: z
      .array(
        z.strictObject({
          id: artifactId,
          title: text.optional(),
          effort: text.optional(),
          link: text.optional(),
        }),
      )
      .min(1),
  }),
);

export type SprintBatchesInput = z.infer<typeof sprintBatchesInputSchema>;

export interface SchemaDiagnostic {
  path: string;
  rule: string;
  detail: string;
}

/** Map zod issues onto the CLI failure-envelope diagnostics shape (`$.items[3].score`). */
export function toSchemaDiagnostics(error: z.ZodError): SchemaDiagnostic[] {
  return error.issues.map((issue) => {
    const path = issue.path.reduce<string>(
      (acc, segment) =>
        typeof segment === 'number' ? `${acc}[${segment}]` : `${acc}.${String(segment)}`,
      '$',
    );
    const params = (issue as { params?: { rule?: unknown } }).params;
    const rule =
      typeof params?.rule === 'string' ? `refinement:${params.rule}` : `zod:${issue.code}`;
    return { path, rule, detail: issue.message };
  });
}
