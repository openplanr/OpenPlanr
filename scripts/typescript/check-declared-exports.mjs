#!/usr/bin/env node
// Fails when a typed package export's declaration does not describe its module: the declared
// values differ from the runtime exports, or the declarations fail to type-check the way a
// consumer resolves them. tsconfig.declarations.json checks signatures; this checks that the
// declared surface, hand-written or compiled, is the one that ships.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Packages whose every typed export is held to its runtime module. */
export const DECLARED_EXPORT_PACKAGES = Object.freeze(['packages/artifact']);

const posix = (path) => path.split(sep).join('/');
const isTypeScriptSource = (path) => path.endsWith('.mts') && !path.endsWith('.d.mts');

function typedExports(packageRoot) {
  const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
  return Object.entries(manifest.exports ?? {})
    .filter(([, target]) => target && typeof target === 'object' && target.types && target.import)
    .map(([key, target]) => ({
      key,
      types: resolve(packageRoot, target.types),
      module: resolve(packageRoot, target.import),
    }));
}

function declarationProgram(entries) {
  const options = {
    noEmit: true,
    strict: true,
    allowJs: false,
    skipLibCheck: false,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: ['node'],
  };
  const host = ts.createCompilerHost(options);
  // Published packages carry no .mts sources, so resolve `./x.mjs` to `x.d.mts` as consumers do.
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => !isTypeScriptSource(fileName) && fileExists(fileName);
  return ts.createProgram(
    entries.map((entry) => entry.types),
    options,
    host,
  );
}

function declaredValues(checker, source) {
  const module = checker.getSymbolAtLocation(source);
  if (!module) return [];
  return checker
    .getExportsOfModule(module)
    .filter((symbol) => {
      const target =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      return (target.flags & ts.SymbolFlags.Value) !== 0;
    })
    .map((symbol) => symbol.name)
    .sort();
}

/** Return one failure message per export whose declaration and module disagree. */
export async function checkDeclaredExports({
  root = repositoryRoot,
  packages = DECLARED_EXPORT_PACKAGES,
} = {}) {
  const failures = [];
  let checked = 0;
  for (const packagePath of packages) {
    const packageRoot = resolve(root, packagePath);
    const entries = typedExports(packageRoot);
    const missing = entries
      .flatMap((entry) => [entry.types, entry.module])
      .filter((path) => !existsSync(path));
    if (missing.length > 0) {
      failures.push(
        ...missing.map(
          (path) => `${posix(relative(root, path))} is missing; run npm run generate first.`,
        ),
      );
      continue;
    }
    const program = declarationProgram(entries);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length > 0) {
      failures.push(
        `${packagePath} declarations fail as a consumer resolves them:\n${ts.formatDiagnostics(
          diagnostics,
          {
            getCanonicalFileName: (fileName) => fileName,
            getCurrentDirectory: () => root,
            getNewLine: () => '\n',
          },
        )}`,
      );
    }
    const checker = program.getTypeChecker();
    for (const entry of entries) {
      checked += 1;
      const declared = declaredValues(checker, program.getSourceFile(entry.types));
      const runtime = Object.keys(await import(pathToFileURL(entry.module).href)).sort();
      const undeclared = runtime.filter((name) => !declared.includes(name));
      const absent = declared.filter((name) => !runtime.includes(name));
      if (undeclared.length > 0 || absent.length > 0) {
        failures.push(
          `${packagePath} export ${entry.key}: ${posix(relative(root, entry.types))} ` +
            `${undeclared.length > 0 ? `omits ${undeclared.join(', ')}` : ''}` +
            `${undeclared.length > 0 && absent.length > 0 ? '; ' : ''}` +
            `${absent.length > 0 ? `declares ${absent.join(', ')}, which ${posix(relative(root, entry.module))} does not export` : ''}.`,
        );
      }
    }
  }
  return { failures, checked };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const { failures, checked } = await checkDeclaredExports();
  if (failures.length > 0) {
    process.stderr.write(`${failures.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Declared exports match their modules (${checked} package exports).\n`);
  }
}
