/** Browser custody for prepared review operations. Encryption/signing belongs to the transport. */
export interface ReviewOutboxScope {
  workspaceId: string;
  revisionId: string;
  actorId: string;
}
export interface ReviewOutboxEntry<Payload = unknown> {
  operationId: string;
  payload: Payload;
  status: 'pending' | 'quarantined';
  attempts: number;
  createdAt: number;
  nextAttemptAt: number;
  errorCode?: string;
}
interface StoredEntry extends ReviewOutboxEntry {
  key: string;
  scopeKey: string;
  leaseOwner?: string;
  leaseUntil?: number;
  custodyInvalid?: true;
  invalidRecord?: unknown;
}
export type ReviewDelivery = {
  status: 'delivered' | 'retry' | 'rejected';
  code?: string;
  retryAfterMs?: number;
};
export interface ReviewOutbox {
  enqueue(value: { operationId: string; payload: unknown }): Promise<void>;
  list(): Promise<ReviewOutboxEntry[]>;
  retry(operationId: string): Promise<void>;
  quarantine(operationId: string, code: string): Promise<void>;
  remove(operationId: string): Promise<void>;
  drain(send: (entry: ReviewOutboxEntry) => Promise<ReviewDelivery>): Promise<void>;
  subscribe(listener: () => void): () => void;
  close(): void;
}
export function createReviewOutbox({
  scope,
  indexedDB = globalThis.indexedDB,
  databaseName = 'openplanr-review-outbox-v1',
  leaseMs = 30_000,
  now = Date.now,
  validatePayload = (payload) => payload !== null && typeof payload === 'object',
}: {
  scope: ReviewOutboxScope;
  indexedDB?: IDBFactory;
  databaseName?: string;
  leaseMs?: number;
  now?: () => number;
  validatePayload?: (payload: unknown) => boolean;
}): ReviewOutbox {
  for (const value of [scope.workspaceId, scope.revisionId, scope.actorId])
    if (typeof value !== 'string' || !value || value.length > 512)
      throw new TypeError('Review custody requires workspace, revision and actor identities.');
  if (!Number.isFinite(leaseMs) || leaseMs < 300)
    throw new TypeError('A review lease must be at least 300ms.');
  const scopeKey = JSON.stringify([scope.workspaceId, scope.revisionId, scope.actorId]);
  const key = (id: string) => {
    if (typeof id !== 'string' || !id || id.length > 512)
      throw new TypeError('A review operation needs a stable identity.');
    return JSON.stringify([scopeKey, id]);
  };
  let closed = false,
    draining: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const heartbeats = new Set<ReturnType<typeof globalThis.setInterval>>();
  // BroadcastChannel is a notification only. Every read/write and lease remains in IndexedDB.
  const channel =
    typeof globalThis.BroadcastChannel === 'function'
      ? new globalThis.BroadcastChannel(databaseName)
      : null;
  const notify = () => {
    listeners.forEach((listener) => {
      listener();
    });
    channel?.postMessage(scopeKey);
  };
  if (channel)
    channel.onmessage = (event: MessageEvent) => {
      if (event.data === scopeKey)
        listeners.forEach((listener) => {
          listener();
        });
    };
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    if (!indexedDB) {
      reject(
        new Error(
          'Durable review storage is unavailable. Enable browser storage before sending feedback.',
        ),
      );
      return;
    }
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('operations', { keyPath: 'key' });
      store.createIndex('scope', 'scopeKey', { unique: false });
    };
    request.onerror = () =>
      reject(request.error ?? new Error('Durable review storage could not open.'));
    request.onblocked = () =>
      reject(new Error('Close older review tabs to open durable review storage.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (closed) db.close();
      resolve(db);
    };
  });
  // Opening errors are surfaced by the next public operation, never as an unhandled promise.
  void database.catch(() => {});
  async function transaction<T>(
    mode: IDBTransactionMode,
    work: (
      store: IDBObjectStore,
      result: (value: T) => void,
      guard: (callback: () => void) => () => void,
    ) => void,
  ): Promise<T> {
    if (closed) throw new Error('Review custody has closed.');
    const db = await database;
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction('operations', mode),
        store = tx.objectStore('operations');
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error ?? new Error('Review storage could not commit.'));
      tx.onabort = () => reject(tx.error ?? new Error('Review storage did not commit.'));
      const guard = (callback: () => void) => () => {
        try {
          callback();
        } catch (error) {
          try {
            tx.abort();
          } catch {
            /* Already aborted by IndexedDB. */
          }
          reject(error);
        }
      };
      guard(() =>
        work(
          store,
          (next) => {
            value = next;
          },
          guard,
        ),
      )();
    });
  }
  const publicEntry = ({
    key: _key,
    scopeKey: _scope,
    leaseOwner: _owner,
    leaseUntil: _until,
    custodyInvalid: _invalid,
    invalidRecord: _record,
    ...entry
  }: StoredEntry): ReviewOutboxEntry => entry;
  function payloadValid(payload: unknown) {
    try {
      return validatePayload(payload);
    } catch {
      return false;
    }
  }
  function keyedIdentity(primaryKey: IDBValidKey): string | null {
    if (typeof primaryKey !== 'string') return null;
    try {
      const value: unknown = JSON.parse(primaryKey);
      return Array.isArray(value) &&
        value.length === 2 &&
        value[0] === scopeKey &&
        typeof value[1] === 'string' &&
        value[1].length > 0 &&
        value[1].length <= 512
        ? value[1]
        : null;
    } catch {
      return null;
    }
  }
  function storedEntry(
    raw: unknown,
    primaryKey: IDBValidKey,
    store: IDBObjectStore,
  ): StoredEntry | null {
    const record =
      raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    const fromKey = keyedIdentity(primaryKey);
    if (record?.scopeKey !== scopeKey && !fromKey) return null;
    const allowed = new Set([
      'key',
      'scopeKey',
      'operationId',
      'payload',
      'status',
      'attempts',
      'createdAt',
      'nextAttemptAt',
      'errorCode',
      'leaseOwner',
      'leaseUntil',
      'custodyInvalid',
      'invalidRecord',
    ]);
    const finiteTime = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const integer = (value: unknown) =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    if (
      record &&
      Object.keys(record).every((name) => allowed.has(name)) &&
      fromKey !== null &&
      fromKey === record.operationId &&
      record.key === primaryKey &&
      record.scopeKey === scopeKey &&
      Object.hasOwn(record, 'payload') &&
      ['pending', 'quarantined'].includes(String(record.status)) &&
      integer(record.attempts) &&
      finiteTime(record.createdAt) &&
      finiteTime(record.nextAttemptAt) &&
      (record.errorCode === undefined ||
        (typeof record.errorCode === 'string' && record.errorCode.length <= 120)) &&
      ((record.leaseOwner === undefined && record.leaseUntil === undefined) ||
        (typeof record.leaseOwner === 'string' &&
          record.leaseOwner.length > 0 &&
          record.leaseOwner.length <= 128 &&
          finiteTime(record.leaseUntil))) &&
      (record.custodyInvalid === true
        ? record.status === 'quarantined' && record.errorCode === 'malformed_custody'
        : record.custodyInvalid === undefined &&
          record.invalidRecord === undefined &&
          payloadValid(record.payload))
    )
      return record as unknown as StoredEntry;
    const operationId = fromKey ?? `invalid-${globalThis.crypto.randomUUID()}`;
    const repaired: StoredEntry = {
      key: key(operationId),
      scopeKey,
      operationId,
      payload: record && Object.hasOwn(record, 'payload') ? record.payload : null,
      status: 'quarantined',
      attempts: 0,
      createdAt: 0,
      nextAttemptAt: 0,
      errorCode: 'malformed_custody',
      custodyInvalid: true,
      invalidRecord: raw,
    };
    // Preserve the malformed record privately. It can be inspected/discarded, never replayed.
    store.put(repaired);
    if (primaryKey !== repaired.key) store.delete(primaryKey);
    return repaired;
  }
  function readScoped(
    store: IDBObjectStore,
    result: (entries: StoredEntry[]) => void,
    guard: (callback: () => void) => () => void,
  ) {
    const entries: StoredEntry[] = [];
    const seen = new Set<string>();
    const request = store.openCursor();
    request.onsuccess = guard(() => {
      const cursor = request.result;
      if (!cursor) {
        result(entries);
        return;
      }
      const entry = storedEntry(cursor.value, cursor.primaryKey, store);
      if (entry && !seen.has(entry.key)) {
        seen.add(entry.key);
        entries.push(entry);
      }
      cursor.continue();
    });
  }
  async function mutate(id: string, update: (entry: StoredEntry, store: IDBObjectStore) => void) {
    await transaction<void>('readwrite', (store, _result, guard) => {
      const operationKey = key(id);
      const request = store.get(operationKey);
      request.onsuccess = guard(() => {
        if (request.result === undefined) return;
        const entry = storedEntry(request.result, operationKey, store);
        if (entry) update(entry, store);
      });
    });
    notify();
  }
  async function claim(owner: string): Promise<StoredEntry | null> {
    return transaction('readwrite', (store, result, guard) => {
      readScoped(
        store,
        (entries) => {
          const time = now();
          const next = entries
            .filter(
              (entry) =>
                entry.status === 'pending' &&
                entry.nextAttemptAt <= time &&
                (!entry.leaseUntil || entry.leaseUntil <= time),
            )
            .sort(
              (a, b) => a.createdAt - b.createdAt || a.operationId.localeCompare(b.operationId),
            )[0];
          if (!next) {
            result(null);
            return;
          }
          next.leaseOwner = owner;
          next.leaseUntil = time + leaseMs;
          store.put(next);
          result(next);
        },
        guard,
      );
    });
  }
  return {
    async enqueue({ operationId, payload }) {
      // Structured cloning severs caller ownership before the asynchronous transaction begins.
      const immutable = structuredClone(payload),
        operationKey = key(operationId);
      if (!payloadValid(immutable)) throw new TypeError('Prepared review custody is invalid.');
      await transaction<void>('readwrite', (store, _result, guard) => {
        const request = store.get(operationKey);
        request.onsuccess = guard(() => {
          // A retry never replaces the prepared ciphertext/signature associated with this identity.
          if (request.result !== undefined) {
            storedEntry(request.result, operationKey, store);
            return;
          }
          store.add({
            key: operationKey,
            scopeKey,
            operationId,
            payload: immutable,
            status: 'pending',
            attempts: 0,
            createdAt: now(),
            nextAttemptAt: 0,
          } satisfies StoredEntry);
        });
      });
      notify();
    },
    async list() {
      return transaction('readwrite', (store, result, guard) => {
        readScoped(
          store,
          (entries) =>
            result(
              entries
                .sort(
                  (a, b) => a.createdAt - b.createdAt || a.operationId.localeCompare(b.operationId),
                )
                .map(publicEntry),
            ),
          guard,
        );
      });
    },
    async retry(id) {
      await mutate(id, (entry, store) => {
        if (entry.custodyInvalid || (entry.leaseUntil && entry.leaseUntil > now())) return;
        entry.status = 'pending';
        entry.nextAttemptAt = 0;
        delete entry.errorCode;
        store.put(entry);
      });
    },
    async quarantine(id, code) {
      await mutate(id, (entry, store) => {
        if (entry.leaseUntil && entry.leaseUntil > now()) return;
        entry.status = 'quarantined';
        entry.nextAttemptAt = 0;
        entry.errorCode = entry.custodyInvalid ? 'malformed_custody' : String(code).slice(0, 120);
        store.put(entry);
      });
    },
    async remove(id) {
      await mutate(id, (entry, store) => {
        if (!entry.leaseUntil || entry.leaseUntil <= now()) store.delete(entry.key);
      });
    },
    drain(send) {
      if (draining) return draining;
      const owner = globalThis.crypto.randomUUID();
      draining = (async () => {
        while (!closed) {
          const entry = await claim(owner);
          if (!entry) return;
          const heartbeat = globalThis.setInterval(
            () => {
              void mutate(entry.operationId, (current, store) => {
                if (current.leaseOwner === owner) {
                  current.leaseUntil = now() + leaseMs;
                  store.put(current);
                }
              }).catch(() => {});
            },
            Math.floor(leaseMs / 3),
          );
          heartbeats.add(heartbeat);
          let outcome: ReviewDelivery;
          try {
            outcome = await send(publicEntry(entry));
          } catch {
            outcome = { status: 'retry', code: 'network' };
          } finally {
            globalThis.clearInterval(heartbeat);
            heartbeats.delete(heartbeat);
          }
          if (!outcome || !['delivered', 'retry', 'rejected'].includes(outcome.status))
            outcome = { status: 'retry', code: 'invalid-delivery-result' };
          await mutate(entry.operationId, (current, store) => {
            if (current.leaseOwner !== owner) return;
            if (outcome.status === 'delivered') {
              store.delete(current.key);
              return;
            }
            delete current.leaseOwner;
            delete current.leaseUntil;
            current.attempts += 1;
            current.errorCode =
              typeof outcome.code === 'string' ? outcome.code.slice(0, 120) : outcome.status;
            current.status = outcome.status === 'rejected' ? 'quarantined' : 'pending';
            const requestedDelay = Number.isFinite(outcome.retryAfterMs)
              ? Math.max(0, Math.min(3_600_000, outcome.retryAfterMs as number))
              : 0;
            current.nextAttemptAt =
              outcome.status === 'retry'
                ? now() +
                  Math.max(
                    requestedDelay,
                    Math.min(60_000, 1_000 * 2 ** Math.min(current.attempts - 1, 6)),
                  )
                : 0;
            store.put(current);
          });
        }
      })().finally(() => {
        draining = null;
      });
      return draining;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      for (const heartbeat of heartbeats) globalThis.clearInterval(heartbeat);
      heartbeats.clear();
      channel?.close();
      listeners.clear();
      void database.then((db) => db.close()).catch(() => {});
    },
  };
}
