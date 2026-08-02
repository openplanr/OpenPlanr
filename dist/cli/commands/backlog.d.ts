/**
 * `planr backlog` command group.
 *
 * Lightweight issue/TODO tracker with tags, priorities, and
 * AI-powered prioritization. The intake funnel before work
 * enters the agile hierarchy.
 */
import type { Command } from 'commander';
export declare function registerBacklogCommand(program: Command): void;
/**
 * Build the spec string fed to the quick-task AI prompt when promoting a BL.
 *
 * The goal: preserve every byte of user-authored context (acceptance criteria,
 * threat models, decision notes, etc.) without leaking planning meta lines
 * that only make sense in the backlog file itself — the leading `# BL-XXX:
 * Title` heading and the trailing `_Promote to agile hierarchy..._` helper.
 *
 * Falls back gracefully when the raw file is missing or the BL has no body
 * beyond its frontmatter.
 */
export declare function extractBacklogSpec(raw: string, blId: string, title: string, descriptionFallback: string): string;
//# sourceMappingURL=backlog.d.ts.map