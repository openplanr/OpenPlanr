/**
 * Voice-oriented standup workflow: consume transcript text from file or stdin.
 * Live microphone capture can be added later without changing the parser.
 */
import type { VoiceStandupSession } from '../models/types.js';
export declare function loadTranscriptFromFile(path: string): Promise<VoiceStandupSession>;
export declare function transcriptToStandupMarkdown(transcript: string): string;
/** Read transcript from `--file` or stdin (must not be empty). */
export declare function readStandupTranscriptSource(opts: {
    file?: string;
}): Promise<string>;
//# sourceMappingURL=voice-service.d.ts.map