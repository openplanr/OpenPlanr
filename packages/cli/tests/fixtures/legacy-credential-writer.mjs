// Another tool's read/modify/write of the legacy credentials file under the shared writer lock.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withCredentialWriteLock } from '../../lib/credential-writer.mjs';

const [key, value] = process.argv.slice(2);
const home = process.env.PLANR_HOME;
const file = join(home, 'credentials.json');
await withCredentialWriteLock(
  home,
  async () => {
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...stored, [key]: value }));
  },
  15_000,
  'legacy',
);
