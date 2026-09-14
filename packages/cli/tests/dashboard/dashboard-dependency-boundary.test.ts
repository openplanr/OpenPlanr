// @vitest-environment jsdom

import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  DashboardTestSurface,
  renderDashboardComponent,
} from '../../../../apps/dashboard/src/test/component-harness.js';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspaceRoot = resolve(cliRoot, '../..');
const dashboardRoot = resolve(workspaceRoot, 'apps/dashboard');
const dashboardSourceRoot = resolve(dashboardRoot, 'src');
const packageJson = JSON.parse(readFileSync(resolve(dashboardRoot, 'package.json'), 'utf8')) as {
  name?: string;
  version?: string;
  private?: boolean;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const components = JSON.parse(readFileSync(resolve(dashboardRoot, 'components.json'), 'utf8')) as {
  style?: string;
  rsc?: boolean;
  iconLibrary?: string;
  tailwind?: { config?: string; css?: string; cssVariables?: boolean };
  aliases?: Record<string, string>;
};

const EXPECTED_RUNTIME = {
  '@openplanr/protocol': '0.1.0',
  '@tanstack/react-query': '5.101.4',
  'class-variance-authority': '0.7.1',
  clsx: '2.1.1',
  'lucide-react': '1.31.0',
  'radix-ui': '1.6.7',
  react: '19.2.8',
  'react-dom': '19.2.8',
  'react-router': '7.18.3',
  'tailwind-merge': '3.6.0',
  'tw-animate-css': '1.4.0',
} as const;

function sourceFiles(root: string): string[] {
  return readdirSync(root)
    .sort((left, right) => left.localeCompare(right, 'en'))
    .flatMap((name) => {
      const candidate = join(root, name);
      const metadata = lstatSync(candidate);
      if (metadata.isSymbolicLink())
        throw new Error(`dashboard source contains a symlink: ${candidate}`);
      return metadata.isDirectory() ? sourceFiles(candidate) : [candidate];
    });
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/gu)].map(
    (match) => match[2],
  );
}

describe('dashboard workspace boundary', () => {
  it('owns the browser app as a private 0.1 package with exact portable dependencies', () => {
    expect(packageJson).toMatchObject({
      name: '@openplanr/dashboard-app',
      version: '0.1.0',
      private: true,
      engines: { node: '>=20.0.0' },
      dependencies: EXPECTED_RUNTIME,
    });
    for (const version of Object.values({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    })) {
      expect(version).not.toMatch(/^(?:file:|link:|workspace:)/u);
    }
    expect(packageJson.dependencies).not.toHaveProperty('planr-pipeline');
    expect(packageJson.dependencies).not.toHaveProperty('openplanr');
  });

  it('keeps shadcn and aliases scoped to the standalone source root', () => {
    expect(components).toMatchObject({
      style: 'new-york',
      rsc: false,
      iconLibrary: 'lucide',
      tailwind: { config: '', css: 'src/design-system/tokens.css', cssVariables: true },
    });
    const tsconfig = JSON.parse(readFileSync(resolve(dashboardRoot, 'tsconfig.json'), 'utf8')) as {
      compilerOptions?: { paths?: Record<string, string[]> };
      include?: string[];
    };
    expect(tsconfig.compilerOptions?.paths).toEqual({ '@dashboard/*': ['./src/*'] });
    expect(tsconfig.include).toEqual(['vite.config.ts', 'src/**/*']);
    for (const alias of Object.values(components.aliases ?? {}))
      expect(alias).toMatch(/^@dashboard\//u);
  });

  it('imports only browser dependencies, protocol contracts, and app-local modules', () => {
    const violations = sourceFiles(dashboardSourceRoot)
      .filter((path) => ['.ts', '.tsx'].includes(extname(path)))
      .flatMap((path) =>
        importSpecifiers(readFileSync(path, 'utf8'))
          .filter(
            (specifier) =>
              specifier === 'planr-pipeline' ||
              specifier.startsWith('planr-pipeline/') ||
              specifier === 'openplanr' ||
              specifier.startsWith('openplanr/') ||
              specifier.includes('/packages/cli/') ||
              specifier.includes('/services/operate/'),
          )
          .map((specifier) => `${relative(dashboardRoot, path)}: ${specifier}`),
      );
    expect(violations).toEqual([]);
  });

  it('changes build identity when build configuration changes', () => {
    const configPath = resolve(dashboardRoot, 'vite.config.ts');
    const output = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '--eval',
        `import { readFileSync } from 'node:fs';
         const module = await import(${JSON.stringify(pathToFileURL(configPath).href)});
         const source = readFileSync(${JSON.stringify(configPath)});
         console.log(module.dashboardSourceBuildId(source));
         console.log(module.dashboardSourceBuildId(Buffer.concat([source, Buffer.from('\\n// build identity drift\\n')])));`,
      ],
      { cwd: cliRoot, encoding: 'utf8' },
    )
      .trim()
      .split('\n');
    expect(output).toHaveLength(2);
    expect(output[0]).not.toBe(output[1]);
  });

  it('keeps Node Operate readers outside the browser application', () => {
    expect(sourceFiles(resolve(cliRoot, 'src/services/operate')).length).toBeGreaterThan(0);
    expect(
      sourceFiles(dashboardSourceRoot).some((path) => path.includes('/services/operate/')),
    ).toBe(false);
  });

  it('provides the deterministic keyboard and accessibility harness after extraction', async () => {
    const harness = renderDashboardComponent(
      createElement(
        DashboardTestSurface,
        null,
        createElement('label', { htmlFor: 'foundation-name' }, 'Foundation name'),
        createElement('input', { id: 'foundation-name' }),
        createElement('button', { type: 'button' }, 'Continue'),
      ),
    );
    try {
      await harness.user.tab();
      expect(document.activeElement).toBe(harness.result.getByLabelText('Foundation name'));
      await harness.user.tab();
      expect(document.activeElement).toBe(harness.result.getByRole('button', { name: 'Continue' }));
      expect((await harness.audit()).violations).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });
});
