const HOST_VERSION_TIMEOUT_MS = 5_000;

/** Spawn bounds for a host runner call: only a `--version` probe is time-limited. */
export function hostRunnerBounds(
  args: readonly string[],
): { timeout: number; killSignal: 'SIGKILL' } | undefined {
  return args.length === 1 && args[0] === '--version'
    ? { timeout: HOST_VERSION_TIMEOUT_MS, killSignal: 'SIGKILL' }
    : undefined;
}

export function isProbeTimeout(error: Error | undefined): boolean {
  return Boolean(error && 'code' in error && error.code === 'ETIMEDOUT');
}

export function probeTimeoutMessage(command: string, product: string): string {
  return `${command} --version did not finish within ${HOST_VERSION_TIMEOUT_MS}ms; ${product} is present but its version is unknown. Plugin state was not read.`;
}
