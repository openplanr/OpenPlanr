import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Materialize a large monorepo whose OpenPlanr planning tree (`.planr/`) is
 * gitignored. FR15 scenario 4: a real Operate cycle must run inside a large
 * monorepo without ever staging `.planr/`, and `git check-ignore .planr` must
 * succeed.
 *
 * The tree is generated from the committed seed so the fixture stays small in
 * this repository while the canary exercises a realistically large worktree. The
 * canary cites `packages/core/src/index.ts`, which is always written and
 * committed here.
 */

const here = dirname(fileURLToPath(import.meta.url));

function seed(name) {
  return readFileSync(join(here, 'large-monorepo', name), 'utf8');
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

export function materializeLargeMonorepo({
  directory,
  packages = 12,
  filesPerPackage = 40,
  commit = true,
} = {}) {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true });

  writeFileSync(join(root, '.gitignore'), seed('gitignore.seed'));
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'large-monorepo-fixture',
        private: true,
        version: '0.0.0',
        workspaces: ['packages/*'],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, 'README.md'),
    '# Large monorepo fixture\n\nOpenPlanr planning lives under a gitignored `.planr/`.\n',
  );

  // The cited core package.
  const coreSrc = join(root, 'packages', 'core', 'src');
  mkdirSync(coreSrc, { recursive: true });
  writeFileSync(join(coreSrc, 'index.ts'), seed('index.seed.ts'));

  // Bulk of the worktree: many small, real source files across many packages.
  let fileCount = 1;
  for (let p = 0; p < packages; p += 1) {
    const pkgSrc = join(root, 'packages', `service-${String(p).padStart(2, '0')}`, 'src');
    mkdirSync(pkgSrc, { recursive: true });
    for (let f = 0; f < filesPerPackage; f += 1) {
      const moduleName = `module${String(f).padStart(3, '0')}`;
      writeFileSync(
        join(pkgSrc, `${moduleName}.ts`),
        `// service-${p} ${moduleName}\n` +
          `export const ${moduleName} = (input: number): number => input + ${p * f};\n`,
      );
      fileCount += 1;
    }
  }

  // A gitignored planning tree that must never be staged.
  mkdirSync(join(root, '.planr', 'operate'), { recursive: true });
  writeFileSync(
    join(root, '.planr', 'operate', 'placeholder.json'),
    '{ "note": "gitignored planning tree" }\n',
  );

  if (commit) {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.name', 'OpenPlanr Canary']);
    git(root, ['config', 'user.email', 'canary@openplanr.invalid']);
    git(root, ['add', '.']);
    git(root, ['commit', '--quiet', '-m', 'large monorepo fixture']);
  }

  return { root, fileCount };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directoryArg = process.argv.indexOf('--directory');
  if (directoryArg === -1 || !process.argv[directoryArg + 1]) {
    process.stderr.write('Usage: materialize-monorepo.mjs --directory <path>\n');
    process.exit(1);
  }
  const { root, fileCount } = materializeLargeMonorepo({
    directory: process.argv[directoryArg + 1],
  });
  process.stdout.write(`Materialized large monorepo (${fileCount} files) at ${root}\n`);
}
