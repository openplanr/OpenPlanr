import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRecentCommits, verifyGitHubRepo } from '../../src/services/github-service.js';

let bin: string;

/** Put a `gh` stand-in first on PATH; it answers a command by the first prefix it starts with. */
function fakeGh(responses: Record<string, string>): void {
  const script = join(bin, 'gh');
  writeFileSync(
    script,
    `#!${process.execPath}
const responses = ${JSON.stringify(responses)};
const command = process.argv.slice(2).join(' ');
const key = Object.keys(responses).find((prefix) => command.startsWith(prefix));
if (key === undefined) {
  process.stderr.write('unexpected gh ' + command);
  process.exit(1);
}
process.stdout.write(responses[key]);
`,
  );
  chmodSync(script, 0o755);
}

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), 'openplanr-fake-gh-'));
  vi.stubEnv('PATH', `${bin}${delimiter}${process.env.PATH ?? ''}`);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(bin, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('gh output is validated where it is parsed', () => {
  it('names the command and the field when gh returns an unexpected shape', async () => {
    fakeGh({ 'auth status': '', 'repo view': '{"nameWithOwner":5}' });
    await expect(verifyGitHubRepo()).rejects.toThrow(
      'gh repo view has an unexpected shape: nameWithOwner: Invalid input: expected string, received number',
    );
  });

  it('reports an unexpected commits payload as a warning that names the issue', async () => {
    fakeGh({
      'auth status': '',
      'repo view': '{"nameWithOwner":"acme/app"}',
      'api repos/': '{"message":"Not Found"}',
    });
    const result = await fetchRecentCommits({ days: 7, limit: 5 });
    expect(result.commits).toEqual([]);
    expect(result.warning).toMatch(
      /^Could not load commits: gh api repos\/\{owner\}\/\{repo\}\/commits\?per_page=5&since=\S+ has an unexpected shape: \(root\): Invalid input: expected array, received object$/u,
    );
  });

  it('accepts a commit whose GitHub author is null', async () => {
    fakeGh({
      'auth status': '',
      'repo view': '{"nameWithOwner":"acme/app"}',
      'api repos/': JSON.stringify([
        {
          sha: 'abcdef1234567',
          commit: { message: 'fix: guard\n\nbody', author: { date: '2026-09-27T00:00:00Z' } },
          author: null,
          html_url: 'https://github.com/acme/app/commit/abcdef1',
        },
      ]),
    });
    await expect(fetchRecentCommits({ days: 7, limit: 5 })).resolves.toEqual({
      commits: [
        {
          sha: 'abcdef1234567',
          shortSha: 'abcdef1',
          message: 'fix: guard',
          authorLogin: 'unknown',
          committedDate: '2026-09-27T00:00:00Z',
          url: 'https://github.com/acme/app/commit/abcdef1',
        },
      ],
    });
  });
});
