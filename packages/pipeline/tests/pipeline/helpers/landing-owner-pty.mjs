import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { isatty } from 'node:tty';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const PTY_DRIVER = String.raw`
import base64
import errno
import json
import os
import pty
import select
import signal
import sys

config = json.loads(sys.argv[1])
owner_prompt = b'OPENPLANR_LANDING_OWNER_ID> '
choice_prompt = b'OPENPLANR_LANDING_CHOICE [confirm/cancel; no default]> '
choices = config['choices']
output = bytearray()
owner_count = 0
choice_count = 0
harness_error = None

pid, master = pty.fork()
if pid == 0:
    os.execvpe(config['argv'][0], config['argv'], os.environ)

os.set_blocking(master, False)
status = None
eof = False
while status is None or not eof:
    ready, _, _ = select.select([master], [], [], 0.05)
    if ready:
        try:
            chunk = os.read(master, 65536)
            if not chunk:
                eof = True
            else:
                output.extend(chunk)
                seen_owner = output.count(owner_prompt)
                while owner_count < seen_owner:
                    os.write(master, b'release-owner\n')
                    owner_count += 1
                seen_choice = output.count(choice_prompt)
                while choice_count < seen_choice:
                    if choice_count >= len(choices) or choices[choice_count] not in ('confirm', 'cancel'):
                        harness_error = f'unexpected owner choice prompt {choice_count + 1}'
                        os.write(master, b'cancel\n')
                    else:
                        os.write(master, choices[choice_count].encode('utf-8') + b'\n')
                    choice_count += 1
        except OSError as cause:
            if cause.errno == errno.EIO:
                eof = True
            else:
                raise
    if status is None:
        waited, raw_status = os.waitpid(pid, os.WNOHANG)
        if waited == pid:
            status = os.waitstatus_to_exitcode(raw_status)
    if status is not None and not ready:
        eof = True

try:
    os.close(master)
except OSError:
    pass
print(json.dumps({
    'answeredChoicePrompts': choice_count,
    'answeredOwnerPrompts': owner_count,
    'childStatus': status,
    'harnessError': harness_error,
    'output': base64.b64encode(bytes(output)).decode('ascii'),
}))
`;

export function hasRealOwnerTerminal() {
  return (
    Number.isInteger(process.stdin?.fd) &&
    Number.isInteger(process.stderr?.fd) &&
    isatty(process.stdin.fd) &&
    isatty(process.stderr.fd)
  );
}

export function isDirectTestModule(url) {
  return (
    typeof process.argv[1] === 'string' && resolve(process.argv[1]) === resolve(fileURLToPath(url))
  );
}

export function runTestFileInOwnerPty(testFile, { choices = [], env = {}, testNamePattern } = {}) {
  const testPath = testFile instanceof URL ? fileURLToPath(testFile) : testFile;
  const nodeArguments = [
    process.execPath,
    '--test',
    '--test-isolation=none',
    '--test-reporter=tap',
    ...(testNamePattern ? ['--test-name-pattern', testNamePattern] : []),
    resolve(testPath),
  ];

  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      'python3',
      ['-c', PTY_DRIVER, JSON.stringify({ argv: nodeArguments, choices })],
      {
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let driverOutput = '';
    let driverError = '';
    child.stdout.on('data', (chunk) => {
      driverOutput += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      driverError += chunk.toString();
    });
    child.once('error', (cause) =>
      rejectRun(new Error(`Unable to start the owner PTY test harness: ${cause.message}`)),
    );
    child.once('close', (code, signal) => {
      if (code !== 0) {
        rejectRun(
          new Error(`Owner PTY driver failed (${signal ?? code}).\n${driverError || driverOutput}`),
        );
        return;
      }
      let result;
      try {
        result = JSON.parse(driverOutput);
        result.output = Buffer.from(result.output, 'base64').toString();
      } catch (cause) {
        rejectRun(new Error(`Owner PTY driver returned invalid custody output: ${cause.message}`));
        return;
      }
      if (result.harnessError || result.childStatus !== 0) {
        rejectRun(
          new Error(
            `Owner PTY test child failed (${result.harnessError ?? result.childStatus}).\n${result.output}`,
          ),
        );
        return;
      }
      resolveRun(result);
    });
  });
}
