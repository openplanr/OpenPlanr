import type { DiagramReviewBundle } from '@openplanr/protocol/diagram-review-contracts';
import type { DiagramReviewBundleV11 } from '@openplanr/protocol/studio-presentation-contracts';
export declare function prepareDiagramShareBundle(
  file: string,
): Promise<DiagramReviewBundle | DiagramReviewBundleV11>;
