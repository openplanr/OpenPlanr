import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { CompanyAuthStore } from '../../src/services/company-auth-store.js';

const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, lstat: vi.fn(original.lstat) };
});

const origin = 'https://company.example.test';
const filename = `${createHash('sha256').update(origin).digest('hex')}.json`;
const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.mocked(fs.lstat).mockImplementation(actual.lstat);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'company-auth-custody-')));
  roots.push(root);
  const shared = path.join(root, 'shared');
  await mkdir(shared, { mode: 0o700 });
  return { root, shared };
}

it.skipIf(process.platform === 'win32')(
  'keeps an explicit private store usable under a shared sticky temporary directory',
  async () => {
    const { shared } = await fixture();
    await chmod(shared, 0o1777);
    const directory = await mkdtemp(path.join(shared, 'auth-'));
    const store = new CompanyAuthStore(directory);
    const value = { status: 'dummy-signed-in', revision: 1 };
    await store.locked(() => store.write(origin, value));
    expect(await store.read(origin)).toEqual(value);
    expect((await stat(shared)).mode & 0o7777).toBe(0o1777);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(directory, filename))).mode & 0o777).toBe(0o600);
  },
);

it.skipIf(process.platform === 'win32')(
  'allows a parent readable by other users without changing its permissions',
  async () => {
    const { shared } = await fixture();
    await chmod(shared, 0o755);
    const store = new CompanyAuthStore(path.join(shared, 'auth'));
    await store.write(origin, { status: 'dummy-signed-out' });
    expect(await store.read(origin)).toEqual({ status: 'dummy-signed-out' });
    expect((await stat(shared)).mode & 0o777).toBe(0o755);
  },
);

it.skipIf(process.platform === 'win32')(
  'rejects a writable non-sticky ancestor before storing authentication metadata',
  async () => {
    const { shared } = await fixture();
    const ancestor = path.join(shared, 'unsafe');
    const directory = path.join(ancestor, 'private', 'auth');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(ancestor, 0o777);
    const store = new CompanyAuthStore(directory);
    await expect(store.write(origin, { status: 'dummy-test' })).rejects.toMatchObject({
      code: 'E_COMPANY_AUTH_STORE',
    });
    expect((await stat(ancestor)).mode & 0o777).toBe(0o777);
    await expect(readFile(path.join(directory, filename))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  },
);

it.skipIf(process.platform === 'win32')(
  'rejects a foreign-owned ancestor even when its permissions are 0755',
  async () => {
    const { shared } = await fixture();
    await chmod(shared, 0o755);
    const directory = path.join(shared, 'private', 'auth');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const bytes = '{"status":"dummy-existing"}\n';
    await writeFile(path.join(directory, filename), bytes, { mode: 0o600 });
    const foreignUid = process.getuid?.() === 12345 ? 12346 : 12345;
    vi.mocked(fs.lstat).mockImplementation((async (...args: Parameters<typeof actual.lstat>) => {
      const info = await actual.lstat(...args);
      if (args[0] !== shared) return info;
      const descriptors = Object.getOwnPropertyDescriptors(info);
      descriptors.uid = { ...descriptors.uid, value: foreignUid };
      return Object.create(Object.getPrototypeOf(info), descriptors);
    }) as typeof actual.lstat);
    const store = new CompanyAuthStore(directory);
    await expect(store.read(origin)).rejects.toMatchObject({ code: 'E_COMPANY_AUTH_STORE' });
    await expect(store.write(origin, { status: 'dummy-new' })).rejects.toMatchObject({
      code: 'E_COMPANY_AUTH_STORE',
    });
    expect((await stat(shared)).mode & 0o777).toBe(0o755);
    expect(await readFile(path.join(directory, filename), 'utf8')).toBe(bytes);
  },
);

it.skipIf(process.platform === 'win32')(
  'rejects an unsafe existing store leaf without repairing permissions or replacing bytes',
  async () => {
    const { shared } = await fixture();
    const directory = path.join(shared, 'auth');
    await mkdir(directory, { mode: 0o700 });
    const bytes = '{"status":"dummy-existing"}\n';
    await writeFile(path.join(directory, filename), bytes, { mode: 0o600 });
    await chmod(directory, 0o755);
    const store = new CompanyAuthStore(directory);
    await expect(store.read(origin)).rejects.toMatchObject({ code: 'E_COMPANY_AUTH_STORE' });
    await expect(store.write(origin, { status: 'dummy-new' })).rejects.toMatchObject({
      code: 'E_COMPANY_AUTH_STORE',
    });
    expect((await stat(directory)).mode & 0o777).toBe(0o755);
    expect(await readFile(path.join(directory, filename), 'utf8')).toBe(bytes);
  },
);

it.skipIf(process.platform === 'win32')(
  'rejects a symlinked ancestor before replacing authentication metadata',
  async () => {
    const { root, shared } = await fixture();
    const directory = path.join(shared, 'auth');
    await mkdir(directory, { mode: 0o700 });
    const bytes = '{"status":"dummy-existing"}\n';
    await writeFile(path.join(directory, filename), bytes, { mode: 0o600 });
    const alias = path.join(root, 'alias');
    await symlink(shared, alias, 'dir');
    await expect(
      new CompanyAuthStore(path.join(alias, 'auth')).write(origin, { status: 'dummy-new' }),
    ).rejects.toMatchObject({ code: 'E_COMPANY_AUTH_STORE' });
    expect(await readFile(path.join(directory, filename), 'utf8')).toBe(bytes);
  },
);

it.skipIf(process.platform === 'win32')(
  'still requires the default home to be private',
  async () => {
    const { root, shared } = await fixture();
    vi.stubEnv('HOME', root);
    vi.stubEnv('PLANR_HOME', shared);
    vi.stubEnv('OPENPLANR_HOME', '');
    await chmod(shared, 0o755);
    await expect(new CompanyAuthStore().read(origin)).rejects.toMatchObject({
      code: 'E_COMPANY_AUTH_STORE',
    });
    expect((await stat(shared)).mode & 0o777).toBe(0o755);
  },
);

it.skipIf(process.platform === 'win32')(
  'preserves legacy bytes beneath an unsafe writable ancestor and refuses migration',
  async () => {
    const { root, shared } = await fixture();
    const legacy = path.join(root, '.planr');
    const oldDirectory = path.join(legacy, 'company-auth');
    await mkdir(oldDirectory, { recursive: true, mode: 0o700 });
    const bytes = '{"status":"dummy-legacy"}\n';
    await writeFile(path.join(oldDirectory, filename), bytes, { mode: 0o600 });
    await chmod(legacy, 0o777);
    vi.stubEnv('HOME', root);
    vi.stubEnv('PLANR_HOME', shared);
    vi.stubEnv('OPENPLANR_HOME', '');
    await expect(new CompanyAuthStore().read(origin)).rejects.toMatchObject({
      code: 'E_COMPANY_AUTH_STORE',
    });
    expect((await stat(legacy)).mode & 0o777).toBe(0o777);
    expect(await readFile(path.join(oldDirectory, filename), 'utf8')).toBe(bytes);
    await expect(readFile(path.join(shared, 'company-auth', filename))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  },
);
