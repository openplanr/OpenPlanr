import type { Command, OptionValues } from 'commander';
/**
 * Resolve one bounded guided-answer document for the init flow. `--answers-file
 * <path>` is a stdin-parity alias: it reads the same 64 KiB-bounded UTF-8 string
 * `--stdin` would, so the downstream strict parser and digest binding are
 * identical — it never introduces an inline-JSON code path. TTY-guard semantics
 * are preserved: only `--stdin` requires a connected non-TTY pipe. This transport
 * is now discoverable: the questionnaire advertises it in
 * `submission.transport.alternates` (kind `answers-file`) alongside the stdin
 * entry, so a contract-conformant runtime never has to assume stdin is the only
 * channel. Exported for direct parity testing.
 */
export declare function readBoundedInitAnswers(options: OptionValues, maxBytes?: number): Promise<string | undefined>;
export declare function registerOperateCommand(program: Command): void;
//# sourceMappingURL=operate.d.ts.map