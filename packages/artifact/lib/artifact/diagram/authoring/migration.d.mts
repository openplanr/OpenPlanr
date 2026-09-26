import type {
  DiagramAuthoringBundle,
  DiagramAuthoringDigest,
} from '@openplanr/protocol/diagram-authoring-contracts';
export interface DiagramMigrationDiagnostic {
  code?: string;
  message?: string;
  elementIds?: string[];
  path?: string;
  rule?: string;
  detail?: string;
}
export type DiagramMigrationPreview =
  | { ok: false; sourceModified: false; diagnostics: DiagramMigrationDiagnostic[] }
  | {
      ok: true;
      sourceModified: false;
      adoption: 'explicit-save-required';
      bundle: DiagramAuthoringBundle;
      diagnostics: DiagramMigrationDiagnostic[];
      source?: {
        path: string;
        digest: DiagramAuthoringDigest;
        manifestDigest: DiagramAuthoringDigest;
      };
    };
/** Pure capture from an already available legacy document. It does not validate file custody. */
export declare function previewLegacyDiagramDocument(document: unknown): DiagramMigrationPreview;
/** Read-only source, manifest and output custody verification followed by migration preview. */
export declare function previewLegacyDiagramMigration(options: {
  root: string;
  slug: string;
}): Promise<DiagramMigrationPreview>;
