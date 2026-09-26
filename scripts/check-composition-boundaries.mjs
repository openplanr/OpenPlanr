#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const importCount = (source) => (source.match(/^import\b/gmu) ?? []).length;
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const importSpecifiers = (source) =>
  [...source.matchAll(/^import(?:.|\n)*?\bfrom\s+['"]([^'"]+)['"];?/gmu)].map((match) => match[1]);

function visitSourceFiles(relativeRoot, callback) {
  const directory = resolve(root, relativeRoot);
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const relativePath = path.slice(root.length + 1);
      if (entry.isDirectory()) {
        if (!['generated', 'vendor'].includes(entry.name)) stack.push(path);
      } else if (
        entry.isFile() &&
        ['.js', '.mjs', '.ts', '.tsx'].includes(extname(entry.name)) &&
        !/\.d\.(?:mts|ts)$/u.test(entry.name)
      ) {
        callback(relativePath, readFileSync(path, 'utf8'));
      }
    }
  }
}

const productionSourceRoots = Object.freeze([
  'apps/dashboard/src',
  'packages/cli/src',
  'packages/protocol/src',
  'packages/protocol/lib',
  'packages/operate/lib',
  'packages/artifact/lib',
  'packages/design/lib',
  'packages/skill-runtime/src',
  'packages/pipeline/lib',
]);
for (const sourceRoot of productionSourceRoots) {
  visitSourceFiles(sourceRoot, (relativePath, source) => {
    const count = importCount(source);
    if (count > 20) failures.push(`${relativePath} has ${count} imports (global maximum 20).`);
  });
}

const boundedCompositionRoots = Object.freeze({
  'packages/operate/lib/operate/runtime-foundation.mjs': './runtime-foundation/',
  'packages/pipeline/lib/operate/runtime-foundation.mjs': './runtime-foundation/',
  'packages/cli/src/services/operate/client.ts': './client/',
  'packages/cli/src/cli/commands/quick.ts': './quick/',
  'packages/cli/src/cli/commands/story.ts': './story/',
  'packages/pipeline/lib/dashboard/server.mjs': './server/',
  'packages/pipeline/lib/pipeline/engine.mjs': './engine/',
});
for (const [relativePath, facadePrefix] of Object.entries(boundedCompositionRoots)) {
  const source = read(relativePath);
  const count = importCount(source);
  if (count > 12) failures.push(`${relativePath} has ${count} imports (composition maximum 12).`);
  const leafImports = importSpecifiers(source).filter(
    (specifier) =>
      !specifier.startsWith('node:') &&
      !specifier.startsWith(facadePrefix) &&
      !['commander', 'chalk', './client-error.js', './errors.mjs'].includes(specifier),
  );
  if (leafImports.length > 0) {
    failures.push(`${relativePath} bypasses its ${facadePrefix} facade: ${leafImports.join(', ')}`);
  }
}

const cliEntry = read('packages/cli/src/cli/index.ts');
if (importCount(cliEntry) > 12)
  failures.push(`CLI composition root has ${importCount(cliEntry)} imports (maximum 12).`);
if (!cliEntry.includes("from './commands/index.js'"))
  failures.push('CLI composition root must use the command-domain facade.');
if (/from ['"]\.\/commands\/(?!index\.js)[^'"]+['"]/u.test(cliEntry))
  failures.push('CLI composition root imports a command leaf directly.');

const cliGroupRoot = resolve(root, 'packages/cli/src/cli/commands/groups');
const cliGroups = readdirSync(cliGroupRoot)
  .filter((name) => name.endsWith('.ts'))
  .sort();
const expectedGroups = [
  'delivery.ts',
  'foundation.ts',
  'intelligence.ts',
  'operations.ts',
  'planning.ts',
];
if (JSON.stringify(cliGroups) !== JSON.stringify(expectedGroups))
  failures.push('CLI command groups differ from the explicit five-group composition contract.');
for (const group of cliGroups) {
  const count = importCount(readFileSync(join(cliGroupRoot, group), 'utf8'));
  if (count > 12) failures.push(`CLI command group ${group} has ${count} imports (maximum 12).`);
}

const dashboardRoot = resolve(root, 'apps/dashboard/src');
let dashboardFiles = 0;
let dashboardMaximum = 0;
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name))) {
      dashboardFiles += 1;
      const count = importCount(readFileSync(path, 'utf8'));
      dashboardMaximum = Math.max(dashboardMaximum, count);
      if (count > 12)
        failures.push(`${path.slice(root.length + 1)} has ${count} imports (maximum 12).`);
    }
  }
}
visit(dashboardRoot);

const explicitFacadeRoots = [
  'apps/dashboard/src/app/runtime',
  'apps/dashboard/src/features/shell/routes',
  'apps/dashboard/src/features/operate/live',
  'packages/operate/lib/operate/runtime-foundation',
  'packages/pipeline/lib/operate/runtime-foundation',
  'packages/cli/src/services/operate/client',
  'packages/cli/src/cli/commands/quick',
  'packages/cli/src/cli/commands/story',
  'packages/cli/src/cli/commands/operate/registrars',
  'packages/pipeline/lib/dashboard/server',
  'packages/pipeline/lib/pipeline/engine',
];
for (const relativeRoot of explicitFacadeRoots) {
  const directory = resolve(root, relativeRoot);
  if (!existsSync(directory)) failures.push(`Missing composition facade root: ${relativeRoot}`);
  else {
    const stack = [directory];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isDirectory()) stack.push(path);
        else if (entry.isFile() && ['.js', '.mjs', '.ts', '.tsx'].includes(extname(entry.name))) {
          if (/^export\s+\*/gmu.test(readFileSync(path, 'utf8')))
            failures.push(`${path.slice(root.length + 1)} uses a wildcard barrel.`);
        }
      }
    }
  }
}

const operateRegistration = read('packages/cli/src/cli/commands/operate/registration.ts');
if (!operateRegistration.includes("from './registrars/index.js'")) {
  failures.push('Operate command public entrypoint must use the registrar facade.');
}
const operateRegistrarRoot = resolve(root, 'packages/cli/src/cli/commands/operate/registrars');
for (const entry of readdirSync(operateRegistrarRoot, { withFileTypes: true })) {
  if (!entry.isFile() || extname(entry.name) !== '.ts') continue;
  const source = readFileSync(join(operateRegistrarRoot, entry.name), 'utf8');
  const imports = importCount(source);
  const commands = (source.match(/\.command\s*\(/gu) ?? []).length;
  if (imports > 12)
    failures.push(`Operate registrar ${entry.name} has ${imports} imports (maximum 12).`);
  if (commands > 10)
    failures.push(`Operate registrar ${entry.name} declares ${commands} commands (maximum 10).`);
}

const pipelineDomains = ['po', 'dev', 'ship', 'roles', 'guided', 'investigate', 'release', 'state'];
for (const domain of pipelineDomains) {
  if (!existsSync(resolve(root, `packages/pipeline/lib/${domain}/index.mjs`)))
    failures.push(`Missing pipeline domain facade: ${domain}`);
}

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        cliEntrypointImports: importCount(cliEntry),
        cliCommandGroups: cliGroups.length,
        dashboardFiles,
        dashboardMaximumImports: dashboardMaximum,
        pipelineDomainFacades: pipelineDomains.length,
        boundedCompositionRoots: Object.keys(boundedCompositionRoots).length,
        operateRegistrarFiles: readdirSync(operateRegistrarRoot).filter((name) =>
          name.endsWith('.ts'),
        ).length,
        wildcardBarrels: 0,
        productionSourceRoots: productionSourceRoots.length,
      },
      null,
      2,
    )}\n`,
  );
}
