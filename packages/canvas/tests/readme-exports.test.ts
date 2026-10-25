import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const entries = [
  ['.', '../src/index.d.mts'],
  ['./react', '../src/react/index.d.mts'],
  ['./testing', '../src/testing/index.d.mts'],
] as const;

it('documents exactly the built exports under each entry', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const paths = entries.map(([, path]) => fileURLToPath(new URL(path, import.meta.url)));
  const program = ts.createProgram(paths, {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const failures: string[] = [];
  for (const [entry, path] of entries) {
    const filename = fileURLToPath(new URL(path, import.meta.url));
    const source = program.getSourceFile(filename);
    if (!source) throw new Error(`Missing built declaration ${filename}; run the canvas build`);
    const symbol = checker.getSymbolAtLocation(source);
    if (!symbol) throw new Error(`No module exports found in ${filename}`);
    const exported = checker.getExportsOfModule(symbol).map((item) => item.name);
    const heading = `### \`${entry}\` exports`;
    const section = readme.split('\n').findIndex((line) => line === heading);
    if (section === -1) {
      failures.push(`${entry}: missing README heading ${heading}`);
      continue;
    }
    const lines = readme.split('\n').slice(section + 1);
    const end = lines.findIndex((line) => /^#{1,3} /u.test(line));
    const documented = (end === -1 ? lines : lines.slice(0, end)).flatMap((line) => {
      const match = /^\| `([A-Za-z_$][\w$]*)` \|/u.exec(line);
      return match ? [match[1]] : [];
    });
    for (const name of exported)
      if (!documented.includes(name)) failures.push(`${entry}: undocumented export ${name}`);
    for (const name of documented) {
      if (!exported.includes(name)) failures.push(`${entry}: README lists unexported name ${name}`);
      if (documented.indexOf(name) !== documented.lastIndexOf(name))
        failures.push(`${entry}: README lists duplicate export ${name}`);
    }
  }
  expect(failures, failures.join('\n')).toEqual([]);
});
