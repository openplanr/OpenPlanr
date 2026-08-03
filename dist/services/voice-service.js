/**
 * Voice-oriented standup workflow: consume transcript text from file or stdin.
 * Live microphone capture can be added later without changing the parser.
 */
import { readFile } from 'node:fs/promises';
import { formatStandupMarkdown, parseStandupTranscript } from './standup-parser.js';
export async function loadTranscriptFromFile(path) {
    try {
        const transcript = await readFile(path, 'utf-8');
        return { status: 'done', transcript: transcript.trim() };
    }
    catch (err) {
        return {
            status: 'error',
            transcript: '',
            errorMessage: err.message,
        };
    }
}
export function transcriptToStandupMarkdown(transcript) {
    const parsed = parseStandupTranscript(transcript);
    return formatStandupMarkdown(parsed);
}
/** Read transcript from `--file` or stdin (must not be empty). */
export async function readStandupTranscriptSource(opts) {
    if (opts.file) {
        const session = await loadTranscriptFromFile(opts.file);
        if (session.status === 'error') {
            throw new Error(session.errorMessage || 'Failed to read transcript file');
        }
        return session.transcript;
    }
    const chunks = [];
    for await (const c of process.stdin)
        chunks.push(c);
    const text = Buffer.concat(chunks).toString('utf-8').trim();
    if (!text) {
        throw new Error('Provide --file <path> or pipe transcript text on stdin.');
    }
    return text;
}
//# sourceMappingURL=voice-service.js.map