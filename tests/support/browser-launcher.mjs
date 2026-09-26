import { createRequire } from 'node:module';

export const BROWSER_ENGINES = Object.freeze(['chromium', 'firefox', 'webkit']);

const requireProtocol = createRequire(
  new URL('../../packages/protocol/package.json', import.meta.url),
);

/** The workspace Playwright module; every browser test resolves it through this one path. */
export const playwright = requireProtocol('playwright');

/** Engine named by PLANR_BROWSER_ENGINE, defaulting to chromium. */
export function browserEngine(requested = process.env.PLANR_BROWSER_ENGINE) {
  const engine = requested || 'chromium';
  if (!BROWSER_ENGINES.includes(engine)) {
    throw new Error(
      `PLANR_BROWSER_ENGINE must be ${BROWSER_ENGINES.join(', ')}; received ${JSON.stringify(engine)}.`,
    );
  }
  return engine;
}

/** Browser binary a developer or the packed proof pinned, or undefined for Playwright's own. */
export function configuredBrowserExecutable(engine = browserEngine()) {
  return (
    process.env.PLANR_BROWSER_EXECUTABLE ||
    (engine === 'chromium' ? process.env.OPENPLANR_PROOF_CHROMIUM_EXECUTABLE : '') ||
    undefined
  );
}

/** Browser binary the engine will run: the pinned override, else Playwright's bundled browser. */
export function browserExecutable(engine = browserEngine()) {
  return configuredBrowserExecutable(engine) ?? playwright[engine].executablePath();
}

/**
 * Launch options for a headless loopback test in the selected engine.
 * Chromium always runs with --no-proxy-server so 127.0.0.1 fixtures never wait on proxy
 * auto-discovery; a pinned executable takes precedence over PLANR_BROWSER_CHANNEL.
 */
export function browserLaunchOptions({ engine: requested, args = [], ...options } = {}) {
  const engine = browserEngine(requested);
  const executablePath = configuredBrowserExecutable(engine);
  const channel =
    engine === 'chromium' && !executablePath ? process.env.PLANR_BROWSER_CHANNEL : undefined;
  return {
    headless: true,
    ...options,
    args: engine === 'chromium' ? ['--no-proxy-server', ...args] : args,
    ...(executablePath ? { executablePath } : {}),
    ...(channel ? { channel } : {}),
  };
}

/** Launch the selected engine; a missing browser fails at once and names the fix. */
export async function launchBrowser({ engine: requested, ...options } = {}) {
  const engine = browserEngine(requested);
  const launchOptions = browserLaunchOptions({ engine, ...options });
  try {
    return await playwright[engine].launch(launchOptions);
  } catch (error) {
    throw launchFailure(engine, launchOptions, error);
  }
}

function launchFailure(engine, { executablePath, channel }, error) {
  const detail = (error instanceof Error ? error.message : String(error))
    .split('\n')[0]
    .replace(/\.$/u, '');
  const subject = executablePath
    ? `${engine} at ${executablePath}`
    : channel
      ? `${engine} channel ${channel}`
      : `Playwright's bundled ${engine}`;
  const hint = /Executable doesn't exist/u.test(detail)
    ? ` Run "./node_modules/.bin/playwright install ${engine}" or set PLANR_BROWSER_EXECUTABLE to an installed browser.`
    : '';
  return new Error(`Could not launch ${subject}: ${detail}.${hint}`, { cause: error });
}
