import { type GuidedConfirmation, type OperatingActionEffect, type OperatingEventHead } from '../types.js';
export interface OperatingConfirmationMaterial {
    actionId: string;
    sessionId: string;
    command: string;
    effect: Exclude<OperatingActionEffect, 'read-only'>;
    providerUse: boolean;
    confirmationScope: string;
    projectIdentity: `sha256:${string}`;
    projectHead: `sha256:${string}`;
    configHead: `sha256:${string}`;
    eventHead?: OperatingEventHead | null;
    evidenceHead?: `sha256:${string}` | null;
    providerPolicy?: `sha256:${string}` | null;
    arguments?: string[];
    destinations?: string[];
    writes?: string[];
    createdAt?: string;
    expiresAt?: string;
}
export declare function operatingConfirmationDigest(material: OperatingConfirmationMaterial): `sha256:${string}`;
export declare function createOperatingConfirmation(material: OperatingConfirmationMaterial): GuidedConfirmation;
export declare function assertOperatingConfirmation(input: {
    expected: GuidedConfirmation;
    actionId: string;
    confirmationDigest?: string;
    confirmed: boolean;
    now?: Date;
}): GuidedConfirmation;
//# sourceMappingURL=confirmation-service.d.ts.map