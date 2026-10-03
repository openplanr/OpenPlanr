/** Private paste custody uses the same transactional outbox as review operations. */
import { assertPreparedArtifactPaste } from '../share-client.mjs';
import { createReviewOutbox, type ReviewOutbox, type ReviewOutboxScope } from './review-outbox.mjs';
export interface PreparedPaste {
  schemaVersion: '1.0.0';
  kind: 'openplanr-artifact-paste-preparation';
  origin: string;
  body: {
    schemaVersion: '2.0.0';
    operation: 'create';
    id: string;
    creationId: string;
    iv: string;
    ciphertext: string;
    ttl: '1d' | '7d' | '30d';
  };
  key: string;
  custodyToken: string;
  fragmentLength: number;
  compressedBytes: number;
}
type ShareResult = { url?: unknown; deletionToken?: unknown; expiresAt?: unknown };
interface PasteRecord {
  kind: 'prepared-paste' | 'paste-receipt';
  prepared: PreparedPaste;
  result?: ShareResult;
}
const retainedPreparation = Symbol('private-paste-preparation-retained');
function preparation(value: unknown): PreparedPaste {
  assertPreparedArtifactPaste(value);
  return value as PreparedPaste;
}
function receipt(prepared: PreparedPaste, value: ShareResult | null): ShareResult {
  const url = new URL(`/p/${prepared.body.id}`, prepared.origin);
  url.hash = `k=${prepared.key}&v=2`;
  if (
    !value ||
    value.url !== url.toString() ||
    value.deletionToken !== prepared.custodyToken ||
    typeof value.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(value.expiresAt))
  )
    throw new Error('Paste receipt differs from saved private custody.');
  return value;
}
export function createDurablePasteShare<Request extends { transport: string; ttl?: string }>({
  scope,
  create,
  commit,
  indexedDB = globalThis.indexedDB,
  databaseName = 'openplanr-paste-custody-v1',
}: {
  scope: () => ReviewOutboxScope;
  create: (
    request: Request & { onPreparedPaste?: (value: unknown) => Promise<void> },
  ) => PromiseLike<ShareResult | null> | ShareResult | null;
  commit: (prepared: unknown) => PromiseLike<ShareResult | null> | ShareResult | null;
  indexedDB?: IDBFactory;
  databaseName?: string;
}) {
  const queues = new Map<string, ReviewOutbox>();
  function queueFor(request: Request) {
    const base = scope(),
      revisionId = `${base.revisionId}:${request.ttl ?? '7d'}`,
      identity = JSON.stringify({ ...base, revisionId });
    let queue = queues.get(identity);
    if (!queue) {
      queue = createReviewOutbox({ scope: { ...base, revisionId }, indexedDB, databaseName });
      queues.set(identity, queue);
    }
    return queue;
  }
  const activeReceipt = (entries: Awaited<ReturnType<ReviewOutbox['list']>>) =>
    entries
      .map((entry) => entry.payload as PasteRecord)
      .find(
        (value) =>
          value?.kind === 'paste-receipt' &&
          typeof value.result?.expiresAt === 'string' &&
          Date.parse(value.result.expiresAt) > Date.now(),
      );
  return {
    async run(request: Request): Promise<ShareResult | null> {
      if (request.transport !== 'short') return create(request);
      const queue = queueFor(request);
      let entries = await queue.list();
      const prior = activeReceipt(entries);
      if (prior) return receipt(preparation(prior.prepared), prior.result ?? null);
      let pending = entries.find(
        (entry) => (entry.payload as PasteRecord)?.kind === 'prepared-paste',
      );
      if (pending?.status === 'quarantined')
        throw new Error(
          'The saved paste operation was rejected. Its private recovery custody is retained.',
        );
      if (!pending) {
        try {
          await create({
            ...request,
            onPreparedPaste: async (value) => {
              const prepared = preparation(value);
              if (prepared.body.ttl !== (request.ttl ?? '7d'))
                throw new Error('Prepared paste expiry differs.');
              await queue.enqueue({
                operationId: prepared.body.creationId,
                payload: { kind: 'prepared-paste', prepared } satisfies PasteRecord,
              });
              throw retainedPreparation;
            },
          });
        } catch (error) {
          if (error !== retainedPreparation) throw error;
        }
        entries = await queue.list();
        pending = entries.find(
          (entry) => (entry.payload as PasteRecord)?.kind === 'prepared-paste',
        );
        if (!pending)
          throw new Error(
            'This host did not retain paste custody before publication. Update OpenPlanr and retry.',
          );
      }
      await queue.retry(pending.operationId);
      let result: ShareResult | null = null;
      await queue.drain(async (entry) => {
        const value = entry.payload as PasteRecord;
        if (value?.kind === 'paste-receipt')
          return { status: 'rejected', code: 'private-custody-receipt' };
        try {
          const prepared = preparation(value?.prepared);
          const created = receipt(prepared, await commit(prepared));
          // The receipt is durable before the original operation is removed. A crash
          // between these transactions leaves recoverable custody and an exact retry.
          const receiptId = `${prepared.body.creationId}:receipt`;
          await queue.enqueue({
            operationId: receiptId,
            payload: { kind: 'paste-receipt', prepared, result: created } satisfies PasteRecord,
          });
          await queue.quarantine(receiptId, 'private-custody-receipt');
          result = created;
          return { status: 'delivered' };
        } catch (error) {
          const code = (error as { code?: unknown })?.code;
          return typeof code === 'string' &&
            ['E_ARTIFACT_SHARE_NETWORK', 'E_ARTIFACT_PASTE_UNAVAILABLE'].includes(code)
            ? { status: 'retry', code }
            : { status: 'rejected', code: 'paste-rejected' };
        }
      });
      if (result) return result;
      const completed = activeReceipt(await queue.list());
      if (completed) return receipt(preparation(completed.prepared), completed.result ?? null);
      throw new Error(
        'Paste publication is pending. Retry this share to resume the saved encrypted operation; another tab may be sending it.',
      );
    },
    close() {
      for (const queue of queues.values()) queue.close();
      queues.clear();
    },
  };
}
