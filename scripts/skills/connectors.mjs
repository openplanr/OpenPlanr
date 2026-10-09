import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const CONNECTIONS_CATALOG = 'skills/shared/connections.json';
export const CONNECTORS_REFERENCE = 'references/connectors.md';
export const CONNECTION_SKILL_IDS = Object.freeze(['planr-status', 'planr-sprint', 'planr-sync']);

const HOSTS = Object.freeze([
  ['claude-code', 'Claude Code'],
  ['codex', 'Codex'],
  ['cursor', 'Cursor'],
]);
const CATEGORIES = Object.freeze([
  ['chat', '~~chat'],
  ['project-tracker', '~~project tracker'],
  ['source-control', '~~source control'],
]);
const USES = new Map([
  ['sync', 'OpenPlanr syncs with it'],
  ['draft', 'Message drafts'],
  ['context', 'Read for context'],
]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function fail(message) {
  throw new Error(`${CONNECTIONS_CATALOG}: ${message}`);
}

function assertProduct(category, product) {
  const where = `${category.id} product ${JSON.stringify(product?.name)}`;
  if (typeof product?.name !== 'string' || product.name.trim() === '')
    fail(`${category.id} has a product without a name.`);
  if (!USES.has(product.use)) fail(`${where} has unknown use ${JSON.stringify(product.use)}.`);
  if (typeof product.docs !== 'string' || !product.docs.startsWith('https://'))
    fail(`${where} needs an https documentation link.`);
  if (!ISO_DATE.test(product.verifiedOn ?? '')) fail(`${where} needs verifiedOn as YYYY-MM-DD.`);
  for (const field of ['aliases', 'tools'])
    if (
      product[field] !== undefined &&
      (!Array.isArray(product[field]) || product[field].some((v) => typeof v !== 'string'))
    )
      fail(`${where} ${field} must be a list of names.`);
  if (product.connect === undefined) return;
  for (const [host] of HOSTS)
    if (typeof product.connect[host] !== 'string' || product.connect[host].trim() === '')
      fail(`${where} has no connect step for ${host}.`);
  const extra = Object.keys(product.connect).filter((host) => !HOSTS.some(([id]) => id === host));
  if (extra.length > 0) fail(`${where} has connect steps for unknown hosts: ${extra.join(', ')}.`);
}

/** Validates the catalog shape and returns it unchanged. */
export function validateConnectionsCatalog(catalog) {
  if (catalog?.kind !== 'openplanr-connections-catalog')
    fail('kind must be openplanr-connections-catalog.');
  const categories = catalog.categories;
  if (!Array.isArray(categories)) fail('categories must be an array.');
  const ids = categories.map(({ id, placeholder }) => [id, placeholder]);
  if (JSON.stringify(ids) !== JSON.stringify(CATEGORIES))
    fail(
      `categories must be, in order: ${CATEGORIES.map(([id, p]) => `${id} (${p})`).join(', ')}.`,
    );
  for (const category of categories) {
    for (const field of ['title', 'adds'])
      if (typeof category[field] !== 'string' || category[field].trim() === '')
        fail(`${category.id} needs ${field}.`);
    if (!Array.isArray(category.products) || category.products.length === 0)
      fail(`${category.id} needs products.`);
    for (const product of category.products) assertProduct(category, product);
    if (!category.products.some(({ connect }) => connect !== undefined))
      fail(`${category.id} needs at least one product with per-host connect steps.`);
  }
  return catalog;
}

export function readConnectionsCatalog(repoRoot) {
  return validateConnectionsCatalog(
    JSON.parse(readFileSync(resolve(repoRoot, CONNECTIONS_CATALOG), 'utf8')),
  );
}

/** Product names a connection skill may not name outside the catalog renderings. */
export function connectedProductNames(catalog) {
  return catalog.categories.flatMap(({ products }) =>
    products.flatMap(({ name, aliases = [] }) => [name, ...aliases]),
  );
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** Returns the catalog product names that appear in skill text, ignoring declared tool names. */
export function findProductMentions(markdown, catalog) {
  const tools = catalog.categories.flatMap(({ products }) =>
    products.flatMap(({ tools = [] }) => tools),
  );
  const text = tools.reduce(
    (result, tool) => result.replace(new RegExp(`\\b${escapeRegExp(tool)}\\b`, 'gu'), ''),
    String(markdown),
  );
  return [...new Set(connectedProductNames(catalog))].filter((name) =>
    new RegExp(`\\b${escapeRegExp(name)}\\b`, 'u').test(text),
  );
}

const cell = (value) => value.replaceAll('|', '\\|').replace(/\s+/gu, ' ').trim();

function renderCategory(category) {
  const connected = category.products.filter(({ connect }) => connect !== undefined);
  const others = category.products.filter(({ connect }) => connect === undefined);
  const lines = [
    `## ${category.title} (\`${category.placeholder}\`)`,
    '',
    category.adds,
    '',
    `| Product | Use | ${HOSTS.map(([, title]) => title).join(' | ')} |`,
    `| --- | --- | ${HOSTS.map(() => '---').join(' | ')} |`,
    ...connected.map(
      (product) =>
        `| ${cell(product.name)} | ${USES.get(product.use)} | ${HOSTS.map(([host]) => cell(product.connect[host])).join(' | ')} |`,
    ),
    '',
  ];
  if (others.length > 0)
    lines.push(
      `Also works with: ${others.map(({ name, docs, use }) => `[${name}](${docs}) (${USES.get(use).toLowerCase()})`).join(', ')}. Add the vendor's connector in your host the same way.`,
      '',
    );
  lines.push(
    `Verified: ${category.products.map(({ name, docs, verifiedOn }) => `[${name}](${docs}) on ${verifiedOn}`).join(', ')}.`,
    '',
  );
  return lines;
}

/** Renders CONNECTORS.md; the same bytes ship at each package root and in each connection skill. */
export function renderConnectors(catalog) {
  validateConnectionsCatalog(catalog);
  return [
    '# Connectors',
    '',
    'OpenPlanr skills name a kind of service, such as `~~chat`, instead of a product. Connect',
    'the product your team uses through your host: the vendor publishes the connector, and',
    'you sign in through the host. OpenPlanr stores no credentials and bundles no connector.',
    'Every skill also works with nothing connected and reports any remote step it skipped.',
    '',
    '| Category | Placeholder | Products |',
    '| --- | --- | --- |',
    ...catalog.categories.map(
      ({ title, placeholder, products }) =>
        `| ${title} | \`${placeholder}\` | ${products.map(({ name }) => name).join(', ')} |`,
    ),
    '',
    'Never paste a token into a chat, file or command for OpenPlanr. After you connect a',
    'service, start a new request so the host loads its tools.',
    '',
    ...catalog.categories.flatMap(renderCategory),
  ].join('\n');
}
