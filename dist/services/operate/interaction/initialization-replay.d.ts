import { type OperatingInitAnswers } from '../types.js';
/**
 * Encode the already-reviewed, non-secret initialization answers into a
 * shell-safe replay token. The confirmation digest still provides authority
 * and detects any token modification before a write.
 */
export declare function encodeOperatingInitializationReplay(answers: OperatingInitAnswers): string;
export declare function decodeOperatingInitializationReplay(token: string): OperatingInitAnswers;
//# sourceMappingURL=initialization-replay.d.ts.map