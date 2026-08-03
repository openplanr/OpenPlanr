import type { AIUsage } from '../ai/types.js';
export interface Spinner {
    update(msg: string): void;
    stop(): void;
    succeed(msg: string): void;
}
/** Format token usage for display. Returns empty string if no usage data. */
export declare function formatUsage(usage?: AIUsage | null): string;
export declare function createSpinner(message: string): Spinner;
export declare function setVerbose(enabled: boolean): void;
export declare function isVerbose(): boolean;
export declare const logger: {
    info(msg: string): void;
    success(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
    heading(msg: string): void;
    dim(msg: string): void;
    debug(msg: string, ...args: unknown[]): void;
};
export declare const display: {
    /** Print a single formatted line. */
    line(text: string): void;
    /** Print an empty line for spacing. */
    blank(): void;
    /** Print a dim horizontal separator. */
    separator(width?: number, char?: string): void;
    /** Print a bold section heading. */
    heading(text: string): void;
    /** Print a key-value pair with aligned label. */
    keyValue(label: string, value: string, indent?: number): void;
    /** Print a bulleted list item. */
    bullet(text: string, indent?: number): void;
    /** Print a numbered list item. */
    numbered(index: number, text: string, indent?: number): void;
    /** Print a table header row with dim column names. */
    tableHeader(columns: {
        label: string;
        width: number;
    }[], indent?: number): void;
    /** Print a table row with padded columns. */
    tableRow(values: string[], widths: number[], indent?: number): void;
    /** Print a table separator matching column widths. */
    tableSeparator(totalWidth: number, indent?: number, char?: string): void;
    /** Print a progress bar. */
    progressBar(percent: number, width?: number, opts?: {
        label?: string;
        indent?: number;
    }): void;
};
//# sourceMappingURL=logger.d.ts.map