import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const FLOATING_UBUNTU = /^\s*runs-on:.*\bubuntu-latest\b/u;

function yamlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

test('no workflow or composite action runs on the floating ubuntu-latest image', () => {
  const files = ['.github/workflows', '.github/actions'].flatMap((path) =>
    yamlFiles(join(workspaceRoot, path)),
  );
  assert.ok(files.length > 0, 'no workflow files found under .github');
  const floating = files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        FLOATING_UBUNTU.test(line) ? [`${relative(workspaceRoot, file)}:${index + 1}`] : [],
      ),
  );
  assert.deepEqual(floating, [], 'pin runs-on to a versioned image such as ubuntu-24.04');
});
