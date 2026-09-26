export interface BrowserQaSession {
  kind: 'browser-qa-session';
  schemaVersion: '1.0.0';
  sessionId: `bqs_${string}`;
  suppliedAt: string;
  expiresAt: string;
  signedIn: boolean;
  custody: 'external-ephemeral';
  persisted: false;
}

import type { BrowserQaHostAttestation } from './browser-qa-custody.d.mts';
export interface BrowserQaGateRecord {
  kind: 'browser-qa-gate';
  schemaVersion: '1.0.0';
  protocolVersion: '1.1.0';
  candidateRevision: 1 | 2;
  candidateDigest: `sha256:${string}`;
  requirementDigest: `sha256:${string}`;
  required: boolean;
  status: 'passed' | 'failed' | 'blocked' | 'skipped';
  sessionBindingDigest: `sha256:${string}` | null;
  resultDigest: `sha256:${string}`;
  custodyVersion?: '1.0.0';
  attestationHostId?: string;
  attestationHostVersion?: string;
  attestationDigest?: `sha256:${string}`;
  evidenceBundleDigest?: `sha256:${string}`;
  recordDigest: `sha256:${string}`;
}
export declare function assertBrowserQaSession(
  value: unknown,
  options?: { now?: string },
): BrowserQaSession;
export declare function assertBrowserQaResult(
  value: unknown,
  options: {
    candidateDigest: `sha256:${string}`;
    requirementDigest: `sha256:${string}`;
    required: boolean;
    session?: BrowserQaSession | null;
    now?: string;
  },
): unknown;
export declare function issueBrowserQaGateRecord(options: {
  result: unknown;
  session?: BrowserQaSession | null;
  attestation?: BrowserQaHostAttestation | null;
  required: boolean;
  candidateRevision: 1 | 2;
  candidateDigest: `sha256:${string}`;
  requirementDigest: `sha256:${string}`;
  now?: string;
}): Readonly<BrowserQaGateRecord>;
export declare function assertBrowserQaGateRecord(
  value: unknown,
  options?: { requireAttested?: boolean },
): BrowserQaGateRecord;
