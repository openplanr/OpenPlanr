/**
 * Heuristic parsing of a standup transcript into yesterday / today / blockers.
 */
export interface TranscriptSegment {
    section: 'yesterday' | 'today' | 'blockers' | 'note';
    text: string;
    /** Placeholder for future audio/text sync (milliseconds from clip start) */
    audioOffsetMs?: number;
}
export interface ParsedStandup {
    yesterday: string[];
    today: string[];
    blockers: string[];
    incomplete: boolean;
    notes: string[];
    /** Best-effort line segments (no audio yet — offsets unused until capture exists) */
    segments: TranscriptSegment[];
}
export declare function parseStandupTranscript(raw: string): ParsedStandup;
export declare function formatStandupMarkdown(parsed: ParsedStandup): string;
//# sourceMappingURL=standup-parser.d.ts.map