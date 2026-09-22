import type { IncomingMessage } from 'node:http';
import type { DiagramAuthoringStoreOptions } from '../authoring/store.mjs';

export declare const DIAGRAM_OWNER_HEADER: 'x-openplanr-owner';
export declare const DIAGRAM_OWNER_MAX_REQUEST_BYTES: number;
export interface DiagramLocalOwnerOptions {
  root: string;
  slug: string;
  maxRequestBytes?: number;
  storeOptions?: Pick<DiagramAuthoringStoreOptions, 'maxBundleBytes' | 'faultInjector'>;
}
export interface DiagramLocalOwnerAdapter {
  readonly capabilities: Readonly<{ read: true; write: true }>;
  handleRequest(context: {
    req: IncomingMessage;
    segments: string[];
    origin: string;
    recoveryScope: string;
    head?: boolean;
  }): Promise<false | { status: number; body: Record<string, unknown> }>;
}
export interface DiagramOwnerHandle {
  readonly ok: true;
  readonly kind: 'diagram-owner';
  readonly status: 'ready';
  readonly sessionId: string;
  /** Public recovery namespace; contains no source path or authorization token. */
  readonly recoveryScope: string;
  readonly baseUrl: string;
  readonly apiBase: string;
  readonly capabilities: Readonly<{ read: true; write: true }>;
  readonly headers: Readonly<{ 'x-openplanr-owner': '1' }>;
  close(): Promise<void>;
}
/** Bind one document before registering an owner capability in the loopback server. */
export declare function createDiagramLocalOwnerAdapter(options: DiagramLocalOwnerOptions): DiagramLocalOwnerAdapter;
/** Start the scoped API; this does not create an editor UI or register CLI commands. */
export declare function startDiagramOwner(options: DiagramLocalOwnerOptions & { port?: number; env?: Record<string, string | undefined> }): Promise<DiagramOwnerHandle>;
