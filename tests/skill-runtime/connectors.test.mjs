import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

import {
  CONNECTION_SKILL_IDS,
  CONNECTORS_REFERENCE,
  findProductMentions,
  readConnectionsCatalog,
  renderConnectors,
  validateConnectionsCatalog,
} from '../../scripts/skills/connectors.mjs';
import { projectedSkillName } from '../../scripts/skills/host-invocations.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const catalog = readConnectionsCatalog(root);
const rendered = renderConnectors(catalog);
const packages = [
  ['claude', 'dist/plugins/claude/openplanr', (id) => `skills/${projectedSkillName(id)}`],
  ['openai', 'dist/plugins/openai/openplanr', (id) => `skills/${projectedSkillName(id)}`],
  ['cursor', 'dist/plugins/cursor/openplanr', (id) => `rules/${id}`],
];
const CREDENTIAL_ENV =
  /process\.env(?:\.|\[['"])[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY|CLIENT_ID|AUTH)/u;

function files(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Lists everything in a built package that would make it more than instructions. */
function inspectPackage(directory, { claude = false } = {}) {
  const findings = [];
  for (const file of files(directory)) {
    const path = relative(directory, file);
    const name = path.split('/').at(-1);
    if (['.mcp.json', '.app.json', '.lsp.json', 'hooks.json'].includes(name))
      findings.push(`${path}: declares a connector, hook or server`);
    const text = readFileSync(file, 'utf8');
    if (/\.json$/u.test(name)) {
      for (const key of ['mcpServers', 'apps', 'hooks', 'monitors', 'lspServers', 'userConfig'])
        if (new RegExp(`"${key}"\\s*:`, 'u').test(text)) findings.push(`${path}: declares ${key}`);
    }
    if (
      /\b(?:client_id|clientId|client_secret|clientSecret)["']?\s*[:=]\s*["'][^"'\s]+/u.test(text)
    )
      findings.push(`${path}: carries an OAuth client field`);
    if (CREDENTIAL_ENV.test(text))
      findings.push(`${path}: reads a credential from the environment`);
    if (claude && name.endsWith('.md') && /^allowed-tools:/mu.test(text.split('\n---\n')[0]))
      findings.push(`${path}: pre-approves tools`);
  }
  if (claude)
    for (const component of ['hooks', 'monitors', 'bin', 'commands'])
      if (existsSync(join(directory, component))) findings.push(`${component}/ is shipped`);
  return findings;
}

test('the catalog covers chat, project tracker and source control with dated steps per host', () => {
  assert.deepEqual(
    catalog.categories.map(({ placeholder }) => placeholder),
    ['~~chat', '~~project tracker', '~~source control'],
  );
  for (const category of catalog.categories) {
    const section = rendered.split(`## ${category.title} (`)[1].split('\n## ')[0];
    for (const host of ['Claude Code', 'Codex', 'Cursor']) assert.match(section, new RegExp(host));
    assert.match(section, /Verified: .* on \d{4}-\d{2}-\d{2}/u);
  }
  assert.ok(
    catalog.categories.flatMap(({ products }) => products).some(({ use }) => use === 'sync'),
  );
});

test('the catalog rejects a product without a step for every host or a verification date', () => {
  const broken = structuredClone(catalog);
  const product = broken.categories[0].products.find(({ connect }) => connect);
  delete product.connect.cursor;
  assert.throws(() => validateConnectionsCatalog(broken), /no connect step for cursor/u);
  const undated = structuredClone(catalog);
  undated.categories[1].products[0].verifiedOn = 'recently';
  assert.throws(() => validateConnectionsCatalog(undated), /verifiedOn/u);
});

test('every package root and connection skill ships the catalog rendering byte for byte', () => {
  assert.equal(read('docs/generated/connectors.md'), rendered, 'docs copy drifted');
  for (const id of CONNECTION_SKILL_IDS)
    assert.equal(read(`skills/${id}/${CONNECTORS_REFERENCE}`), rendered, `${id} copy drifted`);
  for (const [host, pluginRoot, skillRoot] of packages) {
    assert.equal(read(`${pluginRoot}/CONNECTORS.md`), rendered, `${host} CONNECTORS.md drifted`);
    for (const id of CONNECTION_SKILL_IDS)
      assert.equal(
        read(`${pluginRoot}/${skillRoot(id)}/${CONNECTORS_REFERENCE}`),
        rendered,
        `${host} ${id} copy drifted`,
      );
  }
});

test('connection skills name categories, never a catalog product', () => {
  for (const id of CONNECTION_SKILL_IDS)
    assert.deepEqual(findProductMentions(read(`skills/${id}/SKILL.md`), catalog), [], id);
  assert.deepEqual(
    findProductMentions('Post the update to Slack and close the GitHub issue.', catalog).sort(),
    ['GitHub', 'Slack'],
  );
  assert.deepEqual(findProductMentions('Run the sync helper through the GitHub CLI.', catalog), []);
  assert.deepEqual(findProductMentions('Open a GitHub pull request.', catalog), ['GitHub']);
});

test('the tracker reference keeps sync semantics and leaves connect steps to the catalog', () => {
  const reference = read('skills/shared/tracker-connections.md');
  assert.match(reference, /## Status mapping/u);
  assert.match(reference, /`githubIssue`/u);
  assert.match(reference, /`linearIssueId`/u);
  assert.doesNotMatch(reference, /\/plugin install|codex mcp|\| Claude Code \||Marketplace/u);
  assert.doesNotMatch(reference, /Bearer|Authorization|_TOKEN|personal access token/iu);
});

test('every built host package carries instructions only', () => {
  for (const [host, pluginRoot] of packages)
    assert.deepEqual(
      inspectPackage(resolve(root, pluginRoot), { claude: host === 'claude' }),
      [],
      `${host} package`,
    );
});

test('the package inspection catches a bundled connector or credential read', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-package-inspection-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'skills/share'), { recursive: true });
  writeFileSync(
    join(directory, '.mcp.json'),
    '{"mcpServers":{"chat":{"oauth":{"clientId":"1601185624273.8899143856786"}}}}',
  );
  writeFileSync(
    join(directory, 'skills/share/post.mjs'),
    'fetch(url, { headers: { a: process.env.SLACK_TOKEN } });',
  );
  writeFileSync(
    join(directory, 'skills/share/SKILL.md'),
    '---\nname: share\nallowed-tools: Bash\n---\n',
  );
  assert.deepEqual(inspectPackage(directory, { claude: true }).sort(), [
    '.mcp.json: carries an OAuth client field',
    '.mcp.json: declares a connector, hook or server',
    '.mcp.json: declares mcpServers',
    'skills/share/SKILL.md: pre-approves tools',
    'skills/share/post.mjs: reads a credential from the environment',
  ]);
});
