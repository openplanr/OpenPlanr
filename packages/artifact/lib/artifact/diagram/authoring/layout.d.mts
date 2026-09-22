import type { DiagramAuthoringBundle } from '@openplanr/protocol/diagram-authoring-contracts';
import type { DiagramPreviewResult } from './index.mjs';

export interface DiagramAutomaticLayoutOptions { targetIds: string[]; transactionId: string; gap?: number; columns?: number }
export interface DiagramLayoutDisclosure { targetIds: string[]; movedIds: string[]; lockedIds: string[] }
/** Explicit bounded packing preview. Geometry locks and saved dimensions survive. */
export declare function previewAutomaticLayout(bundle: DiagramAuthoringBundle, options: DiagramAutomaticLayoutOptions): DiagramPreviewResult & { layout?: DiagramLayoutDisclosure };
/** Remove authored routing only from explicitly selected connectors. */
export declare function previewResetRoute(bundle: DiagramAuthoringBundle, options: { targetIds: string[]; transactionId: string }): DiagramPreviewResult;
