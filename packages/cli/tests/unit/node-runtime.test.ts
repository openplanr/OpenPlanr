import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CLI_NODE_RANGE, supportsCliNodeVersion } from '../../lib/node-runtime.mjs';

const boundaries = [
  ['18.20.8', false],
  ['20.0.0', false],
  ['20.18.9', false],
  ['20.19.0', true],
  ['20.20.2', true],
  ['21.7.0', false],
  ['21.99.0', false],
  ['22.12.9', false],
  ['22.13.0', true],
  ['23.4.9', false],
  ['23.5.0', true],
  ['24.0.0', true],
  ['26.0.0', true],
] as const;
const malformedVersions = [
  '22',
  '22.13',
  '22.13.0-rc.1',
  '022.13.0',
  '22.13.0\n',
  'NaN.13.0',
  '9007199254740992.0.0',
  '22.9007199254740992.0',
  '22.13.9007199254740992',
  '22.013.0',
  '22.13.00',
  '22.13.0+build.1',
  '22.13.0.1',
  'v022.13.0',
  'v22.13.0-rc.1',
] as const;
const installerBoundaries = [
  ...boundaries,
  ...malformedVersions.map((version) => [version, false] as const),
  ['20.19.0-rc.1', false],
  ['23.5.0-rc.1', false],
  ['24.0.0-rc.1', false],
  ['v22.13.0', true],
] as const;
const directories: string[] = [];
const temporary = () => {
  const directory = mkdtempSync(join(tmpdir(), 'planr-node-support-'));
  directories.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('installed Node.js support', () => {
  it.each(boundaries)(
    'accepts %s only when its production dependency branches support it',
    (version, supported) => {
      expect(supportsCliNodeVersion(version)).toBe(supported);
      expect(supportsCliNodeVersion(`v${version}`)).toBe(supported);
    },
  );

  it.each(malformedVersions)('rejects malformed or unreleased version %s', (version) => {
    expect(supportsCliNodeVersion(version)).toBe(false);
  });

  it('publishes the same CLI policy and retains the independent parser and Protocol floors', () => {
    expect(JSON.parse(readFileSync(resolve('package.json'), 'utf8')).engines.node).toBe(
      CLI_NODE_RANGE,
    );
    const root = resolve('../..');
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).engines.node).toBe(
      '^22.13.0 || ^24.0.0 || >=26.0.0',
    );
    for (const name of ['artifact', 'design', 'pipeline']) {
      expect(
        JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8')).engines.node,
      ).toBe('>=20.19.0');
    }
    expect(
      JSON.parse(readFileSync(join(root, 'packages/protocol/package.json'), 'utf8')).engines.node,
    ).toBe('>=20');
  });

  it.each(boundaries)(
    'the actual bin rejects %s before loading compiled dependencies',
    (version, supported) => {
      const directory = temporary();
      mkdirSync(join(directory, 'bin'));
      mkdirSync(join(directory, 'lib'));
      mkdirSync(join(directory, 'dist/cli'), { recursive: true });
      writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
      copyFileSync(resolve('bin/openplanr.js'), join(directory, 'bin/openplanr.js'));
      copyFileSync(resolve('lib/node-runtime.mjs'), join(directory, 'lib/node-runtime.mjs'));
      writeFileSync(
        join(directory, 'dist/cli/index.js'),
        'process.stdout.write("compiled-entry-loaded\\n");\n',
      );
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)} }); await import(${JSON.stringify(pathToFileURL(join(directory, 'bin/openplanr.js')).href)});`,
        ],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(supported ? 0 : 1);
      expect(result.stdout).toBe(supported ? 'compiled-entry-loaded\n' : '');
      if (!supported) {
        expect(result.stderr).toContain('E_NODE_VERSION:');
        expect(result.stderr).toContain(CLI_NODE_RANGE);
        expect(result.stderr).toContain(`found ${version}`);
        expect(result.stderr).not.toContain('SyntaxError');
      }
    },
  );

  it.each(installerBoundaries)(
    'both standalone installer guards agree for %s',
    (version, supported) => {
      for (const filename of ['install.sh', 'install.ps1']) {
        const source = readFileSync(resolve(filename), 'utf8');
        const guard = source.match(/node -e '([^']+)'/u)?.[1];
        expect(guard).toBeDefined();
        const result = spawnSync(process.execPath, [
          '-e',
          `Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)} }); ${guard}`,
        ]);
        expect(result.status, filename).toBe(supported ? 0 : 1);
        expect(source).toContain(CLI_NODE_RANGE);
      }
    },
  );

  it.each(installerBoundaries)(
    'the PowerShell guard survives legacy native quote loss for %s',
    (version, supported) => {
      const source = readFileSync(resolve('install.ps1'), 'utf8');
      const guard = source.match(/node -e '([^']+)'/u)?.[1];
      expect(guard).toBeDefined();
      const versionCodes = [...version].map((character) => character.charCodeAt(0)).join(',');
      const result = spawnSync(process.execPath, [
        '-e',
        `Object.defineProperty(process.versions, String.fromCharCode(110,111,100,101), { value: String.fromCharCode(${versionCodes}) }); ${guard?.replaceAll('"', '')}`,
      ]);
      expect(result.stderr.toString()).not.toContain('SyntaxError');
      expect(result.status).toBe(supported ? 0 : 1);
      expect(guard).not.toMatch(/["']/u);
    },
  );

  it('runs the actual installer guard in Windows PowerShell 5.1 CI without installing packages', () => {
    const root = resolve('../..');
    const workflow = readFileSync(join(root, '.github/workflows/installer-guard.yml'), 'utf8');
    const fixture = readFileSync(resolve('tests/fixtures/installer-node-guard.ps1'), 'utf8');
    expect(workflow).toContain('runs-on: windows-latest');
    expect(workflow).toContain('shell: powershell');
    expect(workflow).toContain('packages/cli/tests/fixtures/installer-node-guard.ps1');
    expect(workflow).not.toMatch(/npm (?:ci|install)/u);
    expect(fixture).toContain('$PSVersionTable.PSVersion.Major -ne 5');
    expect(fixture).toContain('install.ps1');
    expect(fixture).toContain('$guard = $match.Groups[1].Value');
    expect(fixture).toContain('& node -e $probe');
    expect(fixture).not.toMatch(/& npm|& planr/u);
    for (const [version, supported] of installerBoundaries) {
      const value = version.endsWith('\n')
        ? `('${version.slice(0, -1)}' + [char]10)`
        : `'${version}'`;
      expect(fixture).toContain(`Version = ${value}; Supported = $${supported}`);
    }
  });

  it('keeps the standalone guards identical and quote-free', () => {
    const guards = ['install.sh', 'install.ps1'].map(
      (filename) => readFileSync(resolve(filename), 'utf8').match(/node -e '([^']+)'/u)?.[1],
    );
    expect(guards[0]).toBeDefined();
    expect(guards[0]).toBe(guards[1]);
    expect(guards[0]).not.toMatch(/["']/u);
  });

  it.each(['20.18.9', '20.19.0', '21.7.0', '22.12.9', '22.13.0', '23.4.9', '23.5.0'])(
    'the shell installer checks %s before any npm mutation',
    (version) => {
      const directory = temporary();
      const marker = join(directory, 'installed');
      const nodeShim = join(directory, 'node');
      writeFileSync(
        nodeShim,
        `#!${process.execPath}\nconst { spawnSync } = require('node:child_process');\nif (process.argv[2] === '--version') { console.log('v${version}'); } else { const result = spawnSync(${JSON.stringify(process.execPath)}, ['-e', 'Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} }); ' + process.argv[3]], { stdio: 'inherit' }); process.exit(result.status ?? 1); }\n`,
      );
      writeFileSync(
        join(directory, 'npm'),
        `#!/bin/sh\nprintf '%s\\n' installed > ${JSON.stringify(marker)}\n`,
      );
      writeFileSync(join(directory, 'openplanr'), '#!/bin/sh\nprintf "%s\\n" fixture-version\n');
      for (const filename of ['node', 'npm', 'openplanr'])
        chmodSync(join(directory, filename), 0o755);
      const result = spawnSync('/bin/sh', [resolve('install.sh'), '--minimal'], {
        env: { ...process.env, PATH: directory },
        encoding: 'utf8',
      });
      const supported = supportsCliNodeVersion(version);
      expect(result.status).toBe(supported ? 0 : 1);
      if (supported) expect(readFileSync(marker, 'utf8')).toBe('installed\n');
      else {
        expect(() => readFileSync(marker)).toThrow();
        expect(result.stderr).toContain('E_NODE_VERSION:');
        expect(result.stderr).toContain(CLI_NODE_RANGE);
      }
    },
  );
});
