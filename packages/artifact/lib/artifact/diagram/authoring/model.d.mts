import type {
  DiagramAuthoringContainer,
  DiagramAuthoringDocument,
  DiagramAuthoringSnapshot,
  DiagramAuthoringValidationError,
  DiagramGeometry,
  DiagramMembershipState,
  DiagramPlacement,
  DiagramSemanticEntry,
} from '@openplanr/protocol/diagram-authoring-contracts';
import type {
  VersionedDiagramAuthoringBundle as DiagramAuthoringBundle,
  DiagramPresentation,
} from '@openplanr/protocol/studio-presentation-contracts';
import type { DiagramKernelFailure } from './index.mjs';
export declare const COLLECTIONS: readonly ['nodes', 'relations', 'groups', 'lanes', 'annotations'];
export declare function clone<T>(value: T): T;
export declare function same(left: unknown, right: unknown): boolean;
export declare function diagnostic(
  path: string,
  rule: string,
  detail: string,
): DiagramAuthoringValidationError;
export declare function failure(path: string, rule: string, detail: string): DiagramKernelFailure;
export declare function inspectPlainData(
  value: unknown,
  allowedKeyPaths?: string[],
): DiagramAuthoringValidationError[];
export { validateAuthoringBundle } from './index.mjs';
/** Private engine copy: recursively frozen only after full contract validation. */
export declare function createAuthoringSnapshot(
  value: unknown,
  previous?: DiagramAuthoringBundle | null,
): { ok: true; bundle: DiagramAuthoringBundle } | DiagramKernelFailure;
export declare function isAuthoringSnapshot(value: unknown): value is DiagramAuthoringBundle;
export declare function snapshot(bundle: DiagramAuthoringBundle): DiagramAuthoringSnapshot;
export declare function elementIndex(
  document: DiagramAuthoringDocument,
): Map<string, DiagramSemanticEntry>;
export declare function parentIndex(document: DiagramAuthoringDocument): Map<string, string>;
export declare function descendants(document: DiagramAuthoringDocument, ids: string[]): string[];
export declare function semanticFields(
  collection: 'document',
  value: DiagramAuthoringDocument,
): Pick<DiagramAuthoringDocument, 'title' | 'summary' | 'audience' | 'accessibility'>;
export declare function semanticFields<T extends DiagramSemanticEntry['value']>(
  collection: DiagramSemanticEntry['collection'],
  value: T,
): T extends DiagramAuthoringContainer ? Pick<T, 'label'> : Omit<T, 'id'>;
export declare function geometryFields(value: DiagramGeometry): DiagramGeometry;
export declare function appearanceFields(
  value: Pick<DiagramPlacement, 'appearance' | 'locks'>,
): Pick<DiagramPlacement, 'appearance' | 'locks'>;
export declare function membershipState(document: DiagramAuthoringDocument): DiagramMembershipState;
/** Accepts a complete unsealed draft; callers validate before adopting it. */
export declare function sealBundle(
  bundle: DiagramAuthoringBundle,
  previous?: DiagramAuthoringBundle | null,
): DiagramAuthoringBundle;
export declare function setStudioPresentation(
  bundle: DiagramAuthoringBundle,
  presentation: DiagramPresentation | null,
): void;

export declare function createSealedAuthoringSnapshot(
  value: DiagramAuthoringBundle,
  previous?: DiagramAuthoringBundle | null,
): { ok: true; bundle: DiagramAuthoringBundle } | DiagramKernelFailure;
