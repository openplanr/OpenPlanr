/** Browser-safe trusted preparation. Uploaded content receives no host authority. */
import type { normalizeArtifactBridgeToolResult } from './ui/bridge-tools.mjs';
export interface ArtifactViewport {
  width: number;
  height: number;
}
export interface ArtifactDocumentOptions {
  html: string;
  artifactId: string;
  nonce: string;
  parentOrigin: string;
  scriptNonce?: string;
  allowLocalForms?: boolean;
  portable?: boolean;
  trustedParentOrigin?: string;
  screenId?: string;
  prototypeState?: boolean;
}
export interface ArtifactExecutionCopy {
  readonly html: string;
  readonly csp: string;
  readonly scriptNonce: string;
}
export declare function prepareArtifactDocument(
  options: ArtifactDocumentOptions,
): ArtifactExecutionCopy;
export declare function prepareHostedArtifactDocument(
  options: ArtifactDocumentOptions,
): ArtifactExecutionCopy;
export declare function prepareArtifactSourceTemplate(
  options: Omit<ArtifactDocumentOptions, 'artifactId' | 'parentOrigin'> & { parentOrigin?: string },
): Readonly<{ html: string; artifactIdToken: string }>;
export declare function artifactContentSecurityPolicy(scriptNonce: string): string;
export declare function sandboxGuardFiller(
  name: string,
  template: string,
  keys: string[],
): (values: Record<string, string>) => string;
export interface ArtifactBridgeContract {
  source: unknown;
  nonce: string;
  artifactId: string;
  viewport: ArtifactViewport;
  pendingRequestIds?: Set<string>;
  pendingChallengeIds?: Set<string>;
  viewportGesturesEnabled?: boolean;
}
interface RequestIdentity {
  artifactId: string;
  requestId: string;
}
interface ArtifactAnchor {
  planrId: string;
  screen?: string;
  rect: { x: number; y: number; width: number; height: number };
  viewport: ArtifactViewport;
}
export type ArtifactBridgeValue =
  | { type: 'bridge.ready'; artifactId: string; authenticated: false }
  | ({ type: 'bridge.challenge-ack'; authenticated: true } & RequestIdentity)
  | {
      type: 'layout.measurement';
      artifactId: string;
      authenticated: true;
      layout: ArtifactViewport;
    }
  | { type: 'viewport.zoom'; artifactId: string; zoom: { x: number; y: number; deltaY: number } }
  | { type: 'viewport.pan'; artifactId: string; pan: { deltaX: number; deltaY: number } }
  | ({ type: 'anchor.miss' } & RequestIdentity)
  | ({ type: 'anchor.result'; anchor: ArtifactAnchor } & RequestIdentity)
  | ({ type: 'export.error'; reason: string } & RequestIdentity)
  | ({
      type: 'export.result';
      dataUrl: string;
      width: number;
      height: number;
      label: string;
    } & RequestIdentity)
  | ({
      type: 'inspect.result' | 'inspect.miss' | 'thumbnail.result' | 'thumbnail.error';
      result: ReturnType<typeof normalizeArtifactBridgeToolResult>['value'];
    } & RequestIdentity);
export type ArtifactBridgeResult =
  | Readonly<{ ok: true; value: Readonly<ArtifactBridgeValue> }>
  | Readonly<{
      ok: false;
      code: string;
      reason: string;
      fallback: 'coordinates';
      details?: unknown;
    }>;
export declare function validateArtifactBridgeMessage(
  event: { source: unknown; origin: string; data: unknown },
  contract: ArtifactBridgeContract,
): ArtifactBridgeResult;
export declare const ARTIFACT_BRIDGE_CHANNEL: 'openplanr.artifact-anchor';
export declare const ARTIFACT_BRIDGE_VERSION: '1.0.0';
export declare const ARTIFACT_BRIDGE_EVENT: 'planr:artifact-anchor';
export declare const ARTIFACT_BRIDGE_READY_EVENT: 'planr:artifact-bridge-ready';
export declare const ARTIFACT_BRIDGE_LAYOUT_EVENT: 'planr:artifact-layout';
export declare const ARTIFACT_VIEWPORT_ZOOM_EVENT: 'planr:artifact-viewport-zoom';
export declare const ARTIFACT_VIEWPORT_PAN_EVENT: 'planr:artifact-viewport-pan';
export declare const ARTIFACT_EXPORT_MAX_EDGE: 11000;
export declare const ARTIFACT_EXPORT_MAX_DATA_URL: number;
export declare const ARTIFACT_LAYOUT_MAX_WIDTH: 16384;
export declare const ARTIFACT_LAYOUT_MAX_HEIGHT: 262144;
export declare const SANDBOX_GUARD_LIMITS: Readonly<Record<string, string>>;
