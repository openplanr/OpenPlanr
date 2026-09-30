export interface DiagramShareOptions {
  baseUrl?: string;
  expectedRevision?: string;
  custodyRoot?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof globalThis.fetch;
}
export interface DiagramShareStatus {
  ok: true;
  shared: boolean;
  title: string;
  localRevision: string;
  sourceDigest: string;
  contents: { elements: number; connections: number; sourceKind: 'manifest' | 'authoring' };
  retention: 'until-revoked';
  destination: string;
  id?: string;
  url?: string;
  revision?: string | null;
  publishedRevision?: string | null;
  hasUpdate?: boolean;
  epoch?: number;
  commentsPaused?: boolean;
  revoked?: boolean;
  deleted?: boolean;
  pending?: boolean;
  pendingAction?: string | null;
  reviewPath?: string;
}
export function getDiagramShareStatus(
  file: string,
  options?: DiagramShareOptions,
): Promise<DiagramShareStatus>;
export function shareDiagram(
  file: string,
  options?: DiagramShareOptions,
): Promise<DiagramShareStatus>;
export function publishDiagramShare(
  file: string,
  options?: DiagramShareOptions,
): Promise<DiagramShareStatus>;
export function manageDiagramShare(
  file: string,
  action: 'access',
  options?: DiagramShareOptions,
): Promise<DiagramShareStatus & { token: string }>;
export function manageDiagramShare(
  file: string,
  action: 'rotate' | 'pause' | 'resume' | 'revoke' | 'delete',
  options?: DiagramShareOptions,
): Promise<DiagramShareStatus>;
export function syncDiagramShare(
  file: string,
  options?: DiagramShareOptions,
): Promise<
  | (DiagramShareStatus & {
      imported: number;
      issues?: { id: string | null; sequence: number | null; reason: string }[];
    })
  | { ok: true; shared: boolean; imported: 0 }
>;
export function exportDiagramShareRecovery(
  file: string,
  options: DiagramShareOptions & { output: string },
): Promise<{ ok: true; output: string }>;
export function importDiagramShareRecovery(
  file: string,
  options: DiagramShareOptions & { input: string },
): Promise<DiagramShareStatus & { restored: true }>;
