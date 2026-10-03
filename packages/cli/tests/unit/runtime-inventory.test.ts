import { spawn } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const inventory = new URL('../../src/services/runtime-manager/inventory.ts', import.meta.url);
const tsx = createRequire(import.meta.url).resolve('tsx');
type Detected = Array<{ runtime: string; installed: boolean; command: string }>;

async function inspectFixture(
  configure: (root: string, bin: string) => NodeJS.ProcessEnv,
): Promise<Detected> {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-runtime-discovery-'));
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  mkdirSync(bin);
  mkdirSync(home, { mode: 0o700 });
  const runner = join(root, 'inspect.mjs');
  writeFileSync(
    runner,
    `const {detectInstalledRuntimes}=await import(${JSON.stringify(inventory.href)});\nif(process.env.FIXTURE_WINDOWS==='1')Object.defineProperty(process,'platform',{value:'win32'});\nconsole.log(JSON.stringify(detectInstalledRuntimes()));\n`,
  );
  const env = { ...process.env };
  delete env.OPENPLANR_CLAUDE_BIN;
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const child = spawn(process.execPath, ['--import', tsx, runner], {
    cwd: root,
    env: { ...env, PATH: bin, HOME: home, USERPROFILE: home, ...configure(root, bin) },
    detached: process.platform !== 'win32',
  });
  let stdout = '';
  let stderr = '';
  let failure: unknown;
  let detected: Detected | undefined;
  const stopOwnedGroup = () => {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure ??= error;
    }
  };
  // This guard bounds the unchanged legacy detector in a RED run. It owns the
  // freshly detached group, including forked fixtures; no host CLI is on PATH.
  const timer = setTimeout(() => {
    failure ??= new Error('Discovery exceeded the independent fixture guard.');
    stopOwnedGroup();
  }, 4_000);
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  try {
    const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once('error', reject);
        child.once('close', (status, signal) => resolve({ status, signal }));
      },
    );
    const invoked = readdirSync(root).filter((name) => name.endsWith('.invoked'));
    expect(invoked, 'Discovery must never execute any launcher or fork its child.').toEqual([]);
    expect(failure).toBeUndefined();
    expect(result.status, stderr).toBe(0);
    detected = JSON.parse(stdout) as Detected;
  } catch (error) {
    failure ??= error;
  } finally {
    clearTimeout(timer);
    stopOwnedGroup();
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) throw failure;
  if (!detected) throw new Error('Missing discovery fixture result.');
  return detected;
}

function executable(bin: string, name: string, body = 'exit 3') {
  const file = join(bin, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

function expected(claude: boolean, codex: boolean, cursor: boolean): Detected {
  return [
    { runtime: 'claude-code', installed: claude, command: 'claude' },
    { runtime: 'codex', installed: codex, command: 'codex' },
    { runtime: 'cursor', installed: cursor, command: 'cursor' },
  ];
}

describe('installed runtime executable discovery', () => {
  it.skipIf(process.platform === 'win32')(
    'does not invoke a discoverable failing launcher',
    async () => {
      const result = await inspectFixture((root, bin) => {
        executable(bin, 'claude', `printf x > '${join(root, 'side-effect.invoked')}'\nexit 3`);
        return {};
      });
      expect(result).toEqual(expected(true, false, false));
    },
  );

  for (const wrapper of ['wait', 'exit']) {
    it.skipIf(process.platform === 'win32')(
      `does not invoke a ${wrapper} wrapper or leave its forked native child`,
      async () => {
        const result = await inspectFixture((root, bin) => {
          const fork = join(root, 'fork.mjs');
          writeFileSync(
            fork,
            `import {writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(join(root, 'fork.invoked'))},String(process.pid));\nprocess.on('SIGTERM',()=>{});\nsetInterval(()=>{},1000);\n`,
          );
          executable(
            bin,
            'cursor',
            `'${process.execPath}' '${fork}' "$@" &\n${wrapper === 'wait' ? 'wait' : 'exit 0'}`,
          );
          return {};
        });
        expect(result).toEqual(expected(false, false, true));
      },
    );
  }

  it.skipIf(process.platform === 'win32')(
    'does not invoke a HOME-dependent recursive shim',
    async () => {
      const result = await inspectFixture((root) => {
        const shimBin = join(root, 'installed-home', '.local', 'bin');
        mkdirSync(shimBin, { recursive: true });
        executable(
          shimBin,
          'cursor',
          `printf x > '${join(root, 'shim.invoked')}'\nIFS=:\nfor dir in $PATH; do\n  cursor_path="$dir/cursor"\n  if [ "$cursor_path" != "$HOME/.local/bin/cursor" ] && [ -x "$cursor_path" ]; then\n    exec "$cursor_path" "$@"\n  fi\ndone\nexit 1`,
        );
        return { PATH: shimBin };
      });
      expect(result).toEqual(expected(false, false, true));
    },
  );

  it.skipIf(process.platform === 'win32')(
    'follows executable symlinks and rejects directories, broken links and nonexecutables',
    async () => {
      const result = await inspectFixture((root, bin) => {
        const target = executable(root, 'target');
        symlinkSync(target, join(bin, 'codex'));
        symlinkSync(join(root, 'missing'), join(bin, 'claude'));
        mkdirSync(join(bin, 'cursor'));
        const other = join(root, 'other');
        mkdirSync(other);
        writeFileSync(join(other, 'claude'), 'not executable', { mode: 0o600 });
        return { PATH: [bin, other].join(delimiter) };
      });
      expect(result).toEqual(expected(false, true, false));
    },
  );

  it.skipIf(process.platform === 'win32')(
    'preserves POSIX quote and whitespace bytes in relative PATH entries',
    async () => {
      const result = await inspectFixture((root) => {
        const literalQuotes = "'literal bin'";
        const literalSpaces = ' spaced bin ';
        mkdirSync(join(root, literalQuotes));
        mkdirSync(join(root, literalSpaces));
        executable(join(root, literalQuotes), 'codex');
        executable(join(root, literalSpaces), 'cursor');
        return { PATH: [literalQuotes, literalSpaces].join(delimiter) };
      });
      expect(result).toEqual(expected(false, true, true));
      const unresolvable = await inspectFixture((_root, bin) => {
        executable(bin, 'claude');
        return { PATH: `"${bin}"` };
      });
      expect(unresolvable).toEqual(expected(false, false, false));
    },
  );

  it.skipIf(process.platform === 'win32')(
    'binds empty PATH entries to cwd and does not substitute a missing PATH',
    async () => {
      const empty = await inspectFixture((root) => {
        executable(root, 'codex');
        return { PATH: '' };
      });
      expect(empty).toEqual(expected(false, true, false));
      const missing = await inspectFixture((root) => {
        executable(root, 'codex');
        return { PATH: undefined, Path: undefined };
      });
      expect(missing).toEqual(expected(false, false, false));
    },
  );

  it('honors readable regular Claude script override without executing it or falling back', async () => {
    const present = await inspectFixture((root, bin) => {
      executable(bin, process.platform === 'win32' ? 'claude.EXE' : 'claude');
      const script = join(root, 'stand-in.mjs');
      writeFileSync(
        script,
        `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(root, 'override.invoked'))},'x');`,
        { mode: 0o600 },
      );
      return { OPENPLANR_CLAUDE_BIN: './stand-in.mjs' };
    });
    expect(present).toEqual(expected(true, false, false));
    const absent = await inspectFixture((root, bin) => {
      executable(bin, process.platform === 'win32' ? 'claude.EXE' : 'claude');
      return { OPENPLANR_CLAUDE_BIN: join(root, 'missing.mjs') };
    });
    expect(absent).toEqual(expected(false, false, false));
    const directory = await inspectFixture((root) => ({ OPENPLANR_CLAUDE_BIN: root }));
    expect(directory).toEqual(expected(false, false, false));
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'rejects an unreadable Claude stand-in',
    async () => {
      const result = await inspectFixture((root) => {
        const script = join(root, 'stand-in.mjs');
        writeFileSync(script, 'fixture', { mode: 0o000 });
        return { OPENPLANR_CLAUDE_BIN: script };
      });
      expect(result).toEqual(expected(false, false, false));
    },
  );

  it('handles Windows quoted/relative PATH and exact PATHEXT selection without launching files', async () => {
    const result = await inspectFixture((root) => {
      const relative = 'tool bin';
      mkdirSync(join(root, relative));
      for (const name of ['claude.EXE', 'codex.CMD', 'cursor.COM']) {
        writeFileSync(join(root, relative, name), 'discoverable fixture, not authenticated code');
      }
      return {
        FIXTURE_WINDOWS: '1',
        PATH: `"${relative}"`,
        PATHEXT: ' .CMD ; .EXE ; .COM ',
      };
    });
    expect(result).toEqual(expected(true, true, true));
    const restricted = await inspectFixture((_root, bin) => {
      writeFileSync(join(bin, 'codex.EXE'), 'fixture');
      writeFileSync(join(bin, 'cursor.CMD'), 'fixture');
      return { FIXTURE_WINDOWS: '1', PATHEXT: '.CMD' };
    });
    expect(restricted).toEqual(expected(false, false, true));
  });

  it('preserves quoted semicolons, interior apostrophes and whitespace in Windows PATH', async () => {
    for (const quote of ['"', "'"]) {
      const quoted = await inspectFixture((root) => {
        const directory = 'tool;bin';
        mkdirSync(join(root, directory));
        writeFileSync(join(root, directory, 'codex.EXE'), 'discoverable fixture');
        return { FIXTURE_WINDOWS: '1', PATH: `${quote}${directory}${quote}`, PATHEXT: '.EXE' };
      });
      expect(quoted).toEqual(expected(false, true, false));
      const unmatched = await inspectFixture((root) => {
        const directory = 'tool;bin';
        mkdirSync(join(root, directory));
        writeFileSync(join(root, directory, 'codex.EXE'), 'discoverable fixture');
        return { FIXTURE_WINDOWS: '1', PATH: `${quote}${directory}`, PATHEXT: '.EXE' };
      });
      expect(unmatched).toEqual(expected(false, true, false));
    }
    const interior = await inspectFixture((root) => {
      const first = "O'Neil";
      const second = 'next-bin';
      mkdirSync(join(root, first));
      mkdirSync(join(root, second));
      writeFileSync(join(root, first, 'claude.EXE'), 'discoverable fixture');
      writeFileSync(join(root, second, 'cursor.EXE'), 'discoverable fixture');
      return { FIXTURE_WINDOWS: '1', PATH: `${first};${second}`, PATHEXT: '.EXE' };
    });
    expect(interior).toEqual(expected(true, false, true));
    const spaces = await inspectFixture((root) => {
      const directory = ' spaced bin ';
      mkdirSync(join(root, directory));
      writeFileSync(join(root, directory, 'codex.EXE'), 'discoverable fixture');
      return { FIXTURE_WINDOWS: '1', PATH: directory, PATHEXT: '.EXE' };
    });
    expect(spaces).toEqual(expected(false, true, false));
    const unresolvable = await inspectFixture((_root, bin) => {
      writeFileSync(join(bin, 'claude.EXE'), 'discoverable fixture');
      return { FIXTURE_WINDOWS: '1', PATH: ` "${bin}" `, PATHEXT: '.EXE' };
    });
    expect(unresolvable).toEqual(expected(false, false, false));
  });

  it('uses Windows default extensions and Path fallback while rejecting malformed suffixes', async () => {
    const result = await inspectFixture((_root, bin) => {
      writeFileSync(join(bin, 'codex.EXE'), 'fixture');
      return { FIXTURE_WINDOWS: '1', PATH: undefined, Path: bin, PATHEXT: undefined };
    });
    expect(result).toEqual(expected(false, true, false));
    const malformed = await inspectFixture((_root, bin) => {
      writeFileSync(join(bin, 'codex.EXE'), 'fixture');
      return { FIXTURE_WINDOWS: '1', PATHEXT: '.EXE/../EXE;.EXE\\bad;EXE' };
    });
    expect(malformed).toEqual(expected(false, false, false));
  });
});
