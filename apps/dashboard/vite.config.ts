import { createHash } from 'node:crypto';
import {
  lstatSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type UserConfig } from 'vite';

const repositoryRoot = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(repositoryRoot, 'package.json');
const componentsJsonPath = resolve(repositoryRoot, 'components.json');
const tsconfigPath = resolve(repositoryRoot, 'tsconfig.json');
const dashboardTsconfigPath = resolve(repositoryRoot, 'tsconfig.json');
const dashboardConfigPath = fileURLToPath(import.meta.url);
const dashboardSourceRoot = resolve(repositoryRoot, 'src');

function dashboardSourceFiles(directory = dashboardSourceRoot): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    .flatMap((entry) => {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink()) {
        throw new Error('Dashboard source must not contain symbolic links.');
      }
      if (entry.isDirectory()) return dashboardSourceFiles(absolute);
      if (!entry.isFile()) throw new Error('Dashboard source must contain only regular files.');
      return [absolute];
    });
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function emittedAssetBytes(outputRoot: string, asset: string): Uint8Array {
  const candidate = resolve(outputRoot, asset);
  const outputRelative = relative(outputRoot, candidate);
  if (
    asset.length === 0
    || isAbsolute(asset)
    || outputRelative === '..'
    || outputRelative.startsWith(`..${sep}`)
    || outputRelative.length === 0
  ) {
    throw new Error(`Dashboard manifest asset is outside the build output: ${asset}`);
  }
  const metadata = lstatSync(candidate);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Dashboard manifest asset is not a regular file: ${asset}`);
  }
  return readFileSync(candidate);
}

export function dashboardSourceBuildId(
  dashboardConfigSource = readFileSync(dashboardConfigPath),
): string {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    version?: unknown;
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  const version = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
  const dependencyVersions = Object.fromEntries(
    [
      '@tailwindcss/vite',
      '@openplanr/protocol',
      '@tanstack/react-query',
      '@vitejs/plugin-react',
      'class-variance-authority',
      'clsx',
      'lucide-react',
      'radix-ui',
      'react',
      'react-dom',
      'react-router',
      'tailwindcss',
      'tailwind-merge',
      'tw-animate-css',
      'vite',
    ].map((name) => [
      name,
      packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name] ?? null,
    ]),
  );
  const digest = createHash('sha256')
    .update(version)
    .update('\0')
    .update(JSON.stringify(dependencyVersions))
    .update('\0')
    .update(readFileSync(componentsJsonPath))
    .update('\0')
    .update(readFileSync(tsconfigPath))
    .update('\0')
    .update(readFileSync(dashboardTsconfigPath))
    .update('\0')
    .update(dashboardConfigSource)
    .update('\0');
  for (const sourcePath of dashboardSourceFiles()) {
    const sourceRelative = relative(dashboardSourceRoot, sourcePath).split(sep).join('/');
    digest.update(sourceRelative).update('\0').update(readFileSync(sourcePath)).update('\0');
  }
  return `dashboard-${version}-${digest.digest('hex').slice(0, 16)}`;
}

function stableDashboardManifest(buildId: string): Plugin {
  return {
    name: 'openplanr-dashboard-manifest',
    apply: 'build',
    writeBundle(outputOptions, bundle) {
      if (!outputOptions.dir) {
        throw new Error('Dashboard build output directory is required for asset custody.');
      }
      const outputRoot = resolve(outputOptions.dir);
      const assets = Object.keys(bundle)
        .filter((asset) => asset !== 'index.html' && !asset.startsWith('.vite/'))
        .sort();
      // Vite's internal `.vite/manifest.json` is build tooling metadata. This
      // manifest owns the browser-served entry document and emitted assets.
      const declaredAssets = ['index.html', ...assets].sort();
      const assetDigests = Object.fromEntries(
        declaredAssets.map((asset) => {
          const bytes = emittedAssetBytes(outputRoot, asset);
          return [asset, { bytes: bytes.length, sha256: sha256(bytes) }];
        }),
      );
      const manifest = {
        kind: 'openplanr-dashboard-build',
        schemaVersion: '1.0.0',
        buildId,
        entry: 'index.html',
        assets,
        assetDigests,
      };
      writeFileSync(
        resolve(outputRoot, 'dashboard-manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    },
  };
}

export default defineConfig(() => {
  const buildId = dashboardSourceBuildId();
  const config: UserConfig = {
    root: dashboardSourceRoot,
    base: './',
    publicDir: false,
    plugins: [
      react(),
      tailwindcss(),
      stableDashboardManifest(buildId),
    ].filter(Boolean) as Plugin[],
    resolve: {
      alias: {
        '@dashboard': dashboardSourceRoot,
      },
    },
    define: {
      __OPENPLANR_DASHBOARD_BUILD_ID__: JSON.stringify(buildId),
    },
    build: {
      outDir: resolve(repositoryRoot, 'dist'),
      emptyOutDir: true,
      manifest: '.vite/manifest.json',
      sourcemap: true,
      reportCompressedSize: false,
      rollupOptions: {
        input: resolve(repositoryRoot, 'src/index.html'),
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
  return config;
});
