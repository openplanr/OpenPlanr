export interface TrustedBrowserQaRuntimeHost {
  readonly kind: 'browser-qa-runtime-host';
  readonly hostId: string;
  readonly hostVersion: string;
}
export interface BrowserQaRuntimeCapability {
  readonly kind: 'browser-qa-runtime-capability';
  readonly capabilityId: string;
  readonly hostId: string;
  readonly hostVersion: string;
  readonly candidateDigest: `sha256:${string}`;
  readonly requirementDigest: `sha256:${string}`;
  readonly sessionBindingDigest: `sha256:${string}`;
  readonly sessionId: string;
  readonly signedIn: boolean;
  readonly issuedAt: string;
  readonly expiresAt: string;
}
export interface BrowserQaHostAttestation {
  readonly kind: 'browser-qa-host-attestation';
  readonly schemaVersion: '1.0.0';
  readonly attestationId: string;
  readonly capabilityId: string;
  readonly hostId: string;
  readonly hostVersion: string;
  readonly candidateDigest: `sha256:${string}`;
  readonly requirementDigest: `sha256:${string}`;
  readonly sessionBindingDigest: `sha256:${string}`;
  readonly resultDigest: `sha256:${string}`;
  readonly evidenceBundleDigest: `sha256:${string}`;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly attestationDigest: `sha256:${string}`;
}
export interface BrowserQaEvidenceArtifacts {
  accessibility: Uint8Array;
  console: Uint8Array;
  network: Uint8Array;
  screenshots: Array<{ id: string; bytes: Uint8Array }>;
  traces: Array<{ id: string; bytes: Uint8Array }>;
}
export declare function createTrustedBrowserQaRuntimeHost(value: {
  hostId: string;
  hostVersion: string;
}): TrustedBrowserQaRuntimeHost;
export declare function establishBrowserQaRuntimeCapability(value: {
  host: TrustedBrowserQaRuntimeHost;
  candidateDigest: `sha256:${string}`;
  requirementDigest: `sha256:${string}`;
  sessionBindingDigest: `sha256:${string}`;
  sessionId: string;
  signedIn: boolean;
  issuedAt: string;
  expiresAt: string;
}): BrowserQaRuntimeCapability;
export declare function attestBrowserQaEvidence(value: {
  capability: BrowserQaRuntimeCapability;
  result: unknown;
  artifacts: BrowserQaEvidenceArtifacts;
  now?: string;
}): BrowserQaHostAttestation;
export declare function assertBrowserQaEvidenceAttestation(
  value: unknown,
  options: {
    result: unknown;
    candidateDigest: `sha256:${string}`;
    requirementDigest: `sha256:${string}`;
    sessionBindingDigest: `sha256:${string}`;
    now?: string;
  },
): BrowserQaHostAttestation;
