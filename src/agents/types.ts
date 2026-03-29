/**
 * Coding agent abstraction types.
 *
 * Each supported coding agent (Claude CLI, Cursor, Codex) implements
 * the CodingAgent interface for unified task implementation dispatch.
 */

export interface AgentOptions {
  cwd: string;
  stream: boolean;
  dryRun: boolean;
  /** Continue a previous session instead of starting fresh */
  continueSession?: boolean;
}

export interface AgentResult {
  output: string;
  exitCode: number;
}

export interface CodingAgent {
  readonly name: string;

  /** Check if the coding agent CLI/tool is available on this machine. */
  isAvailable(): Promise<boolean>;

  /** Execute an implementation prompt via the coding agent. */
  execute(prompt: string, options: AgentOptions): Promise<AgentResult>;
}
