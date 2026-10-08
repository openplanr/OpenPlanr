import type { DiagramReviewBundle } from '@openplanr/protocol/diagram-review-contracts';
import type {
  DiagramReviewBundleV11,
  VersionedDiagramAuthoringBundle,
} from '@openplanr/protocol/studio-presentation-contracts';
/** Produce a validated inert review from memory. Private source bytes and maps are excluded. */
export declare function prepareAuthoredDiagramReviewBundle(
  source: VersionedDiagramAuthoringBundle,
): DiagramReviewBundle | DiagramReviewBundleV11;
