/** Snapshots open-license Google Fonts into a design's local font folder. */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const MAX_FAMILIES = 2;
const MAX_WEIGHTS = 3;
const TIMEOUT_MS = 20_000;
const MAX_FILE_BYTES = 1_500_000;
const MAX_TOTAL_BYTES = 5_000_000;
const CSS_ENDPOINT = 'https://fonts.googleapis.com/css2';
const FONT_ORIGIN = 'https://fonts.gstatic.com/';
const CATALOG_ROOT = 'https://raw.githubusercontent.com/google/fonts/main';
// Google Fonts serves woff2 only to user agents it recognises as modern browsers.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const LICENSES = Object.freeze([
  {
    directory: 'ofl',
    metadata: 'OFL',
    file: 'OFL.txt',
    id: 'OFL-1.1',
    text: /SIL Open Font License,?\s+Version 1\.1/iu,
  },
  {
    directory: 'apache',
    metadata: 'APACHE2',
    file: 'LICENSE.txt',
    id: 'Apache-2.0',
    text: /Apache License\s+Version 2\.0/iu,
  },
]);
const FAMILY_SPEC = /^([A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?):(\d{3}(?:,\d{3})*)$/u;

/** Parses `Name:400,600` into a family name and sorted weights. */
export function parseFontFamily(spec) {
  const match = typeof spec === 'string' ? FAMILY_SPEC.exec(spec.trim()) : null;
  if (!match)
    throw new Error(
      `--family ${JSON.stringify(spec ?? '')} must look like "Inter:400,600" (a name, a colon, comma-separated weights).`,
    );
  const weights = [...new Set(match[2].split(',').map(Number))].sort((a, b) => a - b);
  const invalid = weights.find((weight) => weight < 100 || weight > 900 || weight % 100 !== 0);
  if (invalid !== undefined)
    throw new Error(`--family "${spec}" has weight ${invalid}; use 100 to 900 in steps of 100.`);
  if (weights.length > MAX_WEIGHTS)
    throw new Error(
      `--family "${spec}" has ${weights.length} weights; at most ${MAX_WEIGHTS} per family.`,
    );
  return { family: match[1], weights };
}

/** Returns the Latin-subset woff2 faces of a Google Fonts CSS2 response. */
export function latinFontFaces(css, family) {
  const faces = [];
  for (const [, subset, body] of css.matchAll(
    /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/gu,
  )) {
    const value = (name) =>
      new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'iu').exec(body)?.[1].trim();
    if (subset !== 'latin' || !/^U\+0000-00FF\b/iu.test(value('unicode-range') ?? '')) continue;
    const source = /^url\(([^)\s]+)\)\s*format\(['"]woff2['"]\)$/u.exec(value('src') ?? '');
    if (!source?.[1].startsWith(FONT_ORIGIN))
      throw new Error(
        `"${family}" Latin face is not a woff2 file on ${FONT_ORIGIN}: ${value('src')}`,
      );
    faces.push({ weight: Number(value('font-weight')), url: source[1] });
  }
  return faces;
}

async function request(fetchImpl, url, { headers, allowMissing = false, redirect } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers,
      redirect,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const reason =
      error?.name === 'TimeoutError' ? `no response within ${TIMEOUT_MS / 1000} s` : error?.message;
    throw new Error(`Font fetch failed: ${url}: ${reason}`);
  }
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error(`Font fetch failed: ${url}: HTTP ${response.status}`);
  return response;
}

async function verifiedLicense(fetchImpl, family) {
  const slug = family.toLowerCase().replace(/[^a-z0-9]/gu, '');
  const tried = [];
  for (const license of LICENSES) {
    const base = `${CATALOG_ROOT}/${license.directory}/${slug}`;
    tried.push(`${base}/METADATA.pb`);
    const metadata = await request(fetchImpl, `${base}/METADATA.pb`, { allowMissing: true });
    if (!metadata) continue;
    const text = await metadata.text();
    const name = /^name:\s*"([^"]*)"/mu.exec(text)?.[1];
    const declared = /^license:\s*"([^"]*)"/mu.exec(text)?.[1];
    if (name !== family && name?.toLowerCase() === family.toLowerCase())
      throw new Error(`"${family}" is listed as "${name}"; use the catalog name "${name}".`);
    if (name !== family || declared !== license.metadata)
      throw new Error(
        `"${family}" is not verified as ${license.id}: ${base}/METADATA.pb names ${JSON.stringify(name)} with license ${JSON.stringify(declared)}. Use the system stack.`,
      );
    const body = Buffer.from(
      await (
        await request(fetchImpl, `${base}/${license.file}`, { redirect: 'error' })
      ).arrayBuffer(),
    );
    if (!license.text.test(body.toString('utf8')))
      throw new Error(
        `"${family}" is not verified as ${license.id}: ${base}/${license.file} does not contain the license text. Use the system stack.`,
      );
    return { slug, license, body };
  }
  throw new Error(
    `"${family}" is not an OFL or Apache licensed Google Fonts family (checked ${tried.join(', ')}). Use the system stack.`,
  );
}

async function download(fetchImpl, url) {
  const bytes = Buffer.from(
    await (await request(fetchImpl, url, { redirect: 'error' })).arrayBuffer(),
  );
  if (bytes.length > MAX_FILE_BYTES)
    throw new Error(`Font file is ${bytes.length} bytes, over the ${MAX_FILE_BYTES} limit: ${url}`);
  if (bytes.toString('latin1', 0, 4) !== 'wOF2') throw new Error(`Font file is not woff2: ${url}`);
  return bytes;
}

function assertWritableDestination(dest) {
  if (!existsSync(dest)) return;
  if (!statSync(dest).isDirectory() || readdirSync(dest).length > 0)
    throw new Error(
      `Font destination already exists and is not empty: ${dest}. Choose a new --dest or remove it.`,
    );
}

function faceRule(family, weights, file) {
  const weight = weights.length > 1 ? `${weights[0]} ${weights.at(-1)}` : `${weights[0]}`;
  return `@font-face {\n  font-family: "${family}";\n  font-style: normal;\n  font-weight: ${weight};\n  font-display: swap;\n  src: url("${file}") format("woff2");\n}\n`;
}

/**
 * Downloads Latin woff2 files and license texts, then writes `fonts.css` beside them.
 * Writes nothing unless every request succeeds; `dest` must be absent or empty.
 */
export async function fetchDesignFonts({ families, dest, fetchImpl = fetch }) {
  if (!dest) throw new Error('fonts fetch requires --dest <design>/source/assets/fonts.');
  const specs = (families ?? []).map(parseFontFamily);
  if (specs.length === 0)
    throw new Error('fonts fetch requires at least one --family "<Name>:<weights>".');
  if (specs.length > MAX_FAMILIES)
    throw new Error(
      `${specs.length} families requested (${specs.map(({ family }) => family).join(', ')}); at most ${MAX_FAMILIES}.`,
    );
  const names = specs.map(({ family }) => family.toLowerCase());
  if (new Set(names).size !== names.length)
    throw new Error(
      `--family names a family twice: ${specs.map(({ family }) => family).join(', ')}.`,
    );
  const target = resolve(dest);
  assertWritableDestination(target);

  const files = new Map();
  const rules = [];
  const summaries = [];
  let totalBytes = 0;
  const add = (path, bytes) => {
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES)
      throw new Error(`Font snapshot exceeds ${MAX_TOTAL_BYTES} bytes at ${path}.`);
    files.set(path, bytes);
  };
  for (const { family, weights } of specs) {
    const { slug, license, body } = await verifiedLicense(fetchImpl, family);
    const source = `${CSS_ENDPOINT}?family=${encodeURIComponent(family).replaceAll('%20', '+')}:wght@${weights.join(';')}&display=swap`;
    const css = await (
      await request(fetchImpl, source, { headers: { 'user-agent': USER_AGENT } })
    ).text();
    const faces = latinFontFaces(css, family);
    const byUrl = new Map();
    for (const weight of weights) {
      const face = faces.find((item) => item.weight === weight);
      if (!face)
        throw new Error(`"${family}" has no Latin woff2 face for weight ${weight} in ${source}`);
      byUrl.set(face.url, [...(byUrl.get(face.url) ?? []), weight]);
    }
    rules.push(`/* ${family} (${license.id}, ${slug}/${license.file}): ${source} */\n`);
    for (const [url, covered] of byUrl) {
      const range = covered.length > 1 ? `${covered[0]}-${covered.at(-1)}` : `${covered[0]}`;
      const file = `${slug}/${slug}-${range}-latin.woff2`;
      add(file, await download(fetchImpl, url));
      rules.push(faceRule(family, covered, file));
    }
    add(`${slug}/${license.file}`, body);
    summaries.push({
      family,
      license: license.id,
      weights,
      source,
      licenseFile: `${slug}/${license.file}`,
    });
  }
  add('fonts.css', Buffer.from(rules.join('')));

  mkdirSync(dirname(target), { recursive: true });
  const staging = mkdtempSync(join(dirname(target), '.fonts-fetch-'));
  try {
    for (const [path, bytes] of files) {
      mkdirSync(dirname(join(staging, path)), { recursive: true });
      writeFileSync(join(staging, path), bytes, { flag: 'wx' });
    }
    assertWritableDestination(target);
    if (existsSync(target)) rmdirSync(target);
    // mkdtemp creates 0700; the snapshot should get the usual folder mode.
    chmodSync(staging, 0o755);
    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return {
    ok: true,
    dest: target,
    css: join(target, 'fonts.css'),
    families: summaries,
    files: [...files].map(([path, bytes]) => ({ path, bytes: bytes.length })),
    totalBytes,
  };
}
