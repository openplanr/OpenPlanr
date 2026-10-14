import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const USES = /^\s*(?:-\s+)?uses:\s*["']?([^"'\s#]+)/u;
const PINNED = /^(?:\.\/|[^@]+@[0-9a-f]{40}$)/u;

function yamlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

test('every workflow and composite action uses a local path or a full commit SHA', () => {
  const files = ['.github/workflows', '.github/actions'].flatMap((path) =>
    yamlFiles(join(workspaceRoot, path)),
  );
  const references = files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) => {
        const match = USES.exec(line);
        return match
          ? [{ at: `${relative(workspaceRoot, file)}:${index + 1}`, ref: match[1] }]
          : [];
      }),
  );
  assert.ok(references.length > 0, 'no uses: references found under .github');
  const unpinned = references.filter(({ ref }) => !PINNED.test(ref));
  assert.deepEqual(
    unpinned.map(({ at, ref }) => `${at} ${ref}`),
    [],
    'pin each action to a 40-character commit SHA with the release tag as a trailing comment',
  );
});
