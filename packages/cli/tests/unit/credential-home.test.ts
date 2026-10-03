import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { migratePrivateCredentialHome } from '../../src/services/credential-home.js';
import { withCredentialWriteLock } from '../../src/services/credential-write-lock.js';
import { isVerbose, logger, setVerbose } from '../../src/utils/logger.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'credential-home-'));
  roots.push(root);
  const legacy = join(root, '.planr'),
    selected = join(root, 'selected');
  await mkdir(legacy, { mode: 0o700 });
  return { root, legacy, selected };
}
async function write(directory: string, name: string, value: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, name), value, { mode: 0o600 });
}
it('copies exact private credential bytes once and does not resurrect a migrated deletion', async () => {
  const { legacy, selected } = await fixture();
  const bytes = '{"linear":"dummy-old-account"}\n';
  await write(legacy, 'credentials.json', bytes);
  await Promise.all(
    Array.from({ length: 4 }, () =>
      migratePrivateCredentialHome(selected, legacy, ['credentials.json'], 'legacy'),
    ),
  );
  expect(await readFile(join(selected, 'credentials.json'), 'utf8')).toBe(bytes);
  expect(await readFile(join(legacy, 'credentials.json'), 'utf8')).toBe(bytes);
  expect((await stat(join(selected, 'credentials.json'))).mode & 0o777).toBe(0o600);
  await unlink(join(selected, 'credentials.json'));
  await migratePrivateCredentialHome(selected, legacy, ['credentials.json'], 'legacy');
  await expect(readFile(join(selected, 'credentials.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});
it('keeps an existing destination and marks it authoritative across a later deletion', async () => {
  const { legacy, selected } = await fixture();
  await write(legacy, 'credentials.json', '{"linear":"dummy-old"}');
  await write(selected, 'credentials.json', '{"linear":"dummy-current"}');
  await migratePrivateCredentialHome(selected, legacy, ['credentials.json'], 'legacy');
  expect(await readFile(join(selected, 'credentials.json'), 'utf8')).toBe(
    '{"linear":"dummy-current"}',
  );
  await unlink(join(selected, 'credentials.json'));
  await migratePrivateCredentialHome(selected, legacy, ['credentials.json'], 'legacy');
  await expect(readFile(join(selected, 'credentials.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});
it('rejects missing or conflicting salt before publishing encrypted credentials', async () => {
  const { legacy, selected } = await fixture();
  await write(legacy, 'credentials.enc', '{"version":2}');
  await expect(
    migratePrivateCredentialHome(
      selected,
      legacy,
      ['credentials.enc', '.credential-salt'],
      'encrypted',
    ),
  ).rejects.toThrow('incomplete');
  await write(legacy, '.credential-salt', 'a'.repeat(32));
  await write(selected, '.credential-salt', 'b'.repeat(32));
  await expect(
    migratePrivateCredentialHome(
      selected,
      legacy,
      ['credentials.enc', '.credential-salt'],
      'encrypted',
    ),
  ).rejects.toThrow('preserved');
  await expect(readFile(join(selected, 'credentials.enc'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(await readFile(join(selected, '.credential-salt'), 'utf8')).toBe('b'.repeat(32));
});
it('rejects malformed, oversized and symlinked legacy bytes without creating a destination record', async () => {
  const { root, legacy, selected } = await fixture();
  const file = join(legacy, 'credentials.json');
  for (const bytes of ['{broken', 'x'.repeat(1024 * 1024 + 1)]) {
    await write(legacy, 'credentials.json', bytes);
    await expect(
      migratePrivateCredentialHome(selected, legacy, ['credentials.json'], 'legacy'),
    ).rejects.toThrow('preserved');
    expect(await readFile(file, 'utf8')).toBe(bytes);
    await expect(readFile(join(selected, 'credentials.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }
  await unlink(file);
  const outside = join(root, 'outside.json');
  await writeFile(outside, '{}', { mode: 0o600 });
  await symlink(outside, file);
  await expect(
    migratePrivateCredentialHome(selected, legacy, ['credentials.json'], 'legacy'),
  ).rejects.toThrow('preserved');
  await unlink(file);
  await write(legacy, 'credentials.json', '{}');
  if (process.platform !== 'win32') {
    await chmod(file, 0o644);
    await expect(
      migratePrivateCredentialHome(selected, legacy, ['credentials.json'], 'legacy'),
    ).rejects.toThrow('preserved');
  }
});
it('default stores honor the override, copy the ciphertext/salt pair and retain company metadata', async () => {
  const { root, legacy, selected } = await fixture();
  vi.stubEnv('HOME', root);
  vi.stubEnv('PLANR_HOME', selected);
  vi.stubEnv('OPENPLANR_HOME', '');
  vi.resetModules();
  const { EncryptedFileBackend, LegacyPlaintextBackend } = await import(
    '../../src/services/credential-backends.js'
  );
  const { CompanyAuthStore } = await import('../../src/services/company-auth-store.js');
  const passphrase = 'dummy-only-passphrase-for-migration';
  const prior = new EncryptedFileBackend(legacy, { passphrase });
  await prior.setStrict('company:dummy', 'dummy-value');
  const cipher = await readFile(join(legacy, 'credentials.enc'));
  const current = new EncryptedFileBackend(undefined, { passphrase });
  expect(await current.getStrict('company:dummy')).toBe('dummy-value');
  expect(await readFile(join(selected, 'credentials.enc'))).toEqual(cipher);
  await current.setStrict('openai', 'dummy-current-key');
  expect(await prior.getStrict('openai')).toBeUndefined();
  await write(legacy, 'credentials.json', '{"linear":"dummy-linear"}');
  expect(await new LegacyPlaintextBackend().loadAll()).toEqual({ linear: 'dummy-linear' });
  const origin = 'https://company.example.test';
  const oldAuth = new CompanyAuthStore(join(legacy, 'company-auth'));
  await oldAuth.write(origin, { status: 'dummy-test', revision: 1 });
  const newAuth = new CompanyAuthStore();
  expect(await newAuth.read(origin)).toEqual({ status: 'dummy-test', revision: 1 });
  await newAuth.write(origin, { status: 'signed-out', revision: 2 });
  expect(await oldAuth.read(origin)).toEqual({ status: 'dummy-test', revision: 1 });
  expect(await newAuth.read(origin)).toEqual({ status: 'signed-out', revision: 2 });
});

it('validates an existing destination tuple before treating it as authoritative', async () => {
  const { legacy, selected } = await fixture();
  await write(legacy, 'credentials.enc', '{"version":2}');
  await write(legacy, '.credential-salt', 'a'.repeat(32));
  await write(selected, 'credentials.enc', '{"version":2}');
  for (const salt of [undefined, 'invalid-salt', 'b'.repeat(32)]) {
    if (salt !== undefined) await write(selected, '.credential-salt', salt);
    if (salt === 'b'.repeat(32)) await write(selected, 'credentials.enc', '{broken');
    await expect(
      migratePrivateCredentialHome(
        selected,
        legacy,
        ['credentials.enc', '.credential-salt'],
        'encrypted',
      ),
    ).rejects.toThrow('preserved');
    await expect(readFile(join(selected, '.migrated-credentials.enc.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }
});

it('rejects symlinked ancestors in either home before copying custody', async () => {
  const { root, legacy, selected } = await fixture();
  await write(legacy, 'credentials.json', '{}');
  const alias = join(root, 'home-alias');
  await symlink(root, alias, 'dir');
  for (const [destination, source] of [
    [join(alias, 'selected'), legacy],
    [selected, join(alias, '.planr')],
  ]) {
    await expect(
      migratePrivateCredentialHome(destination, source, ['credentials.json'], 'legacy'),
    ).rejects.toThrow('preserved');
  }
  await expect(readFile(join(selected, 'credentials.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(await readFile(join(legacy, 'credentials.json'), 'utf8')).toBe('{}');
});

it('keeps malformed credential content out of verbose nested error diagnostics', async () => {
  const { legacy, selected } = await fixture();
  const privateValue = 'dummy-private-content-must-not-appear';
  await write(legacy, 'credentials.json', `{"linear":"${privateValue}",invalid}`);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  const previousVerbose = isVerbose();
  try {
    setVerbose(true);
    const error = await migratePrivateCredentialHome(
      selected,
      legacy,
      ['credentials.json'],
      'legacy',
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    logger.debug('Credential migration failed', error);
    const diagnostics = output.mock.calls.flat().join(' ');
    expect(diagnostics).toContain('not valid JSON');
    expect(diagnostics).not.toContain(privateValue);
    expect(diagnostics).not.toContain('invalid}');
  } finally {
    setVerbose(previousVerbose);
    output.mockRestore();
  }
});

it('finishes an empty legacy import before reads inside the selected writer lock', async () => {
  const { root, selected } = await fixture();
  vi.stubEnv('HOME', root);
  vi.stubEnv('PLANR_HOME', selected);
  vi.stubEnv('OPENPLANR_HOME', '');
  vi.resetModules();
  const { LegacyPlaintextBackend } = await import('../../src/services/credential-backends.js');
  const current = new LegacyPlaintextBackend();
  await current.prepareHome();
  await withCredentialWriteLock(
    selected,
    async () => {
      expect(await current.exists()).toBe(false);
      expect(await current.loadAllPrepared()).toEqual({});
    },
    250,
    'legacy',
  );
  const { migrateCredentials } = await import('../../src/services/credentials-service.js');
  expect(await migrateCredentials()).toBe(false);
}, 2000);

it('reads already prepared legacy storage without acquiring migration locks again', async () => {
  const { root, legacy, selected } = await fixture();
  await rm(legacy, { recursive: true });
  vi.stubEnv('HOME', root);
  vi.stubEnv('PLANR_HOME', selected);
  vi.stubEnv('OPENPLANR_HOME', '');
  vi.resetModules();
  const { LegacyPlaintextBackend } = await import('../../src/services/credential-backends.js');
  const current = new LegacyPlaintextBackend();
  await current.prepareHome();
  await mkdir(legacy, { mode: 0o700 });
  await write(legacy, 'credentials.json', '{"linear":"dummy-new-legacy"}');
  await withCredentialWriteLock(
    selected,
    async () => {
      expect(await current.loadAllPrepared()).toEqual({});
    },
    250,
    'legacy',
  );
  expect(await readFile(join(legacy, 'credentials.json'), 'utf8')).toContain('dummy-new-legacy');
}, 2000);

it('rejects unsafe previous company metadata directories without repairing their permissions', async () => {
  if (process.platform === 'win32') return;
  const { root, legacy, selected } = await fixture();
  vi.stubEnv('HOME', root);
  vi.stubEnv('PLANR_HOME', selected);
  vi.stubEnv('OPENPLANR_HOME', '');
  vi.resetModules();
  const { CompanyAuthStore } = await import('../../src/services/company-auth-store.js');
  const origin = 'https://company.example.test';
  const old = new CompanyAuthStore(join(legacy, 'company-auth'));
  await old.write(origin, { status: 'dummy-test' });
  await chmod(old.directory, 0o755);
  await expect(new CompanyAuthStore().read(origin)).rejects.toMatchObject({
    code: 'E_COMPANY_AUTH_STORE',
  });
  expect((await stat(old.directory)).mode & 0o777).toBe(0o755);
  expect(
    await readFile(
      join(
        old.directory,
        (await import('node:crypto')).createHash('sha256').update(origin).digest('hex') + '.json',
      ),
      'utf8',
    ),
  ).toBe('{"status":"dummy-test"}');
});
