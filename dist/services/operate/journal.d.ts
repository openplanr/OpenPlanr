import { type OperatingEventHead, type OperatingTransactionJournal } from './types.js';
export interface JournalWrite {
    relativePath: string;
    content: string | Uint8Array;
    operation?: 'create' | 'replace' | 'append';
    mode?: `0${string}`;
}
export interface PreparedJournal {
    root: string;
    manifestPath: string;
    record: OperatingTransactionJournal;
}
export declare function prepareJournalTransaction(projectRoot: string, input: {
    writes: JournalWrite[];
    eventHead: OperatingEventHead;
    previewDigest: `sha256:${string}`;
    transactionId?: string;
    localRoot?: string;
    now?: string;
}): Promise<PreparedJournal>;
export declare function rollbackJournalTransaction(projectRoot: string, prepared: PreparedJournal): Promise<OperatingTransactionJournal>;
export declare function applyJournalTransaction(projectRoot: string, prepared: PreparedJournal, options: {
    currentEventHead: OperatingEventHead;
    revalidateEventHead?: () => Promise<OperatingEventHead>;
    beforeTransition?: (transition: 'promote-write' | 'promoted' | 'committed', index?: number) => Promise<void> | void;
}): Promise<OperatingTransactionJournal>;
export declare function readJournal(manifestPath: string): Promise<OperatingTransactionJournal>;
export declare function assertCommittedOperatingView(projectRoot: string, options?: {
    localRoot?: string;
}): Promise<void>;
export declare function recoverOperatingTransactions(projectRoot: string, options?: {
    localRoot?: string;
}): Promise<string[]>;
//# sourceMappingURL=journal.d.ts.map