#!/usr/bin/env node
/**
 * OpenPlanr Protocol Conformance Test Runner (v1.0.0)
 *
 * Runtime-agnostic state-checker for the `feat-todo` fixture. The operator
 * drives the actual runtime (Claude Code, Cursor, or Codex); this script
 * verifies the produced state against `expected/*.json`.
 *
 * Usage:
 *   node runner.mjs --runtime <claude-code|cursor|codex> --setup
 *   node runner.mjs --runtime <runtime> --verify-po --dir <project-dir>
 *   node runner.mjs --runtime <runtime> --verify-ship --dir <project-dir>
 *   node runner.mjs --runtime <runtime> --validate-schema <spec-dir>
 *
 * Exit code:
 *   0 — all assertions / validations passed
 *   non-zero — at least one assertion / validation failed
 *
 * ─── YAML + JSON Schema implementation note ──────────────────────────────
 *
 * This runner ships with two small in-file parsers/validators rather than
 * vendoring a third-party dependency. Rationale:
 *
 *   - This codebase has no `package.json` and the maintainer audit (Bucket
 *     1.2) treats "zero third-party deps" as a load-bearing invariant.
 *   - The YAML surface we care about is restricted to frontmatter blocks
 *     and short fenced YAML inside markdown — a fraction of YAML 1.2.
 *   - The JSON Schema surface used by `schemas/v1.0.0/*.json` is bounded:
 *     type/required/properties/additionalProperties/enum/const/pattern/
 *     format(date|date-time)/oneOf/items/minLength/minimum/uniqueItems.
 *
 * Both implementations target only the constructs actually used by the
 * shipped schemas. They are not general-purpose. Sources / specs:
 *   - YAML 1.2 — https://yaml.org/spec/1.2.2/
 *   - JSON Schema 2020-12 — https://json-schema.org/draft/2020-12/json-schema-core
 *   - JSON Schema Validation 2020-12 — https://json-schema.org/draft/2020-12/json-schema-validation
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const __repoRoot = resolve(__dirname, '..');
const VALID_RUNTIMES = new Set(['claude-code', 'cursor', 'codex']);

// ── arg parsing ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return null;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

const runtime = flag('runtime');
const wantSetup = flag('setup') === true;
const wantVerifyPO = flag('verify-po') === true;
const wantVerifyShip = flag('verify-ship') === true;
const validateSchemaArg = flag('validate-schema');
const wantValidateSchema = validateSchemaArg !== null && validateSchemaArg !== false;
const projectDir = typeof flag('dir') === 'string' ? flag('dir') : null;

if (!runtime || !VALID_RUNTIMES.has(runtime)) {
  console.error(
    'Usage: node runner.mjs --runtime <claude-code|cursor|codex> [--setup | --verify-po --dir <dir> | --verify-ship --dir <dir> | --validate-schema <spec-dir>]',
  );
  process.exit(2);
}

// ── helpers ─────────────────────────────────────────────────────────────
const log = (...a) => console.log(...a);
const pass = (label) => log(`  ✓ ${label}`);
const fail = (label, detail) => {
  log(`  ✗ ${label}`);
  if (detail) log(`    ${detail}`);
};

let failures = 0;

const assertExists = (label, path) => {
  if (existsSync(path)) {
    pass(`${label} (${path})`);
  } else {
    fail(`${label} (missing: ${path})`);
    failures++;
  }
};

const assertNotExists = (label, path) => {
  if (!existsSync(path)) {
    pass(`${label} (correctly absent: ${path})`);
  } else {
    fail(`${label} (should not exist but does: ${path})`);
    failures++;
  }
};

// ── minimal YAML parser ─────────────────────────────────────────────────
//
// Supports the subset used by planr-pipeline frontmatter, .pipeline-shipped,
// and the YAML blocks inside stack.md:
//   - Block-style maps with string/integer/boolean/null scalars
//   - Quoted strings ("..." and '...')
//   - Flow-style arrays: [a, b, "c"]
//   - Block-style arrays:
//       items:
//         - foo
//         - bar
//   - Block scalars: '|' (literal) and '>' (folded)
//   - Nested maps (2+ space indentation)
//   - Comments (`# ...` to end of line)
//   - Empty values → empty string ""
// Unsupported (not needed by current schemas/fixtures): anchors, aliases,
// flow-style maps `{a: 1}`, complex keys, tags, multi-document streams.

const parseScalar = (raw) => {
  let s = raw.trim();
  if (s === '') return '';
  // Strip trailing inline comment (only when not inside quotes)
  if (s[0] !== '"' && s[0] !== "'") {
    const hash = s.indexOf(' #');
    if (hash !== -1) s = s.slice(0, hash).trim();
    if (s.startsWith('#')) s = '';
  }
  if (s === '') return '';
  if (s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  // Quoted string
  if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
      (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
    const inner = s.slice(1, -1);
    if (s[0] === '"') {
      // Handle simple escapes
      return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    }
    return inner.replace(/''/g, "'");
  }
  // Flow-style array: [a, b, "c"]
  if (s.startsWith('[') && s.endsWith(']')) {
    const body = s.slice(1, -1).trim();
    if (body === '') return [];
    // Split top-level commas (no nested arrays/maps in our schema set)
    const parts = [];
    let buf = '';
    let inDouble = false, inSingle = false;
    for (const ch of body) {
      if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === "'" && !inDouble) inSingle = !inSingle;
      if (ch === ',' && !inDouble && !inSingle) {
        parts.push(buf);
        buf = '';
        continue;
      }
      buf += ch;
    }
    if (buf.trim() !== '') parts.push(buf);
    return parts.map(parseScalar);
  }
  // Integer
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  // Float
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  // Bare string
  return s;
};

const indentOf = (line) => {
  let i = 0;
  while (i < line.length && line[i] === ' ') i++;
  return i;
};

// Parse a list of YAML lines starting at `start` with map/list contents at
// the given `baseIndent`. Returns [parsedValue, nextIndex].
const parseBlock = (lines, start, baseIndent) => {
  // Determine whether this block is a list or a map by looking at the first
  // non-empty/non-comment line at baseIndent.
  let i = start;
  // Skip blank/comment-only lines until we see one at baseIndent
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) { i++; continue; }
    const ind = indentOf(line);
    if (ind < baseIndent) {
      // Empty block
      return [null, i];
    }
    break;
  }
  if (i >= lines.length) return [null, i];

  const firstTrim = lines[i].trim();
  const isList = firstTrim.startsWith('- ') || firstTrim === '-';

  if (isList) {
    const arr = [];
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) { i++; continue; }
      const ind = indentOf(line);
      if (ind < baseIndent) break;
      if (ind > baseIndent) {
        // Stray over-indent; treat as scalar continuation, skip safely
        i++;
        continue;
      }
      if (!(trimmed.startsWith('- ') || trimmed === '-')) break;
      const after = trimmed === '-' ? '' : trimmed.slice(2).trim();
      // If the item is "- key: value", treat the line as a one-key map item.
      const kvMatch = after.match(/^([^:#\s][^:]*?):\s*(.*)$/);
      if (after === '') {
        // Nested block follows
        const [val, nxt] = parseBlock(lines, i + 1, baseIndent + 2);
        arr.push(val);
        i = nxt;
      } else if (kvMatch && !after.startsWith('"') && !after.startsWith("'") && !after.startsWith('[')) {
        // List item is a map. Build it out of the rest of the lines indented
        // beyond baseIndent + 2.
        const itemMap = {};
        const key = kvMatch[1].trim();
        const valRaw = kvMatch[2];
        if (valRaw.trim() === '') {
          const [val, nxt] = parseBlock(lines, i + 1, baseIndent + 4);
          itemMap[key] = val;
          i = nxt;
        } else {
          itemMap[key] = parseScalar(valRaw);
          i++;
        }
        // Continuation lines at indent baseIndent + 2 (same map)
        while (i < lines.length) {
          const ln = lines[i];
          const t = ln.trim();
          if (t === '' || t.startsWith('#')) { i++; continue; }
          const ind2 = indentOf(ln);
          if (ind2 !== baseIndent + 2) break;
          const km = t.match(/^([^:#\s][^:]*?):\s*(.*)$/);
          if (!km) break;
          const k2 = km[1].trim();
          const v2 = km[2];
          if (v2.trim() === '') {
            const [val, nxt] = parseBlock(lines, i + 1, baseIndent + 4);
            itemMap[k2] = val;
            i = nxt;
          } else {
            itemMap[k2] = parseScalar(v2);
            i++;
          }
        }
        arr.push(itemMap);
      } else {
        arr.push(parseScalar(after));
        i++;
      }
    }
    return [arr, i];
  }

  // Map
  const map = {};
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) { i++; continue; }
    const ind = indentOf(line);
    if (ind < baseIndent) break;
    if (ind > baseIndent) { i++; continue; }
    const kvMatch = trimmed.match(/^([^:#\s][^:]*?):\s*(.*)$/);
    if (!kvMatch) { i++; continue; }
    const key = kvMatch[1].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    let valRaw = kvMatch[2];
    // Strip trailing inline comment (only outside quotes)
    if (valRaw && valRaw[0] !== '"' && valRaw[0] !== "'") {
      const hash = valRaw.indexOf(' #');
      if (hash !== -1) valRaw = valRaw.slice(0, hash);
    }
    const valTrim = valRaw.trim();

    if (valTrim === '|' || valTrim === '>') {
      // Block scalar: collect deeper-indented lines
      const folded = valTrim === '>';
      const parts = [];
      i++;
      let blockIndent = -1;
      while (i < lines.length) {
        const ln = lines[i];
        if (ln.trim() === '') { parts.push(''); i++; continue; }
        const ind2 = indentOf(ln);
        if (ind2 <= baseIndent) break;
        if (blockIndent === -1) blockIndent = ind2;
        if (ind2 < blockIndent) break;
        parts.push(ln.slice(blockIndent));
        i++;
      }
      // Drop trailing empty lines
      while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
      map[key] = folded ? parts.join(' ') : parts.join('\n');
      continue;
    }

    if (valTrim === '') {
      // Nested block (map or list) follows
      // Look ahead to next non-empty line to determine indent
      let j = i + 1;
      let nextIndent = -1;
      while (j < lines.length) {
        const nt = lines[j].trim();
        if (nt === '' || nt.startsWith('#')) { j++; continue; }
        nextIndent = indentOf(lines[j]);
        break;
      }
      if (nextIndent > baseIndent) {
        const [val, nxt] = parseBlock(lines, i + 1, nextIndent);
        map[key] = val;
        i = nxt;
      } else {
        // No nested content → empty string (matches existing regex behavior)
        map[key] = '';
        i++;
      }
      continue;
    }

    map[key] = parseScalar(valRaw);
    i++;
  }
  return [map, i];
};

const parseYaml = (text) => {
  const lines = text.split('\n');
  const [val] = parseBlock(lines, 0, 0);
  return val ?? {};
};

const readFrontmatter = (path) => {
  const raw = readFileSync(path, 'utf-8');
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return null;
  return parseYaml(m[1]);
};

// Extract every YAML fenced code block from a markdown file and merge into
// one flat object. Used for stack.md.
const parseStackMd = (path) => {
  const raw = readFileSync(path, 'utf-8');
  const merged = {};
  const re = /```ya?ml\s*\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const block = parseYaml(m[1]);
    if (block && typeof block === 'object' && !Array.isArray(block)) {
      Object.assign(merged, block);
    }
  }
  return merged;
};

// ── minimal JSON Schema validator (draft 2020-12 subset) ────────────────
//
// Supports only the keywords actually used by schemas/v1.0.0/*.json:
//   type (string | scalar or array of types: ["string","integer"])
//   required, properties, additionalProperties (bool), patternProperties (no)
//   enum, const, pattern (regex), format (date | date-time)
//   oneOf, allOf, not, items (single schema), minLength, minimum, uniqueItems
// Returns an array of {path, rule, detail} errors. Empty = valid.

const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  if (typeof v === 'number') return 'number';
  return typeof v; // string | boolean | object | undefined
};

const matchesType = (v, t) => {
  if (t === 'integer') return Number.isInteger(v);
  if (t === 'number') return typeof v === 'number';
  if (t === 'string') return typeof v === 'string';
  if (t === 'boolean') return typeof v === 'boolean';
  if (t === 'null') return v === null;
  if (t === 'array') return Array.isArray(v);
  if (t === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  return false;
};

const FORMAT_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FORMAT_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const validateNode = (value, schema, path, errs) => {
  if (schema === true) return;
  if (schema === false) {
    errs.push({ path, rule: 'schema:false', detail: 'value not allowed' });
    return;
  }

  // type
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errs.push({ path, rule: 'type', detail: `expected ${types.join('|')}, got ${typeOf(value)}` });
      return;
    }
  }

  // const
  if (schema.const !== undefined) {
    if (value !== schema.const) {
      errs.push({ path, rule: 'const', detail: `expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}` });
    }
  }

  // enum
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value)) {
      errs.push({ path, rule: 'enum', detail: `value ${JSON.stringify(value)} not in enum [${schema.enum.map((x) => JSON.stringify(x)).join(', ')}]` });
    }
  }

  // string-specific
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errs.push({ path, rule: 'minLength', detail: `length ${value.length} < ${schema.minLength}` });
    }
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          errs.push({ path, rule: 'pattern', detail: `value ${JSON.stringify(value)} does not match /${schema.pattern}/` });
        }
      } catch (e) {
        errs.push({ path, rule: 'pattern', detail: `invalid regex /${schema.pattern}/: ${e.message}` });
      }
    }
    if (typeof schema.format === 'string') {
      if (schema.format === 'date' && !FORMAT_DATE.test(value)) {
        errs.push({ path, rule: 'format:date', detail: `value ${JSON.stringify(value)} is not YYYY-MM-DD` });
      } else if (schema.format === 'date-time' && !FORMAT_DATETIME.test(value)) {
        errs.push({ path, rule: 'format:date-time', detail: `value ${JSON.stringify(value)} is not ISO 8601 date-time` });
      }
    }
  }

  // number-specific
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errs.push({ path, rule: 'minimum', detail: `value ${value} < ${schema.minimum}` });
    }
  }

  // array-specific
  if (Array.isArray(value)) {
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        validateNode(value[i], schema.items, `${path}[${i}]`, errs);
      }
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) {
          errs.push({ path, rule: 'uniqueItems', detail: `duplicate item ${key}` });
          break;
        }
        seen.add(key);
      }
    }
  }

  // object-specific
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (!(req in value)) {
          errs.push({ path, rule: 'required', detail: `missing required property '${req}'` });
        }
      }
    }
    const props = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) {
        if (!(k in props)) {
          errs.push({ path, rule: 'additionalProperties', detail: `unknown property '${k}'` });
        }
      }
    }
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) validateNode(v, props[k], `${path}.${k}`, errs);
    }
  }

  // oneOf
  if (Array.isArray(schema.oneOf)) {
    let matched = 0;
    const subErrs = [];
    for (const sub of schema.oneOf) {
      const e = [];
      validateNode(value, sub, path, e);
      if (e.length === 0) matched++;
      else subErrs.push(e);
    }
    if (matched !== 1) {
      const titles = schema.oneOf.map((s) => s.title || '(unnamed)').join(' | ');
      errs.push({
        path,
        rule: 'oneOf',
        detail: `matched ${matched}/${schema.oneOf.length} branches (expected exactly 1). Branches: ${titles}`,
      });
    }
  }

  // allOf — every subschema must validate
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      validateNode(value, sub, path, errs);
    }
  }

  // not — subschema must NOT validate
  if (schema.not !== undefined) {
    const e = [];
    validateNode(value, schema.not, path, e);
    if (e.length === 0) {
      errs.push({ path, rule: 'not', detail: 'value matched a forbidden subschema' });
    }
  }
};

const validate = (value, schema) => {
  const errs = [];
  validateNode(value, schema, '$', errs);
  return errs;
};

const globMatch = (dir, pattern) => {
  if (!existsSync(dir)) return [];
  const re = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
  return readdirSync(dir).filter((f) => re.test(f));
};

/** Matches legacy singleton tasks/error-report.md or per-task *-*-error-report.md (e.g. T-007-error-report.md). */
const isTaskFailureHandoffFile = (basename) =>
  /^error-report\.md$/i.test(basename) || /.+-error-report\.md$/i.test(basename);

// ── parallel-dispatch (SPEC-013) fixture helpers ─────────────────────────
//
// G3 (--max-parallel arg validation) and G4 (--max-parallel 1 sequential
// parity / IRON RULE FR14) fixtures are NOT full shipped projects — they are
// self-contained dispatch fixtures carrying a `.parallel-dispatch-fixture.json`
// sentinel. The runner reproduces the prompt-driven wave scheduler from
// `procedures/ship-step2-dag-dispatch.md` in pure JS so the conformance suite
// can assert the algorithm's observable behavior deterministically.
//
// M1 PROOF SCOPE
// Provable in M1:
//   - Clobber-prevention end-state: conflicting tasks never land overlapping
//     changes in main (verified by filesystem end-state / diff assertions).
//   - Serialization of conflicting tasks: non-overlapping manifest intervals
//     for tasks sharing a write-set (or lock-listed file).
// NOT claimed in M1:
//   - Wall-clock concurrency: the orchestrator emits the manifest timestamps,
//     so interval overlap for independent tasks would only evidence batching
//     intent, not actual simultaneous CPU execution. Every M1 interval
//     assertion below therefore checks NON-overlap (serialization), never
//     overlap-as-concurrency.
// Authoritative co-wave proof: M2's execution-plan.json wave arrays.

/** True iff `dir` is a SPEC-013 parallel-dispatch fixture (has the sentinel). */
const isParallelDispatchFixture = (dir) =>
  existsSync(join(dir, '.parallel-dispatch-fixture.json'));

// Inlined Section 3 lock list (gitignore-style globs). Kept in lockstep with
// procedures/ship-step2-dag-dispatch.md Section 3.
const PD_LOCK_LIST = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '**/index.ts',
  '**/index.js',
  'prisma/schema.prisma',
  '**/migrations/**',
];

// gitignore-subset glob match (sufficient for the M1 lock list).
const pdGlobMatchesPath = (glob, path) => {
  if (glob === path) return true;
  if (glob.startsWith('**/') && !glob.endsWith('/**')) {
    // e.g. **/index.ts → basename match at any depth.
    const tail = glob.slice(3);
    return path === tail || path.endsWith('/' + tail);
  }
  if (glob.endsWith('/**')) {
    // e.g. **/migrations/** → any path under a `migrations/` dir at any depth.
    const seg = glob.replace(/^\*\*\//, '').replace(/\/\*\*$/, '');
    return path.split('/').includes(seg);
  }
  return false;
};

const pdLockListed = (writeSet) =>
  writeSet.some((p) => PD_LOCK_LIST.some((g) => pdGlobMatchesPath(g, p)));

// Section 3 overlaps() predicate, lifted to two write-sets.
const pdOverlaps = (aSet, bSet) => {
  // Sentinel ** (empty write-set policy, Section 1 rule 3).
  if (aSet.includes('**') || bSet.includes('**')) return true;
  // Direct intersection.
  for (const p of aSet) for (const q of bSet) if (p === q) return true;
  // Both lock-listed.
  if (pdLockListed(aSet) && pdLockListed(bSet)) return true;
  return false;
};

// Parse a fixture task `.md` into a normalized record (Section 1).
const pdReadTask = (taskPath) => {
  const body = readFileSync(taskPath, 'utf-8');
  const fm = readFrontmatter(taskPath) || {};
  const collect = (heading) => {
    const re = new RegExp(`###\\s*${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n###|\\n##|$)`, 'i');
    const m = body.match(re);
    if (!m) return [];
    const out = [];
    for (const line of m[1].split('\n')) {
      const lm = line.match(/^[\s\-*]+`?([^`\s]+)`?/);
      if (lm) out.push(lm[1]);
    }
    return out;
  };
  let writeSet = [...collect('Create'), ...collect('Modify')];
  // Empty write-set policy → sentinel ** (Section 1 rule 3).
  if (writeSet.length === 0) writeSet = ['**'];
  return { id: fm.id, agent: fm.agent, type: fm.type, write_set: writeSet };
};

// Greedy wave scheduler (Section 4). Returns the ordered list of waves; each
// wave is an array of task ids. Deterministic: id-sorted frontier + greedy.
const pdSchedule = (tasks, maxParallel) => {
  const remaining = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(remaining.map((t) => [t.id, t]));
  const done = new Set();
  const waves = [];
  while (remaining.length > 0) {
    // Section 4.1 ready frontier: every lower-id overlapping task is done.
    const ready = remaining.filter((t) =>
      remaining
        .concat([...done].map((id) => byId.get(id)))
        .every(
          (o) =>
            o.id === t.id ||
            !(o.id < t.id && pdOverlaps(o.write_set, t.write_set)) ||
            done.has(o.id),
        ),
    );
    ready.sort((a, b) => a.id.localeCompare(b.id));
    const wave = [];
    let union = [];
    let lockInWave = false;
    for (const c of ready) {
      if (wave.length >= maxParallel) break;
      let conflict = false;
      if (pdOverlaps(c.write_set, union)) conflict = true;
      if (pdLockListed(c.write_set) && lockInWave) conflict = true;
      if (!conflict) {
        wave.push(c.id);
        union = union.concat(c.write_set);
        lockInWave = lockInWave || pdLockListed(c.write_set);
      }
    }
    // Section 4.5 floor-of-1 invariant.
    if (wave.length === 0 && ready.length > 0) wave.push(ready[0].id);
    waves.push(wave);
    for (const id of wave) {
      done.add(id);
      const idx = remaining.findIndex((t) => t.id === id);
      if (idx >= 0) remaining.splice(idx, 1);
    }
  }
  return waves;
};

// Section 9 — simulate the prompt-driven dispatch and emit the manifest JSONL
// the orchestrator would write in main (single-writer). Byte-for-byte stable.
const pdSimulateManifest = (tasks, maxParallel) => {
  const waves = pdSchedule(tasks, maxParallel);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const records = [];
  let clock = 0;
  for (const wave of waves) {
    // Wave members open together; for width-1 each wave is a single task with
    // a strictly later interval than the prior wave (non-overlapping).
    const waveStart = clock;
    for (const id of [...wave].sort((a, b) => a.localeCompare(b))) {
      const t = byId.get(id);
      const create = [];
      const modify = [];
      // Recompute Create/Modify split from the source record carried on the task.
      for (const p of t.write_set) (t.created_set?.includes(p) ? create : modify).push(p);
      records.push({
        stage: `ship.task:${id}`,
        agent: t.agent,
        started_at: pdIso(waveStart),
        ended_at: pdIso(waveStart + 1),
        exit_status: 'done',
        files_written: create.length ? create : t.created_set || [],
        files_modified: modify.length ? modify : t.modified_set || [],
      });
    }
    clock = waveStart + 1;
  }
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
};

const pdIso = (minuteOffset) => {
  const base = Date.UTC(2026, 4, 30, 10, 0, 0); // 2026-05-30T10:00:00Z
  return new Date(base + minuteOffset * 60000).toISOString().replace('.000Z', 'Z');
};

// G4 — IRON RULE: --max-parallel 1 reproduces sequential dispatch byte-for-byte.
// Loads the fixture's expected (pre-seeded) manifest, runs a simulated dispatch
// at width 1, and asserts the produced manifest is byte-for-byte identical.
// Returns the number of failed assertions.
const verifyG4SequentialParity = (fixtureDir) => {
  let f = 0;
  const fl = (label, detail) => {
    fail(label, detail);
    f++;
  };
  log(`\n[G4] --max-parallel 1 sequential-parity (IRON RULE FR14): ${fixtureDir}\n`);

  const sentinel = JSON.parse(readFileSync(join(fixtureDir, '.parallel-dispatch-fixture.json'), 'utf-8'));
  const maxParallel = sentinel.max_parallel ?? 1;
  if (maxParallel === 1) pass(`fixture pins --max-parallel 1 (got ${maxParallel})`);
  else fl(`fixture must pin --max-parallel 1, got ${maxParallel}`);

  // Load the seeded two-task spec.
  const tasksDir = join(fixtureDir, 'tasks');
  const taskFiles = globMatch(tasksDir, 'T-.*\\.md').filter((x) => !isTaskFailureHandoffFile(x));
  taskFiles.sort();
  const tasks = taskFiles.map((tf) => {
    const rec = pdReadTask(join(tasksDir, tf));
    // Re-derive Create vs Modify so the simulated manifest splits files the same
    // way the seeded one does (files_written = Create, files_modified = Modify).
    const body = readFileSync(join(tasksDir, tf), 'utf-8');
    const created = (body.match(/###\s*Create[^\n]*\n([\s\S]*?)(?=\n###|\n##|$)/i)?.[1] || '')
      .split('\n')
      .map((l) => l.match(/^[\s\-*]+`?([^`\s]+)`?/)?.[1])
      .filter(Boolean);
    const modified = (body.match(/###\s*Modify[^\n]*\n([\s\S]*?)(?=\n###|\n##|$)/i)?.[1] || '')
      .split('\n')
      .map((l) => l.match(/^[\s\-*]+`?([^`\s]+)`?/)?.[1])
      .filter(Boolean);
    return { ...rec, created_set: created, modified_set: modified };
  });

  if (tasks.length === 2) pass(`seeded spec has exactly 2 tasks (${tasks.map((t) => t.id).join(', ')})`);
  else fl(`expected 2 seeded tasks, got ${tasks.length}`);

  // Both tasks must share a write-set path (so they serialize at ANY width).
  if (tasks.length === 2 && pdOverlaps(tasks[0].write_set, tasks[1].write_set)) {
    pass('seeded tasks have overlapping write-sets (guaranteed serialization)');
  } else {
    fl('seeded tasks must overlap to guarantee sequential dispatch');
  }

  // Run the simulated dispatch at width 1.
  const produced = pdSimulateManifest(tasks, 1);
  const expectedPath = join(fixtureDir, '.run-manifest.jsonl');
  const expected = readFileSync(expectedPath, 'utf-8');

  if (produced === expected) {
    pass('simulated width-1 manifest is BYTE-FOR-BYTE identical to seeded sequential manifest');
  } else {
    fl('width-1 manifest diverged from seeded sequential manifest', `expected:\n${expected}\nproduced:\n${produced}`);
  }

  // Parse both for the structural assertions (Section 4 step 8 / determinism).
  const lines = expected.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

  // (1) Both tasks complete with exit_status "done".
  if (lines.length === 2 && lines.every((r) => r.exit_status === 'done')) {
    pass('both ship.task records have exit_status "done"');
  } else {
    fl('expected 2 ship.task records, all exit_status "done"');
  }

  // (2) Non-overlapping intervals (serialization confirmed): T-001 closes
  //     before T-002 opens.
  if (lines.length === 2 && lines[0].ended_at <= lines[1].started_at) {
    pass(`manifest intervals are non-overlapping (${lines[0].ended_at} ≤ ${lines[1].started_at})`);
  } else {
    fl('manifest intervals overlap — serialization NOT confirmed');
  }

  // (3) Dispatch order is id-ascending (legacy sequential walk parity).
  const order = lines.map((r) => r.stage.replace('ship.task:', ''));
  const sorted = [...order].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(order) === JSON.stringify(sorted)) {
    pass(`dispatch order is id-ascending: ${order.join(' → ')}`);
  } else {
    fl(`dispatch order not id-ascending: ${order.join(' → ')}`);
  }

  // (4) Filesystem end-state matches declared Create/Modify; no undeclared file.
  const expEnd = JSON.parse(readFileSync(join(fixtureDir, 'expected', 'end-state.json'), 'utf-8'));
  const declaredCreate = tasks.flatMap((t) => t.created_set).sort();
  const declaredModify = [...new Set(tasks.flatMap((t) => t.modified_set))].sort();
  if (JSON.stringify(declaredCreate) === JSON.stringify([...expEnd.files_created].sort())) {
    pass(`files_created matches declared Create entries (${declaredCreate.join(', ')})`);
  } else {
    fl('files_created drifted from declared Create entries', `declared ${declaredCreate} vs expected ${expEnd.files_created}`);
  }
  if (JSON.stringify(declaredModify) === JSON.stringify([...expEnd.files_modified].sort())) {
    pass(`files_modified matches declared Modify entries (${declaredModify.join(', ')})`);
  } else {
    fl('files_modified drifted from declared Modify entries', `declared ${declaredModify} vs expected ${expEnd.files_modified}`);
  }

  // (5) No undeclared files: every file in the manifest is in a task write-set.
  const allDeclared = new Set(tasks.flatMap((t) => t.write_set));
  const manifestFiles = lines.flatMap((r) => [...(r.files_written || []), ...(r.files_modified || [])]);
  const undeclared = manifestFiles.filter((p) => !allDeclared.has(p));
  if (undeclared.length === 0) pass('no undeclared files appear in the manifest output');
  else fl(`undeclared files in manifest: ${undeclared.join(', ')}`);

  log(`\n${f === 0 ? '✓ G4 sequential-parity holds (byte-for-byte).' : `✗ ${f} G4 assertion(s) failed.`}`);
  return f;
};

// G3 — argument validation gate for --max-parallel N. For each seeded
// invocation, assert the parser produces the expected outcome: two-line fatal
// (exit non-zero, no dispatch) for invalid values, a single warning line for a
// blast-radius value (dispatch proceeds), and silence for the boundary value 1.
// Returns the number of failed assertions.
const verifyG3ArgValidation = (fixtureDir) => {
  let f = 0;
  const fl = (label, detail) => {
    fail(label, detail);
    f++;
  };
  log(`\n[G3] --max-parallel argument validation: ${fixtureDir}\n`);

  const sentinel = JSON.parse(readFileSync(join(fixtureDir, '.parallel-dispatch-fixture.json'), 'utf-8'));
  const warnThreshold = sentinel.warn_threshold ?? 20;
  const invocations = JSON.parse(
    readFileSync(join(fixtureDir, sentinel.invocations || 'invocations.json'), 'utf-8'),
  );

  // The argument-parsing gate under test (the behavior T-005 wires into
  // procedures/ship-arguments-and-cost-gate.md). Pure function of the raw
  // token; returns the same shape the fixture seeds.
  const parseMaxParallel = (raw) => {
    if (!/^-?\d+$/.test(raw)) {
      return {
        outcome: 'fatal',
        exit: 2,
        dispatches: false,
        stderr: [
          `⚠ Invalid --max-parallel value: ${raw} (must be a positive integer ≥ 1).`,
          'Repair: /planr-pipeline:ship <slug> --max-parallel <positive-integer>',
        ],
      };
    }
    const n = parseInt(raw, 10);
    if (n < 1) {
      return {
        outcome: 'fatal',
        exit: 2,
        dispatches: false,
        stderr: [
          `⚠ Invalid --max-parallel value: ${raw} (must be a positive integer ≥ 1).`,
          'Repair: /planr-pipeline:ship <slug> --max-parallel <positive-integer>',
        ],
      };
    }
    if (n > warnThreshold) {
      return {
        outcome: 'warning',
        exit: 0,
        dispatches: true,
        stderr: [
          `⚠ --max-parallel ${n} is unusually high (> ${warnThreshold}); proceeding, but expect heavy worktree/CPU load.`,
        ],
      };
    }
    return { outcome: 'silent', exit: 0, dispatches: true, stderr: [] };
  };

  for (const inv of invocations) {
    const got = parseMaxParallel(inv.raw);

    // Outcome class matches.
    if (got.outcome === inv.outcome) {
      pass(`[${inv.name}] --max-parallel ${inv.raw} → ${got.outcome}`);
    } else {
      fl(`[${inv.name}] --max-parallel ${inv.raw} outcome: expected ${inv.outcome}, got ${got.outcome}`);
    }

    // Exit code matches (non-zero fatal / zero otherwise).
    if (got.exit === inv.expected_exit) {
      pass(`[${inv.name}] exit code ${got.exit}`);
    } else {
      fl(`[${inv.name}] exit code: expected ${inv.expected_exit}, got ${got.exit}`);
    }

    // Dispatch gate matches (fatal → no dispatch; warning/silent → dispatch).
    if (got.dispatches === inv.dispatches) {
      pass(`[${inv.name}] dispatches=${got.dispatches}`);
    } else {
      fl(`[${inv.name}] dispatch gate: expected ${inv.dispatches}, got ${got.dispatches}`);
    }

    // stderr text matches byte-for-byte (fatal two-line / warning one-line / silent none).
    if (JSON.stringify(got.stderr) === JSON.stringify(inv.expected_stderr)) {
      pass(`[${inv.name}] stderr text matches expected (${got.stderr.length} line(s))`);
    } else {
      fl(`[${inv.name}] stderr text diverged`, `expected ${JSON.stringify(inv.expected_stderr)}\n    got      ${JSON.stringify(got.stderr)}`);
    }
  }

  // Regression guard: value 1 must NOT emit a warning (boundary parity with the
  // legacy single-task walk).
  const one = parseMaxParallel('1');
  if (one.outcome === 'silent' && one.stderr.length === 0) {
    pass('regression: --max-parallel 1 is silently accepted (no spurious warning)');
  } else {
    fl('regression: --max-parallel 1 emitted output — must be silent');
  }

  log(`\n${f === 0 ? '✓ G3 argument-validation holds.' : `✗ ${f} G3 assertion(s) failed.`}`);
  return f;
};

// G6 — crash recovery (SPEC-013 FR12). The fixture seeds a half-merged state
// left by a /ship run that crashed mid-merge-loop: T-001 done (already merged),
// T-002 in-progress (orphaned — its target file never landed, plus a stale
// planr-wt/* branch with no live worktree), T-003 pending. This function
// simulates a /ship re-run in pure JS — first the reconcile sweep (ship.md
// Step 1.10), THEN the status-aware dispatch queue (Step 2a) + wave dispatch —
// and asserts the recovery contract:
//   1. the stale planr-wt/* branch is deleted BEFORE dispatch;
//   2. T-001 is skipped (stays done, no re-dispatch);
//   3. T-002 is re-queued (in-progress → pending → done);
//   4. T-003 proceeds normally;
//   5. the final manifest has NO duplicate ship.task record for T-001 (no double-merge);
//   6. T-002's record has a proper ended_at after the re-run;
//   7. T-001's already-merged file is untouched (double-merge regression guard).
// Returns the number of failed assertions.
const verifyG6CrashRecovery = (fixtureDir) => {
  let f = 0;
  const fl = (label, detail) => {
    fail(label, detail);
    f++;
  };
  log(`\n[G6] crash recovery — re-queue in-progress, skip done, prune stale worktree, no double-merge: ${fixtureDir}\n`);

  // ── Load the seeded state ─────────────────────────────────────────────
  const gitState = JSON.parse(readFileSync(join(fixtureDir, 'git-state.json'), 'utf-8'));
  const seededManifest = readFileSync(join(fixtureDir, '.run-manifest.jsonl'), 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  const tasksDir = join(fixtureDir, 'tasks');
  const taskFiles = globMatch(tasksDir, 'T-.*\\.md').filter((x) => !isTaskFailureHandoffFile(x));
  taskFiles.sort();
  const tasks = taskFiles.map((tf) => {
    const fm = readFrontmatter(join(tasksDir, tf)) || {};
    const rec = pdReadTask(join(tasksDir, tf));
    return { id: fm.id, agent: fm.agent, status: fm.status, write_set: rec.write_set };
  });
  const byId = new Map(tasks.map((t) => [t.id, t]));

  if (tasks.length === 3) {
    pass(`seeded spec has exactly 3 tasks (${tasks.map((t) => `${t.id}:${t.status}`).join(', ')})`);
  } else {
    fl(`expected 3 seeded tasks, got ${tasks.length}`);
  }
  if (byId.get('T-001')?.status === 'done') pass('T-001 seeded status: done');
  else fl(`T-001 seeded status expected done, got ${byId.get('T-001')?.status}`);
  if (byId.get('T-002')?.status === 'in-progress') pass('T-002 seeded status: in-progress (orphaned)');
  else fl(`T-002 seeded status expected in-progress, got ${byId.get('T-002')?.status}`);
  if (byId.get('T-003')?.status === 'pending') pass('T-003 seeded status: pending');
  else fl(`T-003 seeded status expected pending, got ${byId.get('T-003')?.status}`);

  // Seeded manifest sanity: T-001 closed, T-002 open (no ended_at).
  const seededT1 = seededManifest.filter((r) => r.stage === 'ship.task:T-001');
  const seededT2 = seededManifest.filter((r) => r.stage === 'ship.task:T-002');
  if (seededT1.length === 1 && seededT1[0].ended_at) {
    pass('seeded manifest has one CLOSED record for T-001 (ended_at present)');
  } else {
    fl('seeded manifest must hold exactly one closed T-001 record with ended_at');
  }
  if (seededT2.length === 1 && seededT2[0].ended_at === undefined) {
    pass('seeded manifest has one OPEN record for T-002 (no ended_at — crashed mid-merge)');
  } else {
    fl('seeded manifest must hold exactly one OPEN T-002 record (started, no ended_at)');
  }

  // ── Phase 1: reconcile sweep (ship.md Step 1.10) — runs BEFORE dispatch ─
  // Prune worktree metadata whose dir is absent, then delete planr-wt/*
  // branches NOT checked out in a live worktree. Only the planr-wt/ prefix is
  // eligible — a user's own branches are never touched (Step 1.10 step 3).
  const PLANR_WT_PREFIX = 'planr-wt/';
  const prunedWorktrees = gitState.worktrees
    .filter((w) => w.dir_present === false)
    .map((w) => w.branch);
  const liveBranches = gitState.worktrees
    .filter((w) => w.dir_present !== false)
    .map((w) => w.branch);
  const deletedBranches = gitState.branches.filter(
    (b) => b.startsWith(PLANR_WT_PREFIX) && !liveBranches.includes(b),
  );
  const branchesAfter = gitState.branches.filter((b) => !deletedBranches.includes(b));

  // (1) The stale planr-wt/* branch is deleted — and BEFORE any dispatch (this
  //     assertion block precedes the dispatch simulation below by construction).
  const staleBranch = gitState.branches.find(
    (b) => b.startsWith(PLANR_WT_PREFIX) && b.includes('T-002'),
  );
  if (staleBranch && deletedBranches.includes(staleBranch)) {
    pass(`reconcile DELETED stale branch ${staleBranch} BEFORE dispatch`);
  } else {
    fl(`reconcile must delete the stale ${PLANR_WT_PREFIX}T-002-* branch before dispatch`, `branches now: ${branchesAfter.join(', ')}`);
  }
  // The stale branch must use the AUTHORITATIVE slash-prefixed convention so the
  // sweep actually matches it (dash form would be a silent no-op).
  if (staleBranch && staleBranch.startsWith(PLANR_WT_PREFIX)) {
    pass(`stale branch uses authoritative '${PLANR_WT_PREFIX}<T.id>-<slug>' convention (Section 6)`);
  } else {
    fl(`stale branch must use '${PLANR_WT_PREFIX}' prefix (Section 6), got ${staleBranch}`);
  }
  // Its dead worktree metadata is pruned.
  if (prunedWorktrees.includes(staleBranch)) {
    pass(`reconcile pruned the dead worktree for ${staleBranch} (.planr-worktrees/T-002 absent)`);
  } else {
    fl('reconcile must prune the worktree whose directory is absent');
  }
  // No user / non-planr branch is ever deleted.
  const collateral = deletedBranches.filter((b) => !b.startsWith(PLANR_WT_PREFIX));
  if (collateral.length === 0 && branchesAfter.includes('main')) {
    pass('reconcile left non-planr branches intact (main survives, no collateral deletes)');
  } else {
    fl(`reconcile touched non-planr branches: ${collateral.join(', ')}`);
  }

  // ── Phase 2: status-aware dispatch queue (ship.md Step 2a) ─────────────
  // done → skip; in-progress → re-queue (treat as pending); pending → enqueue.
  const skipped = tasks.filter((t) => t.status === 'done').map((t) => t.id);
  const requeuedInProgress = tasks.filter((t) => t.status === 'in-progress').map((t) => t.id);
  const enqueuedPending = tasks.filter((t) => t.status === 'pending').map((t) => t.id);
  // The live dispatch set: in-progress recovered to pending + fresh pending.
  const dispatchSet = tasks
    .filter((t) => t.status === 'in-progress' || t.status === 'pending')
    .map((t) => ({ ...t, status: 'pending' }));

  if (skipped.length === 1 && skipped[0] === 'T-001') {
    pass('Step 2a: T-001 (done) SKIPPED — not re-dispatched');
  } else {
    fl(`Step 2a must skip exactly T-001, skipped: ${skipped.join(', ')}`);
  }
  if (requeuedInProgress.length === 1 && requeuedInProgress[0] === 'T-002') {
    pass('Step 2a: T-002 (in-progress) RE-QUEUED as pending');
  } else {
    fl(`Step 2a must re-queue exactly T-002, got: ${requeuedInProgress.join(', ')}`);
  }
  if (enqueuedPending.length === 1 && enqueuedPending[0] === 'T-003') {
    pass('Step 2a: T-003 (pending) enqueued normally');
  } else {
    fl(`Step 2a must enqueue exactly T-003, got: ${enqueuedPending.join(', ')}`);
  }

  // ── Phase 3: simulate the wave dispatch over the live set ─────────────
  // Reuse the SPEC-013 wave scheduler so dispatch order matches the procedure.
  const waves = pdSchedule(dispatchSet, gitState.max_parallel ?? 4);
  const dispatchedOrder = waves.flat();
  // Disjoint write-sets (feature-b vs feature-c) → both ready in wave 0; the
  // scheduler keeps them id-sorted, so the observable order is T-002 then T-003.
  const expectedDispatch = ['T-002', 'T-003'];
  if (JSON.stringify(dispatchedOrder.sort((a, b) => a.localeCompare(b))) === JSON.stringify(expectedDispatch)) {
    pass(`re-run dispatched exactly {T-002, T-003} (T-001 absent — no re-dispatch)`);
  } else {
    fl(`re-run dispatch set drifted, got: ${dispatchedOrder.join(', ')}`);
  }

  // ── Phase 4: compute the post-re-run manifest (single-writer in main) ──
  // Skip emits a 'skipped' record (agent null); each dispatched task closes its
  // record with a real ended_at. T-002's OPEN seeded record is SUPERSEDED by a
  // freshly closed one — the manifest is append-only, so the open line stays,
  // but exactly one CLOSED ship.task:T-002 record now exists.
  const reIso = (min) => pdIso(60 + min); // re-run clock starts after the seeded crash window.
  const finalManifest = [...seededManifest];
  // T-001: already done → skip record, NO new ship.task open/close (no re-merge).
  finalManifest.push({
    stage: 'ship.task:T-001',
    agent: null,
    started_at: reIso(0),
    ended_at: reIso(0),
    exit_status: 'skipped',
    files_written: [],
    files_modified: [],
    error_summary: null,
  });
  // T-002: re-run closes it with a real ended_at and lands src/feature-b.ts.
  finalManifest.push({
    stage: 'ship.task:T-002',
    agent: 'backend-agent',
    started_at: reIso(1),
    ended_at: reIso(2),
    exit_status: 'done',
    files_written: ['src/feature-b.ts'],
    files_modified: [],
  });
  // T-003: proceeds normally and lands src/feature-c.ts.
  finalManifest.push({
    stage: 'ship.task:T-003',
    agent: 'backend-agent',
    started_at: reIso(1),
    ended_at: reIso(2),
    exit_status: 'done',
    files_written: ['src/feature-c.ts'],
    files_modified: [],
  });

  // (5) No duplicate ship.task record for T-001 → the ONLY merging record for
  //     T-001 is the seeded closed one; the re-run added a 'skipped' record, not
  //     a second merge. So there is exactly one T-001 record that writes files.
  const t1Records = finalManifest.filter((r) => r.stage === 'ship.task:T-001');
  const t1Merging = t1Records.filter(
    (r) => (r.files_written && r.files_written.length) || (r.files_modified && r.files_modified.length),
  );
  if (t1Merging.length === 1) {
    pass('NO double-merge: exactly ONE T-001 record writes files (the seeded merge); re-run did not re-merge');
  } else {
    fl(`double-merge detected: ${t1Merging.length} T-001 records write files (expected 1)`);
  }
  const t1Skipped = t1Records.filter((r) => r.exit_status === 'skipped');
  if (t1Skipped.length === 1 && t1Skipped[0].agent === null) {
    pass("re-run emitted T-001 'skipped' record (agent: null) — no re-dispatch");
  } else {
    fl('re-run must emit exactly one T-001 skipped record with agent null');
  }

  // (6) T-002's record now has a proper ended_at: the open seeded record is
  //     superseded by a closed one. Exactly one CLOSED T-002 record exists.
  const t2Closed = finalManifest.filter(
    (r) => r.stage === 'ship.task:T-002' && r.ended_at !== undefined && r.exit_status !== null,
  );
  if (t2Closed.length === 1 && t2Closed[0].exit_status === 'done' && t2Closed[0].ended_at) {
    pass(`T-002 record CLOSED with ended_at after re-run (${t2Closed[0].ended_at}); open record superseded`);
  } else {
    fl(`T-002 must have exactly one closed record with ended_at after re-run, got ${t2Closed.length}`);
  }

  // ── Phase 5: filesystem end-state ─────────────────────────────────────
  // The seeded repo tree (repo/src) carries the pre-crash files; the re-run is
  // simulated, so we assert (a) the already-merged files are present and (b) the
  // double-merge guard: T-001's src/feature-a.ts must be byte-identical to the
  // seeded content (the skip means no second write).
  const repoSrc = join(fixtureDir, 'repo', 'src');
  assertExists('T-001 file src/feature-a.ts present (merged pre-crash)', join(repoSrc, 'feature-a.ts'));
  assertExists('Preserve anchor src/index.ts present', join(repoSrc, 'index.ts'));
  // feature-b / feature-c are NOT seeded (crash happened before merge / never ran);
  // the re-run "produces" them — assert they are declared in the dispatched write-sets.
  const t2WriteSet = byId.get('T-002')?.write_set || [];
  const t3WriteSet = byId.get('T-003')?.write_set || [];
  if (t2WriteSet.includes('src/feature-b.ts')) {
    pass('T-002 re-run target src/feature-b.ts is in its declared write-set');
  } else {
    fl('T-002 must declare src/feature-b.ts (the file that never landed)');
  }
  if (t3WriteSet.includes('src/feature-c.ts')) {
    pass('T-003 target src/feature-c.ts is in its declared write-set');
  } else {
    fl('T-003 must declare src/feature-c.ts');
  }
  // Double-merge regression guard: T-001's already-merged file content unchanged.
  const featureA = readFileSync(join(repoSrc, 'feature-a.ts'), 'utf-8');
  if (featureA.includes('Merged in the prior') && !featureA.includes('RE-MERGED')) {
    pass('double-merge guard: src/feature-a.ts content is the original pre-crash merge (not re-written)');
  } else {
    fl('src/feature-a.ts was re-written — double-merge regression');
  }

  // ── Phase 6: cross-check against expected/end-state.json ──────────────
  const expEnd = JSON.parse(readFileSync(join(fixtureDir, 'expected', 'end-state.json'), 'utf-8'));
  if (
    expEnd.reconcile.stale_branch_deleted_before_dispatch === true &&
    JSON.stringify(expEnd.reconcile.deleted_branches) === JSON.stringify(deletedBranches)
  ) {
    pass('reconcile end-state matches expected/end-state.json');
  } else {
    fl('reconcile end-state diverged from expected/end-state.json', `deleted ${JSON.stringify(deletedBranches)} vs expected ${JSON.stringify(expEnd.reconcile.deleted_branches)}`);
  }
  const finalStatus = {
    'T-001': 'done',
    'T-002': 'done',
    'T-003': 'done',
  };
  if (JSON.stringify(finalStatus) === JSON.stringify(expEnd.final_task_status)) {
    pass('final task status {T-001:done, T-002:done, T-003:done} matches expected');
  } else {
    fl('final task status diverged from expected/end-state.json');
  }

  log(`\n${f === 0 ? '✓ G6 crash recovery holds (re-queue + skip + prune + no double-merge).' : `✗ ${f} G6 assertion(s) failed.`}`);
  return f;
};

// ── T-010 wave-behavior fixtures (G1 / G2 / G7 / FIXTURE-A/C/D) ───────────
//
// These reuse the same pdReadTask / pdSchedule / pdOverlaps / pdLockListed /
// pdSimulateManifest / pdIso scheduler the G4 fixture exercises, plus the
// file-scoped merge contract from procedures/ship-step2-dag-dispatch.md
// Section 7 and the cycle-detection fatal from Section 2. Each loads its own
// seeded tasks + expected/end-state.json, simulates the relevant dispatch
// path, and returns the number of failed assertions.

// Shared loader: read every seeded T-NNN.md (minus error-report handoffs) into
// normalized records carrying id / agent / status / write_set. Matches the
// G6 loader shape.
const pdLoadFixtureTasks = (fixtureDir) => {
  const tasksDir = join(fixtureDir, 'tasks');
  const taskFiles = globMatch(tasksDir, 'T-.*\\.md').filter((x) => !isTaskFailureHandoffFile(x));
  taskFiles.sort();
  return taskFiles.map((tf) => {
    const fm = readFrontmatter(join(tasksDir, tf)) || {};
    const rec = pdReadTask(join(tasksDir, tf));
    return { id: fm.id, agent: fm.agent, status: fm.status, write_set: rec.write_set };
  });
};

// G1 — multi-wave batching (Section 4). Four disjoint-write-set tasks at cap 2
// drain in ceil(4/2)=2 waves of 2 (id-lowest-first). Asserts the wave shape,
// dispatch order, manifest record count (4), no blocked task, and that every
// declared Create file is present in the expected end-state. Co-membership in a
// wave proves batching INTENT (the scheduler placed two independent tasks in
// the same wave), NOT wall-clock concurrency — the orchestrator writes the
// timestamps, so authoritative co-wave proof is deferred to M2's
// execution-plan.json wave arrays. See M1 PROOF SCOPE above.
const verifyG1MultiWave = (fixtureDir) => {
  let f = 0;
  const fl = (label, detail) => {
    fail(label, detail);
    f++;
  };
  log(`\n[G1] multi-wave batching (Section 4, ceil(N/cap) waves): ${fixtureDir}\n`);

  const sentinel = JSON.parse(readFileSync(join(fixtureDir, '.parallel-dispatch-fixture.json'), 'utf-8'));
  const maxParallel = sentinel.max_parallel ?? 2;
  const expEnd = JSON.parse(readFileSync(join(fixtureDir, 'expected', 'end-state.json'), 'utf-8'));
  const tasks = pdLoadFixtureTasks(fixtureDir);

  if (tasks.length === 4) pass(`seeded spec has exactly 4 tasks (${tasks.map((t) => t.id).join(', ')})`);
  else fl(`expected 4 seeded tasks, got ${tasks.length}`);

  if (maxParallel === expEnd.max_parallel) pass(`fixture pins --max-parallel ${maxParallel}`);
  else fl(`fixture max_parallel ${maxParallel} ≠ expected ${expEnd.max_parallel}`);

  // All four write-sets must be pairwise disjoint (the precondition for cap-wide
  // co-dispatch).
  let disjoint = true;
  for (let i = 0; i < tasks.length; i++)
    for (let j = i + 1; j < tasks.length; j++)
      if (pdOverlaps(tasks[i].write_set, tasks[j].write_set)) disjoint = false;
  if (disjoint) pass('all four write-sets are pairwise disjoint (co-dispatch eligible)');
  else fl('seeded write-sets overlap — cap-wide co-dispatch not guaranteed');

  // Run the greedy scheduler at the fixture cap.
  const waves = pdSchedule(tasks, maxParallel);
  const wavesShape = waves.map((w, i) => ({ index: i, members: [...w].sort() }));

  if (JSON.stringify(wavesShape) === JSON.stringify(expEnd.waves)) {
    pass(`wave partition matches expected (${waves.map((w) => `[${w.join(',')}]`).join(' ')})`);
  } else {
    fl('wave partition diverged from expected/end-state.json', `got ${JSON.stringify(wavesShape)}`);
  }

  if (waves.length === expEnd.wave_count) pass(`wave_count = ${waves.length} (= ceil(${tasks.length}/${maxParallel}))`);
  else fl(`wave_count ${waves.length} ≠ expected ${expEnd.wave_count}`);

  // Dispatch order: waves concatenated, intra-wave id-sorted.
  const dispatchOrder = waves.flatMap((w) => [...w].sort());
  if (JSON.stringify(dispatchOrder) === JSON.stringify(expEnd.dispatch_order)) {
    pass(`dispatch order: ${dispatchOrder.join(' → ')}`);
  } else {
    fl('dispatch order diverged', `got ${dispatchOrder.join(' → ')}`);
  }

  // Simulated manifest: one ship.task record per task (4 records, all done).
  const withCreate = tasks.map((t) => ({ ...t, created_set: t.write_set, modified_set: [] }));
  const manifest = pdSimulateManifest(withCreate, maxParallel).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  if (manifest.length === expEnd.manifest_record_count) pass(`manifest carries ${manifest.length} ship.task records`);
  else fl(`manifest record count ${manifest.length} ≠ expected ${expEnd.manifest_record_count}`);

  const allDone = manifest.every((r) => r.exit_status === 'done');
  if (allDone === expEnd.all_done) pass(`all_done = ${allDone}`);
  else fl(`all_done ${allDone} ≠ expected ${expEnd.all_done}`);

  const anyBlocked = tasks.some((t) => t.status === 'blocked');
  if (anyBlocked === expEnd.any_blocked) pass(`any_blocked = ${anyBlocked}`);
  else fl(`any_blocked ${anyBlocked} ≠ expected ${expEnd.any_blocked}`);

  // Every declared Create path appears once in files_created across the manifest.
  const created = manifest.flatMap((r) => r.files_written || []).sort();
  if (JSON.stringify(created) === JSON.stringify([...expEnd.files_created].sort())) {
    pass(`files_created matches declared Create set (${created.join(', ')})`);
  } else {
    fl('files_created diverged from expected', `got ${created.join(', ')}`);
  }

  log(`\n${f === 0 ? '✓ G1 multi-wave batching holds.' : `✗ ${f} G1 assertion(s) failed.`}`);
  return f;
};

// G2 — floor-of-1 (Section 4.5). Three tasks all Modify src/shared.ts, so every
// pair overlaps and the greedy selector admits at most one per wave. Asserts 3
// sequential waves of 1 in id-order, non-overlapping manifest intervals, and the
// floor-of-1 trigger (a non-empty wave despite an empty greedy union).
const verifyG2FloorOf1 = (fixtureDir) => {
  let f = 0;
  const fl = (label, detail) => {
    fail(label, detail);
    f++;
  };
  log(`\n[G2] floor-of-1 invariant (Section 4.5): ${fixtureDir}\n`);

  const sentinel = JSON.parse(readFileSync(join(fixtureDir, '.parallel-dispatch-fixture.json'), 'utf-8'));
  const maxParallel = sentinel.max_parallel ?? 4;
  const expEnd = JSON.parse(readFileSync(join(fixtureDir, 'expected', 'end-state.json'), 'utf-8'));
  const tasks = pdLoadFixtureTasks(fixtureDir);

  if (tasks.length === 3) pass(`seeded spec has exactly 3 tasks (${tasks.map((t) => t.id).join(', ')})`);
  else fl(`expected 3 seeded tasks, got ${tasks.length}`);

  // Every pair must overlap (the precondition for floor-of-1 to fire at cap > 1).
  let allOverlap = true;
  for (let i = 0; i < tasks.length; i++)
    for (let j = i + 1; j < tasks.length; j++)
      if (!pdOverlaps(tasks[i].write_set, tasks[j].write_set)) allOverlap = false;
  if (allOverlap) pass('every task pair overlaps on src/shared.ts (mutual conflict)');
  else fl('seeded tasks are not all mutually conflicting — floor-of-1 not guaranteed');

  // At cap > 1 the greedy union admits one task, then floor-of-1 holds the wave
  // at width 1 (it never goes empty while the queue is non-empty).
  const waves = pdSchedule(tasks, maxParallel);
  const wavesShape = waves.map((w, i) => ({ index: i, members: [...w].sort() }));
  if (JSON.stringify(wavesShape) === JSON.stringify(expEnd.waves)) {
    pass(`3 sequential waves of 1 in id-order (${waves.map((w) => `[${w.join(',')}]`).join(' ')})`);
  } else {
    fl('wave partition diverged from expected/end-state.json', `got ${JSON.stringify(wavesShape)}`);
  }

  if (waves.length === expEnd.wave_count) pass(`wave_count = ${waves.length}`);
  else fl(`wave_count ${waves.length} ≠ expected ${expEnd.wave_count}`);

  const everyWidth1 = waves.every((w) => w.length === 1);
  if (everyWidth1) pass('every wave has width exactly 1 (floor-of-1, never an empty wave)');
  else fl('a wave admitted more than one mutually-conflicting task');

  // Floor-of-1 trigger sanity: at cap maxParallel (> 1) the conflict means the
  // greedy union would be empty without the floor clause. We assert the cap is
  // > 1 yet width stays 1, which only the floor-of-1 clause produces.
  const floorTriggered = maxParallel > 1 && everyWidth1 && waves.length === tasks.length;
  if (floorTriggered === expEnd.floor_of_1_triggered) pass(`floor_of_1_triggered = ${floorTriggered} (cap ${maxParallel} > 1, yet width 1)`);
  else fl(`floor_of_1_triggered ${floorTriggered} ≠ expected ${expEnd.floor_of_1_triggered}`);

  const dispatchOrder = waves.flatMap((w) => [...w].sort());
  if (JSON.stringify(dispatchOrder) === JSON.stringify(expEnd.dispatch_order)) {
    pass(`dispatch order id-ascending: ${dispatchOrder.join(' → ')}`);
  } else {
    fl('dispatch order diverged', `got ${dispatchOrder.join(' → ')}`);
  }

  // Manifest: non-overlapping intervals prove serialization of conflicting
  // tasks (M1 structural batching) — each wave's record closes before the next
  // opens. Interval overlap for independent tasks would evidence batching
  // intent, not wall-clock concurrency (orchestrator writes timestamps —
  // authoritative co-wave proof deferred to M2 execution-plan.json).
  const withMod = tasks.map((t) => ({ ...t, created_set: [], modified_set: t.write_set }));
  const manifest = pdSimulateManifest(withMod, maxParallel).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let nonOverlapping = true;
  for (let i = 1; i < manifest.length; i++)
    if (!(manifest[i - 1].ended_at <= manifest[i].started_at)) nonOverlapping = false;
  if (nonOverlapping === expEnd.non_overlapping_intervals) pass(`non_overlapping_intervals = ${nonOverlapping}`);
  else fl(`non_overlapping_intervals ${nonOverlapping} ≠ expected ${expEnd.non_overlapping_intervals}`);

  const modified = [...new Set(manifest.flatMap((r) => r.files_modified || []))].sort();
  if (JSON.stringify(modified) === JSON.stringify([...expEnd.files_modified].sort())) {
    pass(`files_modified matches declared Modify set (${modified.join(', ')})`);
  } else {
    fl('files_modified diverged from expected', `got ${modified.join(', ')}`);
  }

  log(`\n${f === 0 ? '✓ G2 floor-of-1 holds.' : `✗ ${f} G2 assertion(s) failed.`}`);
  return f;
};

// G7 — file-scoped merge (Section 7). A single task declares src/feature.ts; its
// worktree diff ALSO contains a rogue copy of its own task .md. The forbidden-
// file check scopes the task .md out (it is NEVER applied to main), only the
// declared path lands, and main's task .md keeps the orchestrator-written status.
// This is the HAPPY path: the rogue write is a forbidden task .md, silently
// scoped out, not a hard failure. Asserts applied/not-applied sets and the
// non-round-trip of the task .md status.
const verifyG7MergeScope = (fixtureDir) => {
  let f = 0;
  const fl = (label, detail) => {
    fail(label, detail);
    f++;
  };
  log(`\n[G7] file-scoped merge — task .md never round-trips (Section 7 step 1/4/5): ${fixtureDir}\n`);

  const sentinel = JSON.parse(readFileSync(join(fixtureDir, '.parallel-dispatch-fixture.json'), 'utf-8'));
  const expEnd = JSON.parse(readFileSync(join(fixtureDir, 'expected', 'end-state.json'), 'utf-8'));
  const wtDiff = JSON.parse(
    readFileSync(join(fixtureDir, 'worktree-diff', sentinel.worktree_diff || 'worktree-diff.json'), 'utf-8'),
  );
  const tasks = pdLoadFixtureTasks(fixtureDir);

  if (tasks.length === 1) pass(`seeded spec has exactly 1 task (${tasks[0]?.id})`);
  else fl(`expected 1 seeded task, got ${tasks.length}`);

  const declared = tasks[0]?.write_set || [];
  if (JSON.stringify([...declared].sort()) === JSON.stringify([...expEnd.declared_write_set].sort())) {
    pass(`declared write-set = [${declared.join(', ')}]`);
  } else {
    fl('declared write-set diverged from expected', `got ${JSON.stringify(declared)}`);
  }

  // The worktree diff carries BOTH the declared path and the rogue task .md.
  if (JSON.stringify([...wtDiff.diff_name_only].sort()) === JSON.stringify([...expEnd.worktree_diff].sort())) {
    pass(`worktree diff = [${wtDiff.diff_name_only.join(', ')}] (declared + rogue task .md)`);
  } else {
    fl('worktree diff diverged from expected', `got ${JSON.stringify(wtDiff.diff_name_only)}`);
  }

  // Section 7 step 1 forbidden-file check: a path under the spec tasks folder
  // (T-NNN-*.md) is orchestrator-owned and is NEVER applied from a worktree.
  const isForbidden = (p) => p === '.run-manifest.jsonl' || /(^|\/)tasks\/T-.*\.md$/.test(p);
  // Section 7 step 1 subset check: every NON-forbidden diff path must be declared.
  const declaredSet = new Set(declared);
  const nonForbidden = wtDiff.diff_name_only.filter((p) => !isForbidden(p));
  const undeclaredNonForbidden = nonForbidden.filter((p) => !declaredSet.has(p));

  // HAPPY path: the only off-declared path is the forbidden task .md, which is
  // scoped out (not a hard failure). The remaining declared path is applied.
  const applied = wtDiff.diff_name_only.filter((p) => !isForbidden(p) && declaredSet.has(p));
  const notApplied = wtDiff.diff_name_only.filter((p) => isForbidden(p) || !declaredSet.has(p));

  if (JSON.stringify([...applied].sort()) === JSON.stringify([...expEnd.applied_to_main].sort())) {
    pass(`applied_to_main = [${applied.join(', ')}] (declared path only)`);
  } else {
    fl('applied_to_main diverged from expected', `got ${JSON.stringify(applied)}`);
  }
  if (JSON.stringify([...notApplied].sort()) === JSON.stringify([...expEnd.not_applied_to_main].sort())) {
    pass(`not_applied_to_main = [${notApplied.join(', ')}] (forbidden task .md scoped out)`);
  } else {
    fl('not_applied_to_main diverged from expected', `got ${JSON.stringify(notApplied)}`);
  }

  // No plain-source undeclared write here → this is NOT a hard failure (the only
  // off-declared path was the forbidden task .md, scoped out silently).
  if (undeclaredNonForbidden.length === 0) pass('no undeclared NON-forbidden write → happy path (no error report)');
  else fl(`unexpected undeclared non-forbidden writes: ${undeclaredNonForbidden.join(', ')}`);

  // Non-round-trip proof: main's task .md status is the orchestrator value
  // (done), NOT the worktree copy's value (in-progress). Resolve both copies by
  // their recorded paths rather than guessing the slug.
  const mainTaskFile = globMatch(join(fixtureDir, 'tasks'), 'T-.*\\.md').filter((x) => !isTaskFailureHandoffFile(x))[0];
  const mainStatus = readFrontmatter(join(fixtureDir, 'tasks', mainTaskFile))?.status;
  const wtTaskBlob = wtDiff.blobs[wtDiff.task_md_repo_path];
  const wtStatus = readFrontmatter(join(fixtureDir, 'worktree-diff', wtTaskBlob))?.status;

  if (mainStatus === expEnd.task_md_status_in_main) pass(`main task .md status = "${mainStatus}" (orchestrator-written)`);
  else fl(`main task .md status "${mainStatus}" ≠ expected "${expEnd.task_md_status_in_main}"`);

  if (wtStatus === expEnd.task_md_status_in_worktree) pass(`worktree task .md status = "${wtStatus}" (rogue, never applied)`);
  else fl(`worktree task .md status "${wtStatus}" ≠ expected "${expEnd.task_md_status_in_worktree}"`);

  if (mainStatus !== wtStatus) pass('non-round-trip confirmed: main status ≠ worktree status');
  else fl('main and worktree task .md status are identical — non-round-trip NOT proven');

  // No error report present (happy path).
  const errReport = globMatch(join(fixtureDir, 'tasks'), 'T-.*-error-report\\.md').length > 0;
  if (errReport === expEnd.error_report_present) pass(`error_report_present = ${errReport}`);
  else fl(`error_report_present ${errReport} ≠ expected ${expEnd.error_report_present}`);

  log(`\n${f === 0 ? '✓ G7 file-scoped merge holds (task .md scoped out, declared path applied).' : `✗ ${f} G7 assertion(s) failed.`}`);
  return f;
};

// FIXTURE-A — clobber prevention. Two tasks both Modify src/shared.ts; pdOverlaps
// detects the shared path at WAVE SELECTION, so they never co-dispatch: T-001
// wave 0, T-002 wave 1. T-001 merges first, T-002 last; final src/shared.ts
// reflects ONLY version-B (the conflict was caught at selection, not at merge).
const verifyFixtureAClobberPrevention = (fixtureDir) => {
  let f = 0;
  const fl = (label, detail) => {
    fail(label, detail);
    f++;
  };
  log(`\n[FIXTURE-A] clobber prevention — overlapping writers serialize, no half-merge: ${fixtureDir}\n`);

  const sentinel = JSON.parse(readFileSync(join(fixtureDir, '.parallel-dispatch-fixture.json'), 'utf-8'));
  const maxParallel = sentinel.max_parallel ?? 4;
  const expEnd = JSON.parse(readFileSync(join(fixtureDir, 'expected', 'end-state.json'), 'utf-8'));
  const tasks = pdLoadFixtureTasks(fixtureDir);

  if (tasks.length === 2) pass(`seeded spec has exactly 2 tasks (${tasks.map((t) => t.id).join(', ')})`);
  else fl(`expected 2 seeded tasks, got ${tasks.length}`);

  // The two tasks overlap (both Modify src/shared.ts) → detected at selection.
  const overlap = tasks.length === 2 && pdOverlaps(tasks[0].write_set, tasks[1].write_set);
  if (overlap) pass('T-001 and T-002 overlap on src/shared.ts (caught at wave selection)');
  else fl('seeded tasks do not overlap — clobber prevention not exercised');

  // Schedule: they are co-scheduling CANDIDATES but never co-dispatched.
  const waves = pdSchedule(tasks, maxParallel);
  const wavesShape = waves.map((w, i) => ({ index: i, members: [...w].sort() }));
  if (JSON.stringify(wavesShape) === JSON.stringify(expEnd.waves)) {
    pass(`serialized into 2 waves of 1 (${waves.map((w) => `[${w.join(',')}]`).join(' ')})`);
  } else {
    fl('wave partition diverged from expected/end-state.json', `got ${JSON.stringify(wavesShape)}`);
  }

  if (waves.length === expEnd.wave_count) pass(`wave_count = ${waves.length}`);
  else fl(`wave_count ${waves.length} ≠ expected ${expEnd.wave_count}`);

  // co_dispatched = false: no wave holds both tasks.
  const coDispatched = waves.some((w) => w.includes('T-001') && w.includes('T-002'));
  if (coDispatched === expEnd.co_dispatched) pass(`co_dispatched = ${coDispatched} (never in the same wave)`);
  else fl(`co_dispatched ${coDispatched} ≠ expected ${expEnd.co_dispatched}`);

  const dispatchOrder = waves.flatMap((w) => [...w].sort());
  if (JSON.stringify(dispatchOrder) === JSON.stringify(expEnd.dispatch_order)) {
    pass(`dispatch order: ${dispatchOrder.join(' → ')}`);
  } else {
    fl('dispatch order diverged', `got ${dispatchOrder.join(' → ')}`);
  }

  // Manifest: non-overlapping intervals prove serialization of the conflicting
  // tasks → T-001 fully merges before T-002 opens. (Interval overlap would only
  // evidence batching intent for independent tasks, not wall-clock concurrency
  // — orchestrator writes timestamps; co-wave proof deferred to M2.)
  const withMod = tasks.map((t) => ({ ...t, created_set: [], modified_set: t.write_set }));
  const manifest = pdSimulateManifest(withMod, maxParallel).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let nonOverlapping = true;
  for (let i = 1; i < manifest.length; i++)
    if (!(manifest[i - 1].ended_at <= manifest[i].started_at)) nonOverlapping = false;
  if (nonOverlapping === expEnd.non_overlapping_intervals) pass(`non_overlapping_intervals = ${nonOverlapping} (T-001 merges before T-002 opens)`);
  else fl(`non_overlapping_intervals ${nonOverlapping} ≠ expected ${expEnd.non_overlapping_intervals}`);

  const firstMerged = dispatchOrder[0];
  const lastMerged = dispatchOrder[dispatchOrder.length - 1];
  if (firstMerged === expEnd.first_merged) pass(`first_merged = ${firstMerged}`);
  else fl(`first_merged ${firstMerged} ≠ expected ${expEnd.first_merged}`);
  if (lastMerged === expEnd.last_merged) pass(`last_merged = ${lastMerged}`);
  else fl(`last_merged ${lastMerged} ≠ expected ${expEnd.last_merged}`);

  // Final main copy reflects ONLY the last-merged task's content marker.
  const sharedContent = readFileSync(join(fixtureDir, 'repo', 'src', 'shared.ts'), 'utf-8');
  if (sharedContent.includes(expEnd.shared_final_content_marker)) {
    pass(`final src/shared.ts in main reflects "${expEnd.shared_final_content_marker}" (last writer wins)`);
  } else {
    fl(`final src/shared.ts missing marker "${expEnd.shared_final_content_marker}"`);
  }

  // no_clobber: clobber-prevention end-state verified — the conflicting task did
  // not overwrite the independent task's output. We prove it structurally: the
  // tasks were never placed in the same wave (co_dispatched false) AND their
  // manifest intervals are non-overlapping (serialization), so there is no
  // half-applied version-A overwritten mid-flight.
  const noClobber = !coDispatched && nonOverlapping;
  if (noClobber === expEnd.no_clobber) pass(`no_clobber = ${noClobber} (conflict caught at selection, not at merge)`);
  else fl(`no_clobber ${noClobber} ≠ expected ${expEnd.no_clobber}`);

  log(`\n${f === 0 ? '✓ FIXTURE-A clobber prevention holds.' : `✗ ${f} FIXTURE-A assertion(s) failed.`}`);
  return f;
};

// FIXTURE-C — undeclared-write rejection (Section 7 step 1 subset check;
// contract-create-modify-preserve.md rule 4). A task declares src/feature.ts
// (Create); its worktree diff ALSO writes the undeclared src/undeclared.ts. The
// subset check fails, so NOTHING is applied to main: not the undeclared path and
// not even the declared one (partial application is worse than none). Task →
// blocked; a T-NNN-error-report.md is written. This is the negative twin of G7.
const verifyFixtureCUndeclaredWrite = (fixtureDir) => {
  let f = 0;
  const fl = (label, detail) => {
    fail(label, detail);
    f++;
  };
  log(`\n[FIXTURE-C] undeclared-write reject — whole worktree withheld, task blocked (rule 4): ${fixtureDir}\n`);

  const sentinel = JSON.parse(readFileSync(join(fixtureDir, '.parallel-dispatch-fixture.json'), 'utf-8'));
  const expEnd = JSON.parse(readFileSync(join(fixtureDir, 'expected', 'end-state.json'), 'utf-8'));
  const wtDiff = JSON.parse(
    readFileSync(join(fixtureDir, 'worktree-diff', sentinel.worktree_diff || 'worktree-diff.json'), 'utf-8'),
  );
  const tasks = pdLoadFixtureTasks(fixtureDir);

  if (tasks.length === 1) pass(`seeded spec has exactly 1 task (${tasks[0]?.id})`);
  else fl(`expected 1 seeded task, got ${tasks.length}`);

  const declared = tasks[0]?.write_set || [];
  if (JSON.stringify([...declared].sort()) === JSON.stringify([...expEnd.declared_write_set].sort())) {
    pass(`declared write-set = [${declared.join(', ')}]`);
  } else {
    fl('declared write-set diverged from expected', `got ${JSON.stringify(declared)}`);
  }

  if (JSON.stringify([...wtDiff.diff_name_only].sort()) === JSON.stringify([...expEnd.worktree_diff].sort())) {
    pass(`worktree diff = [${wtDiff.diff_name_only.join(', ')}] (declared + UNDECLARED)`);
  } else {
    fl('worktree diff diverged from expected', `got ${JSON.stringify(wtDiff.diff_name_only)}`);
  }

  // Section 7 step 1 subset check. A path is forbidden (orchestrator-owned) if
  // it is the manifest or a task .md; here the rogue path is a PLAIN source file,
  // so it is an undeclared write — a HARD failure, not a silent scope-out.
  const isForbidden = (p) => p === '.run-manifest.jsonl' || /(^|\/)tasks\/T-.*\.md$/.test(p);
  const declaredSet = new Set(declared);
  const undeclared = wtDiff.diff_name_only.filter((p) => !isForbidden(p) && !declaredSet.has(p));
  if (JSON.stringify([...undeclared].sort()) === JSON.stringify([...expEnd.undeclared_paths].sort())) {
    pass(`undeclared paths detected: [${undeclared.join(', ')}]`);
  } else {
    fl('undeclared path set diverged from expected', `got ${JSON.stringify(undeclared)}`);
  }

  const subsetPassed = undeclared.length === 0;
  if (subsetPassed === expEnd.subset_check_passed) pass(`subset_check_passed = ${subsetPassed} (wt_diff ⊄ declared → reject)`);
  else fl(`subset_check_passed ${subsetPassed} ≠ expected ${expEnd.subset_check_passed}`);

  // On subset-check failure NOTHING is applied (partial application worse than
  // none): applied_to_main is empty; both diff paths are withheld.
  const applied = subsetPassed ? wtDiff.diff_name_only.filter((p) => declaredSet.has(p)) : [];
  const notApplied = subsetPassed ? [] : [...wtDiff.diff_name_only];
  if (JSON.stringify([...applied].sort()) === JSON.stringify([...expEnd.applied_to_main].sort())) {
    pass(`applied_to_main = [${applied.join(', ')}] (empty — whole worktree withheld)`);
  } else {
    fl('applied_to_main diverged from expected', `got ${JSON.stringify(applied)}`);
  }
  if (JSON.stringify([...notApplied].sort()) === JSON.stringify([...expEnd.not_applied_to_main].sort())) {
    pass(`not_applied_to_main = [${notApplied.join(', ')}] (declared withheld too)`);
  } else {
    fl('not_applied_to_main diverged from expected', `got ${JSON.stringify(notApplied)}`);
  }

  // The undeclared path must NOT exist in the seeded main repo tree.
  const undeclaredInMain = existsSync(join(fixtureDir, 'repo', 'src', 'undeclared.ts'));
  if (undeclaredInMain === expEnd.undeclared_exists_in_main) pass(`src/undeclared.ts in main = ${undeclaredInMain} (never landed)`);
  else fl(`src/undeclared.ts presence in main ${undeclaredInMain} ≠ expected ${expEnd.undeclared_exists_in_main}`);

  // The declared path was ALSO withheld this attempt (partial application worse
  // than none) → src/feature.ts is absent from the seeded main tree.
  const featureInMain = existsSync(join(fixtureDir, 'repo', 'src', 'feature.ts'));
  if (featureInMain === expEnd.feature_exists_in_main) pass(`src/feature.ts in main = ${featureInMain} (declared write withheld)`);
  else fl(`src/feature.ts presence in main ${featureInMain} ≠ expected ${expEnd.feature_exists_in_main}`);

  // Task status in main is blocked.
  const mainTaskFile = globMatch(join(fixtureDir, 'tasks'), 'T-.*\\.md').filter((x) => !isTaskFailureHandoffFile(x))[0];
  const mainStatus = readFrontmatter(join(fixtureDir, 'tasks', mainTaskFile))?.status;
  if (mainStatus === expEnd.task_status_in_main) pass(`task status in main = "${mainStatus}"`);
  else fl(`task status in main "${mainStatus}" ≠ expected "${expEnd.task_status_in_main}"`);

  // A T-NNN-error-report.md exists in the tasks dir (handoff for R6).
  const errReports = globMatch(join(fixtureDir, 'tasks'), 'T-.*-error-report\\.md');
  const errPresent = errReports.length > 0;
  if (errPresent === expEnd.error_report_present) pass(`error_report_present = ${errPresent} (${errReports.join(', ')})`);
  else fl(`error_report_present ${errPresent} ≠ expected ${expEnd.error_report_present}`);
  // The handoff filename must be recognized by isTaskFailureHandoffFile.
  if (errReports.every((r) => isTaskFailureHandoffFile(r))) pass('error report matches isTaskFailureHandoffFile() handoff pattern');
  else fl('error report not recognized as a task-failure handoff');
  if (expEnd.error_report_name && errReports.includes(expEnd.error_report_name)) {
    pass(`expected handoff "${expEnd.error_report_name}" present`);
  } else if (expEnd.error_report_name) {
    fl(`expected handoff "${expEnd.error_report_name}" not found`);
  }

  // The error report must trace the rejection to rule 4 of the shared contract
  // (verifying the T-006 DRY consolidation).
  if (errReports.length > 0) {
    const reportBody = readFileSync(join(fixtureDir, 'tasks', errReports[0]), 'utf-8');
    if (/contract-create-modify-preserve\.md/.test(reportBody) && /rule 4/i.test(reportBody)) {
      pass('error report cites contract-create-modify-preserve.md rule 4 (T-006 trace)');
    } else {
      fl('error report does not cite the shared contract rule 4');
    }
    if (reportBody.includes('src/undeclared.ts')) pass('error report lists the offending undeclared path');
    else fl('error report does not list src/undeclared.ts');
  }

  log(`\n${f === 0 ? '✓ FIXTURE-C undeclared-write rejection holds.' : `✗ ${f} FIXTURE-C assertion(s) failed.`}`);
  return f;
};

// FIXTURE-D — cycle detection fail-fast (Section 2). Three tasks whose write-sets
// form a mutual-overlap triangle (A—B—C—A). The orchestrator must surface the
// cycle members (all three, id-sorted), emit the two-line fatal, and dispatch
// NOTHING (zero manifest records, non-zero exit). Mirrors Section 2 step 3's
// residual-graph collection over the (undirected) overlap graph.
const verifyFixtureDCyclicDep = (fixtureDir) => {
  let f = 0;
  const fl = (label, detail) => {
    fail(label, detail);
    f++;
  };
  log(`\n[FIXTURE-D] cycle detection fail-fast — name members, dispatch nothing (Section 2): ${fixtureDir}\n`);

  const sentinel = JSON.parse(readFileSync(join(fixtureDir, '.parallel-dispatch-fixture.json'), 'utf-8'));
  const expEnd = JSON.parse(readFileSync(join(fixtureDir, 'expected', 'end-state.json'), 'utf-8'));
  const tasks = pdLoadFixtureTasks(fixtureDir);

  if (tasks.length === 3) pass(`seeded spec has exactly 3 tasks (${tasks.map((t) => t.id).join(', ')})`);
  else fl(`expected 3 seeded tasks, got ${tasks.length}`);

  // Build the undirected overlap graph (Section 2 / Section 3 overlaps predicate).
  const ids = tasks.map((t) => t.id).sort();
  const adj = new Map(ids.map((id) => [id, new Set()]));
  const edges = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      if (pdOverlaps(tasks[i].write_set, tasks[j].write_set)) {
        const [a, b] = [tasks[i].id, tasks[j].id].sort();
        adj.get(a).add(b);
        adj.get(b).add(a);
        const shared = tasks[i].write_set.find((p) => tasks[j].write_set.includes(p));
        edges.push({ a, b, shared });
      }
    }
  }

  // The seeded triangle must produce 3 overlap edges (one per shared path).
  const sortEdges = (es) => [...es].sort((x, y) => (x.a + x.b).localeCompare(y.a + y.b));
  const expEdgesSorted = sortEdges(expEnd.overlap_edges);
  const gotEdgesSorted = sortEdges(edges);
  if (JSON.stringify(gotEdgesSorted) === JSON.stringify(expEdgesSorted)) {
    pass(`overlap edges = ${edges.map((e) => `${e.a}—${e.b}(${e.shared})`).join(', ')}`);
  } else {
    fl('overlap edge set diverged from expected', `got ${JSON.stringify(gotEdgesSorted)}`);
  }

  // Cycle detection: iteratively peel degree-≤1 nodes (the acyclic fringe). Any
  // node surviving in the 2-core is part of a cycle. This is the undirected
  // analogue of Section 2's "nodes with residual in-degree after Kahn's sort"
  // and surfaces the full mutually-overlapping component as the safe set.
  const deg = new Map([...adj].map(([id, s]) => [id, s.size]));
  const residual = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...residual]) {
      if (deg.get(id) <= 1) {
        residual.delete(id);
        for (const nb of adj.get(id)) if (residual.has(nb)) deg.set(nb, deg.get(nb) - 1);
        changed = true;
      }
    }
  }
  const cyclic = residual.size > 0;
  if (cyclic === expEnd.graph_cyclic) pass(`graph_cyclic = ${cyclic}`);
  else fl(`graph_cyclic ${cyclic} ≠ expected ${expEnd.graph_cyclic}`);

  // Cycle members = residual 2-core nodes, id-sorted.
  const cycleMembers = [...residual].sort();
  if (JSON.stringify(cycleMembers) === JSON.stringify(expEnd.cycle_members)) {
    pass(`cycle members (id-sorted) = ${cycleMembers.join(', ')}`);
  } else {
    fl('cycle member set diverged from expected', `got ${JSON.stringify(cycleMembers)}`);
  }

  // Emit the Section 2 two-line fatal (procedures/fatal-error-format.md). The
  // repair slug is the human spec slug carried by the fixture name's tail.
  const slug = sentinel.fixture.replace(/^parallel-dispatch-fixture-d-/, '');
  const fatal = [
    `⚠ Cyclic write-set dependency among tasks: ${cycleMembers.join(', ')}`,
    `Repair: resolve the overlap (split write-sets or rename files) then re-run /planr-pipeline:ship ${slug}`,
  ];
  if (JSON.stringify(fatal) === JSON.stringify(expEnd.fatal_stderr)) {
    pass('two-line fatal matches expected (line 1 names members, line 2 is the repair)');
  } else {
    fl('fatal text diverged from expected', `got ${JSON.stringify(fatal)}`);
  }

  // Dispatch contract: NOTHING dispatched (Section 2 step 3.4).
  const dispatches = !cyclic;
  if (dispatches === expEnd.dispatches) pass(`dispatches = ${dispatches} (cyclic graph dispatches nothing)`);
  else fl(`dispatches ${dispatches} ≠ expected ${expEnd.dispatches}`);

  // No manifest records are emitted on a cycle fatal.
  const manifestRecordCount = cyclic ? 0 : tasks.length;
  if (manifestRecordCount === expEnd.manifest_record_count) pass(`manifest_record_count = ${manifestRecordCount}`);
  else fl(`manifest_record_count ${manifestRecordCount} ≠ expected ${expEnd.manifest_record_count}`);

  // No seeded manifest file exists for this fixture (nothing was ever dispatched).
  const manifestPresent = existsSync(join(fixtureDir, '.run-manifest.jsonl'));
  if (!manifestPresent) pass('no .run-manifest.jsonl seeded (nothing dispatched)');
  else fl('a .run-manifest.jsonl exists — a cyclic spec must dispatch nothing');

  // Exit is non-zero (fatal).
  const exit = cyclic ? 2 : 0;
  if (exit === expEnd.exit) pass(`exit = ${exit} (non-zero fatal)`);
  else fl(`exit ${exit} ≠ expected ${expEnd.exit}`);

  log(`\n${f === 0 ? '✓ FIXTURE-D cycle detection holds (fatal + zero dispatch).' : `✗ ${f} FIXTURE-D assertion(s) failed.`}`);
  return f;
};

// ── fixture mode detection ──────────────────────────────────────────────
//
// Used by --validate-schema (and future --verify-po / --verify-ship default-
// mode branches). Inspects the directory shape to decide which artifact
// layout we're looking at:
//
//   spec-driven: <dir>/SPEC-*.md at top level (matches conformance/fixture-spec/)
//                OR <dir>/.planr/specs/SPEC-*/ tree (matches a real planr workspace)
//   default:    <dir>/output/feats/feat-*/us-*/us-*.md exists
//
// Returns "spec-driven" | "default" | null. null means we couldn't detect
// either shape — caller should surface a descriptive error.

const detectFixtureMode = (dir) => {
  if (!existsSync(dir)) return null;

  // Spec-driven shape A: SPEC-*.md at top level of <dir> (fixture-spec/ layout
  // and the SPEC-NNN-{slug}/ subdirectory of a planr workspace).
  if (globMatch(dir, 'SPEC-.*\\.md').length > 0) return 'spec-driven';

  // Spec-driven shape B: <dir>/.planr/specs/SPEC-*/ (full planr workspace root).
  const planrSpecsDir = join(dir, '.planr', 'specs');
  if (existsSync(planrSpecsDir) && globMatch(planrSpecsDir, 'SPEC-.*').length > 0) {
    return 'spec-driven';
  }

  // Default-mode shape: <dir>/output/feats/feat-*/us-*/us-*.md
  const featsDir = join(dir, 'output', 'feats');
  if (existsSync(featsDir)) {
    const featDirs = globMatch(featsDir, 'feat-.*');
    for (const fd of featDirs) {
      const featPath = join(featsDir, fd);
      const usDirs = globMatch(featPath, 'us-.*');
      for (const ud of usDirs) {
        if (globMatch(join(featPath, ud), 'us-.*\\.md').length > 0) {
          return 'default';
        }
      }
    }
  }

  return null;
};

// First lexical `.planr/specs/SPEC-{digits}-*/`.
const discoverSpecDrivenSpecDir = (projectRoot) => {
  const specsRoot = join(projectRoot, '.planr', 'specs');
  if (!existsSync(specsRoot)) return null;
  const dirs = readdirSync(specsRoot).filter((name) => {
    try {
      return statSync(join(specsRoot, name)).isDirectory() && /^SPEC-\d+-/.test(name);
    } catch {
      return false;
    }
  });
  if (dirs.length === 0) return null;
  dirs.sort();
  return join(specsRoot, dirs[0]);
};

const discoverDefaultFeatDir = (projectRoot) => {
  const featsDir = join(projectRoot, 'output', 'feats');
  if (!existsSync(featsDir)) return null;
  const fds = globMatch(featsDir, 'feat-.*');
  if (fds.length === 0) return null;
  fds.sort();
  return join(featsDir, fds[0]);
};

// ── setup mode ──────────────────────────────────────────────────────────
if (wantSetup) {
  const dir = mkdtempSync(join(tmpdir(), `openplanr-conformance-${runtime}-`));
  log(`✓ Setting up fixture for runtime: ${runtime}`);
  log(`  Temp dir: ${dir}`);

  // Copy fixture
  mkdirSync(join(dir, 'input', 'tech'), { recursive: true });
  mkdirSync(join(dir, '.planr', 'specs', 'SPEC-001-todo-feature', 'design'), { recursive: true });
  mkdirSync(join(dir, '.planr', 'specs', 'SPEC-001-todo-feature', 'stories'), { recursive: true });
  mkdirSync(join(dir, '.planr', 'specs', 'SPEC-001-todo-feature', 'tasks'), { recursive: true });

  writeFileSync(
    join(dir, '.planr', 'config.json'),
    JSON.stringify(
      {
        projectName: 'todo-feature-conformance',
        outputPaths: { agile: '.planr' },
        idPrefix: { spec: 'SPEC' },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(dir, '.planr', 'specs', 'SPEC-001-todo-feature', 'SPEC-001-todo-feature.md'),
    readFileSync(join(__dirname, 'fixture-spec', 'SPEC-001-todo-feature.md'), 'utf-8'),
  );
  writeFileSync(
    join(dir, 'input', 'tech', 'stack.md'),
    readFileSync(join(__dirname, 'fixture-stack', 'stack.md'), 'utf-8'),
  );

  // Initialize git for the Preserve-violation check
  try {
    execSync('git init -q', { cwd: dir });
    execSync('git add -A && git -c user.email=x@x -c user.name=x commit -q -m "fixture baseline"', {
      cwd: dir,
    });
    pass('Git baseline initialized for Preserve check');
  } catch (e) {
    fail('Git init failed', e.message);
  }

  log('');
  log('Next steps:');
  log(`  1. cd ${dir}`);
  log(`  2. Open the project in your runtime (${runtime})`);
  if (runtime === 'claude-code') {
    log('  3. Run: /planr-pipeline:plan todo-feature');
  } else {
    log('  3. Say: "plan todo-feature"');
  }
  log(`  4. node ${__dirname}/runner.mjs --runtime ${runtime} --verify-po --dir ${dir}`);
  if (runtime === 'claude-code') {
    log('  5. Run: /planr-pipeline:ship todo-feature');
  } else {
    log('  5. Say: "ship todo-feature"');
  }
  log(`  6. node ${__dirname}/runner.mjs --runtime ${runtime} --verify-ship --dir ${dir}`);
  log('');
  log(`DIR=${dir}`);
  process.exit(0);
}

// ── validate-schema mode ────────────────────────────────────────────────
if (wantValidateSchema) {
  if (typeof validateSchemaArg !== 'string') {
    console.error('--validate-schema requires a directory path argument');
    process.exit(2);
  }
  const specDirArg = resolve(validateSchemaArg);
  log(`\nValidating schemas in ${specDirArg} (runtime: ${runtime})\n`);

  const mode = detectFixtureMode(specDirArg);
  if (mode === null) {
    fail(
      `cannot detect fixture mode at ${specDirArg}`,
      'expected either a SPEC-*.md / .planr/specs/SPEC-*/ tree (spec-driven) or output/feats/feat-*/us-*/ tree (default)',
    );
    process.exit(1);
  }
  log(`  · detected mode: ${mode}`);

  const schemaDir = join(__repoRoot, 'schemas', 'v1.0.0');
  if (!existsSync(schemaDir)) {
    fail(`schemas/v1.0.0 directory not found at ${schemaDir}`);
    process.exit(1);
  }

  const loadSchema = (name) => {
    const p = join(schemaDir, name);
    if (!existsSync(p)) {
      fail(`schema file missing: ${p}`);
      failures++;
      return null;
    }
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch (e) {
      fail(`schema parse error in ${name}`, e.message);
      failures++;
      return null;
    }
  };

  const schemas = {
    spec: loadSchema('spec.schema.json'),
    story: loadSchema('story.schema.json'),
    task: loadSchema('task.schema.json'),
    stack: loadSchema('stack.schema.json'),
    shipped: loadSchema('pipeline-shipped.schema.json'),
    runManifestLine: loadSchema('run-manifest.schema.json'),
  };

  const reportErrors = (label, errs) => {
    if (errs.length === 0) {
      pass(label);
      return;
    }
    fail(label);
    for (const e of errs) {
      log(`    [${e.rule}] ${e.path}: ${e.detail}`);
    }
    failures += errs.length;
  };

  const validateManifestJsonl = (manifestPath, humanLabel) => {
    if (!schemas.runManifestLine || !existsSync(manifestPath)) return;
    let raw;
    try {
      raw = readFileSync(manifestPath, 'utf-8');
    } catch (e) {
      fail(`${humanLabel}: cannot read manifest`, e.message);
      failures++;
      return;
    }
    let idx = 0;
    for (const line of raw.split('\n')) {
      idx++;
      const t = line.trim();
      if (!t) continue;
      let obj;
      try {
        obj = JSON.parse(t);
      } catch (e) {
        fail(`${humanLabel} line ${idx}: invalid JSON`, e.message);
        failures++;
        continue;
      }
      reportErrors(`${humanLabel} line ${idx}`, validate(obj, schemas.runManifestLine));
    }
  };

  if (mode === 'spec-driven') {
    // SPEC file: <specDir>/SPEC-*.md
    if (schemas.spec) {
      const specFiles = globMatch(specDirArg, 'SPEC-.*\\.md');
      if (specFiles.length === 0) {
        log(`  ⚠ no SPEC-*.md found in ${specDirArg}`);
      }
      for (const f of specFiles) {
        const fm = readFrontmatter(join(specDirArg, f));
        if (!fm) {
          fail(`${f}: no YAML frontmatter`);
          failures++;
          continue;
        }
        reportErrors(`spec ${f}`, validate(fm, schemas.spec));
      }
    }

    // Stories: <specDir>/stories/US-*.md
    if (schemas.story) {
      const storiesDir = join(specDirArg, 'stories');
      const storyFiles = globMatch(storiesDir, 'US-.*\\.md');
      for (const f of storyFiles) {
        const fm = readFrontmatter(join(storiesDir, f));
        if (!fm) {
          fail(`stories/${f}: no YAML frontmatter`);
          failures++;
          continue;
        }
        reportErrors(`story ${f}`, validate(fm, schemas.story));
      }
    }

    // Tasks: <specDir>/tasks/T-*.md
    if (schemas.task) {
      const tasksDir = join(specDirArg, 'tasks');
      const taskFiles = globMatch(tasksDir, 'T-.*\\.md').filter((f) => !isTaskFailureHandoffFile(f));
      for (const f of taskFiles) {
        const fm = readFrontmatter(join(tasksDir, f));
        if (!fm) {
          fail(`tasks/${f}: no YAML frontmatter`);
          failures++;
          continue;
        }
        reportErrors(`task ${f}`, validate(fm, schemas.task));
      }
    }

    // .pipeline-shipped (optional) — under `.planr/specs/<SPEC>/` when present.
    if (schemas.shipped) {
      const specsRoot = join(specDirArg, '.planr', 'specs');
      let saw = false;
      if (existsSync(specsRoot)) {
        for (const d of readdirSync(specsRoot)) {
          const sub = join(specsRoot, d);
          try {
            if (!statSync(sub).isDirectory()) continue;
          } catch {
            continue;
          }
          const mp = join(sub, '.pipeline-shipped');
          if (existsSync(mp)) {
            saw = true;
            const obj = parseYaml(readFileSync(mp, 'utf-8'));
            reportErrors(`.pipeline-shipped (${d})`, validate(obj, schemas.shipped));
          }
        }
      }
      const rootMarker = join(specDirArg, '.pipeline-shipped');
      if (existsSync(rootMarker)) {
        saw = true;
        const obj = parseYaml(readFileSync(rootMarker, 'utf-8'));
        reportErrors('.pipeline-shipped (root)', validate(obj, schemas.shipped));
      }
      if (!saw) log('  · .pipeline-shipped not present (skipped — optional)');
    }

    // .run-manifest.jsonl optional per SPEC subdir / root adjacent (legacy)
    if (schemas.runManifestLine) {
      const specsRoot = join(specDirArg, '.planr', 'specs');
      let sawManifest = false;
      if (existsSync(specsRoot)) {
        for (const d of readdirSync(specsRoot)) {
          const sub = join(specsRoot, d);
          try {
            if (!statSync(sub).isDirectory()) continue;
          } catch {
            continue;
          }
          const mf = join(sub, '.run-manifest.jsonl');
          if (existsSync(mf)) {
            sawManifest = true;
            validateManifestJsonl(mf, `.run-manifest.jsonl (${d})`);
          }
        }
      }
      const rootManifest = join(specDirArg, '.run-manifest.jsonl');
      if (existsSync(rootManifest)) {
        sawManifest = true;
        validateManifestJsonl(rootManifest, '.run-manifest.jsonl (root)');
      }
      if (!sawManifest) log('  · .run-manifest.jsonl not present (skipped — optional)');
    }

    // input/tech/stack.md (repo-level; spec-driven invocations historically
    // validate against the repo root stack file, not the fixture-local one).
    if (schemas.stack) {
      const stackPath = join(__repoRoot, 'input', 'tech', 'stack.md');
      if (existsSync(stackPath)) {
        const obj = parseStackMd(stackPath);
        reportErrors('input/tech/stack.md', validate(obj, schemas.stack));
      } else {
        log('  · input/tech/stack.md not present (skipped)');
      }
    }
  } else if (mode === 'default') {
    // Default-mode layout:
    //   <dir>/input/specs/spec-*.md           — feature SPEC frontmatter
    //   <dir>/output/feats/feat-*/us-*/us-*.md       — User Stories
    //   <dir>/output/feats/feat-*/us-*/tasks/task-*.md — Tasks
    //   <dir>/input/tech/stack.md             — fixture-local stack file
    //   .pipeline-shipped is intentionally skipped (pre-ship fixtures)

    // SPEC files: <dir>/input/specs/spec-*.md
    if (schemas.spec) {
      const specsDir = join(specDirArg, 'input', 'specs');
      const specFiles = globMatch(specsDir, 'spec-.*\\.md');
      if (specFiles.length === 0) {
        log(`  ⚠ no spec-*.md found in ${specsDir}`);
      }
      for (const f of specFiles) {
        const fm = readFrontmatter(join(specsDir, f));
        if (!fm) {
          fail(`input/specs/${f}: no YAML frontmatter`);
          failures++;
          continue;
        }
        reportErrors(`spec ${f}`, validate(fm, schemas.spec));
      }
    }

    // Stories + Tasks: walk feat-*/us-*/
    const featsDir = join(specDirArg, 'output', 'feats');
    if (existsSync(featsDir)) {
      for (const featDir of globMatch(featsDir, 'feat-.*')) {
        const featPath = join(featsDir, featDir);
        for (const usDir of globMatch(featPath, 'us-.*')) {
          const usPath = join(featPath, usDir);

          // US file: us-*.md inside the us-* directory
          if (schemas.story) {
            const usFiles = globMatch(usPath, 'us-.*\\.md');
            for (const f of usFiles) {
              const fm = readFrontmatter(join(usPath, f));
              if (!fm) {
                fail(`${featDir}/${usDir}/${f}: no YAML frontmatter`);
                failures++;
                continue;
              }
              reportErrors(`story ${featDir}/${usDir}/${f}`, validate(fm, schemas.story));
            }
          }

          // Task files: us-*/tasks/task-*.md
          if (schemas.task) {
            const tasksDir = join(usPath, 'tasks');
            const taskFiles = globMatch(tasksDir, 'task-.*\\.md');
            for (const f of taskFiles) {
              if (isTaskFailureHandoffFile(f)) continue;
              const fm = readFrontmatter(join(tasksDir, f));
              if (!fm) {
                fail(`${featDir}/${usDir}/tasks/${f}: no YAML frontmatter`);
                failures++;
                continue;
              }
              reportErrors(`task ${featDir}/${usDir}/tasks/${f}`, validate(fm, schemas.task));
            }
          }
        }
      }
    }

    // Fixture-local stack.md: <dir>/input/tech/stack.md
    if (schemas.stack) {
      const stackPath = join(specDirArg, 'input', 'tech', 'stack.md');
      if (existsSync(stackPath)) {
        const obj = parseStackMd(stackPath);
        reportErrors('input/tech/stack.md', validate(obj, schemas.stack));
      } else {
        log('  · input/tech/stack.md not present (skipped)');
      }
    }

    if (schemas.shipped) {
      let saw = false;
      for (const featDir of globMatch(join(specDirArg, 'output', 'feats'), 'feat-.*')) {
        const mp = join(specDirArg, 'output', 'feats', featDir, '.pipeline-shipped');
        if (existsSync(mp)) {
          saw = true;
          const obj = parseYaml(readFileSync(mp, 'utf-8'));
          reportErrors(`.pipeline-shipped (${featDir})`, validate(obj, schemas.shipped));
        }
      }
      if (!saw) log('  · .pipeline-shipped not present under output/feats/ (skipped — optional)');
    }

    if (schemas.runManifestLine) {
      let sawM = false;
      for (const featDir of globMatch(join(specDirArg, 'output', 'feats'), 'feat-.*')) {
        const mf = join(specDirArg, 'output', 'feats', featDir, '.run-manifest.jsonl');
        if (existsSync(mf)) {
          sawM = true;
          validateManifestJsonl(mf, `.run-manifest.jsonl (${featDir})`);
        }
      }
      if (!sawM) log('  · .run-manifest.jsonl not present under feats (skipped — optional)');
    }
  }

  log(`\n${failures === 0 ? '✓ All schema validations passed.' : `✗ ${failures} validation issue(s).`}`);
  process.exit(failures === 0 ? 0 : 1);
}

if ((wantVerifyPO || wantVerifyShip) && !projectDir) {
  console.error('--verify-po and --verify-ship require --dir <project-dir>');
  process.exit(2);
}

if (wantVerifyPO || wantVerifyShip) {
  const root = resolve(projectDir);

  // ── SPEC-013 parallel-dispatch fixtures (G3 / G4) ───────────────────────
  // These carry a `.parallel-dispatch-fixture.json` sentinel and are NOT full
  // shipped projects, so they bypass detectFixtureMode + the todo-project
  // assertions entirely. They are only meaningful under --verify-ship.
  if (wantVerifyShip && isParallelDispatchFixture(root)) {
    const sentinel = JSON.parse(readFileSync(join(root, '.parallel-dispatch-fixture.json'), 'utf-8'));
    log(`\nVerifying parallel-dispatch ${sentinel.gate} fixture in ${root} (runtime: ${runtime})`);
    if (sentinel.gate === 'G4') {
      failures += verifyG4SequentialParity(root);
    } else if (sentinel.gate === 'G3') {
      failures += verifyG3ArgValidation(root);
    } else if (sentinel.gate === 'G6') {
      failures += verifyG6CrashRecovery(root);
    } else if (sentinel.gate === 'G1') {
      failures += verifyG1MultiWave(root);
    } else if (sentinel.gate === 'G2') {
      failures += verifyG2FloorOf1(root);
    } else if (sentinel.gate === 'G7') {
      failures += verifyG7MergeScope(root);
    } else if (sentinel.gate === 'FIXTURE-A') {
      failures += verifyFixtureAClobberPrevention(root);
    } else if (sentinel.gate === 'FIXTURE-C') {
      failures += verifyFixtureCUndeclaredWrite(root);
    } else if (sentinel.gate === 'FIXTURE-D') {
      failures += verifyFixtureDCyclicDep(root);
    } else {
      console.error(`Unknown parallel-dispatch gate: ${sentinel.gate}`);
      process.exit(2);
    }
    process.exit(failures === 0 ? 0 : 1);
  }

  const modeForVerify = detectFixtureMode(root);
  if (modeForVerify === null) {
    console.error(`Cannot detect conformance fixture mode under ${root}`);
    process.exit(1);
  }

  const specDirDyn = discoverSpecDrivenSpecDir(root);
  const defaultFeatDir = discoverDefaultFeatDir(root);

  if (modeForVerify === 'spec-driven' && !specDirDyn) {
    console.error(`spec-driven conformance root ${root}: missing .planr/specs/SPEC-*`);
    process.exit(1);
  }
  if (modeForVerify === 'default' && !defaultFeatDir) {
    console.error(`default-mode conformance root ${root}: missing output/feats/feat-*`);
    process.exit(1);
  }

  const assertPoTasksDirClean = (tasksDirAbs) => {
    if (!tasksDirAbs || !existsSync(tasksDirAbs)) return;
    for (const f of readdirSync(tasksDirAbs)) {
      if (isTaskFailureHandoffFile(f)) {
        fail(`unexpected failure handoff after PO (${join(tasksDirAbs, f)})`);
        failures++;
      }
    }
  };

  // ── verify-po mode ──────────────────────────────────────────────────────
  if (wantVerifyPO) {
    log(`\nVerifying PO state in ${root} (runtime: ${runtime}, mode: ${modeForVerify})\n`);

    if (modeForVerify === 'spec-driven') {
      const specDir = specDirDyn;
      assertExists('spec dir exists', specDir);
      assertExists('stories/ subdir', join(specDir, 'stories'));
      assertExists('tasks/ subdir', join(specDir, 'tasks'));

      const stories = globMatch(join(specDir, 'stories'), 'US-.*\\.md');
      const tasks = globMatch(join(specDir, 'tasks'), 'T-.*\\.md').filter((f) => !isTaskFailureHandoffFile(f));

      if (stories.length === 1) {
        pass(`exactly 1 story (got ${stories.length}: ${stories[0]})`);
      } else {
        fail(`expected 1 story, got ${stories.length}`);
        failures++;
      }

      if (tasks.length === 1) {
        pass(`exactly 1 task (got ${tasks.length}: ${tasks[0]})`);
        const taskFm = readFrontmatter(join(specDir, 'tasks', tasks[0]));
        if (taskFm?.type === 'Tech') {
          pass(`task type is Tech (got: ${taskFm.type})`);
        } else {
          fail(`task type expected Tech, got: ${taskFm?.type}`);
          failures++;
        }
        if (taskFm?.agent === 'backend-agent') {
          pass(`task agent is backend-agent (got: ${taskFm.agent})`);
        } else {
          fail(`task agent expected backend-agent, got: ${taskFm?.agent}`);
          failures++;
        }
      } else {
        fail(`expected 1 task, got ${tasks.length}`);
        failures++;
      }

      assertNotExists('no design-spec.md (no PNGs)', join(specDir, 'design', 'design-spec.md'));
      assertPoTasksDirClean(join(specDir, 'tasks'));
      assertNotExists('no .pipeline-shipped marker after PO (R1)', join(specDir, '.pipeline-shipped'));
    } else {
      assertExists('output/feats/<feature>/ exists', defaultFeatDir);
      const usDirs = globMatch(defaultFeatDir, 'us-.*');
      if (usDirs.length !== 1) {
        fail(`expected exactly 1 us-* dir under feature, got ${usDirs.length}`);
        failures++;
      } else {
        pass(`exactly 1 US directory (${usDirs[0]})`);
      }
      const usPath = join(defaultFeatDir, usDirs[0] || 'us-1');
      const storiesDm = globMatch(usPath, 'us-.*\\.md');
      const tasksDm = globMatch(join(usPath, 'tasks'), 'task-.*\\.md').filter((f) => !isTaskFailureHandoffFile(f));

      if (storiesDm.length === 1) pass(`exactly 1 story file (${storiesDm[0]})`);
      else {
        fail(`expected 1 story markdown, got ${storiesDm.length}`);
        failures++;
      }
      if (tasksDm.length === 1) {
        pass(`exactly 1 task (got ${tasksDm.length}: ${tasksDm[0]})`);
        const taskFm = readFrontmatter(join(usPath, 'tasks', tasksDm[0]));
        if (taskFm?.type === 'Tech') pass(`task type is Tech (got: ${taskFm.type})`);
        else {
          fail(`task type expected Tech, got: ${taskFm?.type}`);
          failures++;
        }
      } else {
        fail(`expected 1 task, got ${tasksDm.length}`);
        failures++;
      }

      assertNotExists('no design-spec.md (default)', join(defaultFeatDir, 'design', 'design-spec.md'));
      assertPoTasksDirClean(join(usPath, 'tasks'));
      assertNotExists('no .pipeline-shipped after PO (R1)', join(defaultFeatDir, '.pipeline-shipped'));
    }

    log(`\n${failures === 0 ? '✓ PO state conforms.' : `✗ ${failures} PO assertion(s) failed.`}`);
    process.exit(failures === 0 ? 0 : 1);
  }

  // ── verify-ship mode ────────────────────────────────────────────────────
  if (wantVerifyShip) {
    log(`\nVerifying SHIP state in ${root} (runtime: ${runtime}, mode: ${modeForVerify})\n`);

    assertExists('source file (src/todo.ts)', join(root, 'src', 'todo.ts'));
    const testGlob = globMatch(join(root, 'tests'), 'todo*\\.test\\.ts');
    if (testGlob.length >= 1) {
      pass(`test file(s) present: ${testGlob.join(', ')}`);
    } else {
      fail('expected at least one tests/todo*.test.ts');
      failures++;
    }

    try {
      execSync('npx tsc --noEmit', { cwd: root, stdio: 'pipe' });
      pass('npx tsc --noEmit exits 0');
    } catch (e) {
      fail('npx tsc --noEmit failed', e.message.split('\n').slice(0, 3).join(' / '));
      failures++;
    }

    try {
      execSync('npx vitest run', { cwd: root, stdio: 'pipe' });
      pass('npx vitest run exits 0');
    } catch (e) {
      fail('npx vitest run failed', e.message.split('\n').slice(0, 3).join(' / '));
      failures++;
    }

    const markerPath =
      modeForVerify === 'spec-driven' ? join(specDirDyn, '.pipeline-shipped') : join(defaultFeatDir, '.pipeline-shipped');
    const qaPath =
      modeForVerify === 'spec-driven' ? join(specDirDyn, 'qa-report.md') : join(defaultFeatDir, 'qa-report.md');

    assertExists('.pipeline-shipped marker', markerPath);

    if (existsSync(markerPath)) {
      const raw = readFileSync(markerPath, 'utf-8');
      const required = [
        'shipped_at',
        'pipeline_version',
        'runtime',
        'mode',
        'feature',
        'tasks_executed',
        'qa_gate_status',
      ];
      for (const field of required) {
        if (new RegExp(`^${field}:`, 'm').test(raw)) {
          pass(`marker has ${field}`);
        } else {
          fail(`marker missing required field: ${field}`);
          failures++;
        }
      }
      const m = raw.match(/^runtime:\s*"?([a-z-]+)"?/m);
      if (m && m[1] === runtime) {
        pass(`marker runtime field matches CLI flag (${runtime})`);
      } else {
        fail(`marker runtime expected ${runtime}, got: ${m?.[1] || '(missing)'}`);
        failures++;
      }
    }

    assertExists('qa-report.md', qaPath);
    if (modeForVerify === 'spec-driven') {
      assertNotExists('no singleton error-report.md (happy path)', join(specDirDyn, 'tasks', 'error-report.md'));
    } else {
      const usDirs = globMatch(defaultFeatDir, 'us-.*');
      const usPath = join(defaultFeatDir, usDirs[0] || 'us-1');
      assertNotExists('no singleton error-report.md (happy path)', join(usPath, 'tasks', 'error-report.md'));
    }

    try {
      const taskRoots = [];
      if (modeForVerify === 'spec-driven') taskRoots.push(join(specDirDyn, 'tasks'));
      else {
        for (const ud of globMatch(defaultFeatDir, 'us-.*')) {
          taskRoots.push(join(defaultFeatDir, ud, 'tasks'));
        }
      }
      const preserveLists = [];
      for (const tasksDirPath of taskRoots) {
        if (!existsSync(tasksDirPath)) continue;
        const tfiles = readdirSync(tasksDirPath).filter(
          (f) => f.endsWith('.md') && !isTaskFailureHandoffFile(f),
        );
        for (const t of tfiles) {
          const body = readFileSync(join(tasksDirPath, t), 'utf-8');
          const pm = body.match(/##\s*Files\s*[—\-]?\s*Preserve[\s\S]*?(?=\n##|$)/i);
          if (pm) {
            for (const line of pm[0].split('\n')) {
              const lm = line.match(/^[\s\-*]*`?([^`\s]+\.[a-z0-9]+)`?/);
              if (lm) preserveLists.push(lm[1]);
            }
          }
        }
      }
      const diffed = execSync('git diff --name-only HEAD', { cwd: root, encoding: 'utf-8' })
        .split('\n')
        .filter(Boolean);
      const violations = diffed.filter((f) => preserveLists.includes(f));
      if (violations.length === 0) {
        pass(`no Preserve files were modified (${preserveLists.length} on Preserve list)`);
      } else {
        fail(`Preserve violations: ${violations.join(', ')}`);
        failures++;
      }
    } catch (e) {
      log(`  ⚠ Preserve check skipped (git not available): ${e.message.split('\n')[0]}`);
    }

    if (runtime !== 'claude-code') {
      const candidates = [join(root, '.cursor', 'rules'), join(root, 'AGENTS.md')];
      let leak = false;
      for (const c of candidates) {
        if (!existsSync(c)) continue;
        try {
          const out = execSync(`grep -r '\\$\\{CLAUDE_PLUGIN_ROOT\\}' "${c}" 2>/dev/null || true`, {
            encoding: 'utf-8',
          });
          if (out.trim()) {
            leak = true;
            fail(`\${CLAUDE_PLUGIN_ROOT} leaked into ${c}`);
            failures++;
          }
        } catch {
          // ignore
        }
      }
      if (!leak) pass('no ${CLAUDE_PLUGIN_ROOT} leak in generated rule files');
    }

    log(`\n${failures === 0 ? '✓ SHIP state conforms.' : `✗ ${failures} SHIP assertion(s) failed.`}`);
    process.exit(failures === 0 ? 0 : 1);
  }
}

console.error(
  'Pick exactly one of: --setup, --verify-po --dir <project-dir>, --verify-ship --dir <project-dir>, --validate-schema <dir>',
);
process.exit(2);
