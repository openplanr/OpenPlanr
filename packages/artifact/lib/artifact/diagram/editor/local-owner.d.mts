import type { IncomingMessage } from 'node:http';
import type { DiagramAuthoringProfile } from '@openplanr/protocol/diagram-authoring-contracts';
import type { DiagramAuthoringStoreOptions } from '../authoring/store.mjs';

export declare const DIAGRAM_OWNER_HEADER: 'x-openplanr-owner';
export declare const DIAGRAM_OWNER_MAX_REQUEST_BYTES: number;
export interface DiagramLocalOwnerOptions {
  root: string;
  slug: string;
  /** Initial blank title; saved document content always wins. */
  title?: string;
  /** Initial blank authoring grammar, default process. */
  grammar?: DiagramAuthoringProfile;
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
  }): Promise<
    | false
    | { status: number; body: Record<string, unknown> }
    | { status: number; kind: 'asset'; asset: 'document' | 'runtime' | 'stylesheet'; body: string }
  >;
}
export interface DiagramOwnerHandle {
  readonly ok: true;
  readonly kind: 'diagram-owner';
  readonly status: 'ready';
  readonly sessionId: string;
  /** Public recovery namespace; contains no source path or authorization token. */
  readonly recoveryScope: string;
  /** Scoped local editor page. */
  readonly baseUrl: string;
  readonly url: string;
  readonly launchError?: string;
  readonly apiBase: string;
  readonly capabilities: Readonly<{ read: true; write: true }>;
  readonly headers: Readonly<{ 'x-openplanr-owner': '1' }>;
  close(): Promise<void>;
}
/** Bind one document before registering an owner capability in the loopback server. */
export declare function createDiagramLocalOwnerAdapter(
  options: DiagramLocalOwnerOptions,
): DiagramLocalOwnerAdapter;
/** Start the local editor and owner API, with no company account or network. */
export declare function startDiagramOwner(
  options: DiagramLocalOwnerOptions & {
    port?: number;
    env?: Record<string, string | undefined>;
    noOpen?: boolean;
    openUrl?: (url: string) => void | Promise<void>;
  },
): Promise<DiagramOwnerHandle>;
