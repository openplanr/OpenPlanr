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

// ── native-dispatch (SPEC-014) fixture helpers ───────────────────────────
//
// SPEC-014 reverses the SPEC-013 worktree + DAG-wave scheduler. The DEV phase
// now dispatches one Agent call per READY task in a single turn, directly on
// the shared working tree — no worktree isolation, no file-by-file merge, no
// `--max-parallel` knob. Ordering is expressed ONLY through the optional
// `dependsOn` field; the high-contention lock-list survives solely as an
// ADVISORY note in the dispatch prompt (never an enforced serialization gate).
//
// The native-dispatch fixtures are self-contained: they carry a
// `.native-dispatch-fixture.json` sentinel with a `gate` (ND1–ND4) and are NOT
// full shipped projects, so they bypass detectFixtureMode + the todo-project
// assertions entirely. The runner models the native dispatch contract in pure
// JS so the conformance suite can assert its observable behavior
// deterministically:
//
//   - ND1 parallel emission: N independent tasks → N Agent calls in one turn,
//     none carrying an `isolation` field.
//   - ND2 advisory lock-list: two tasks sharing a lock-listed path still
//     dispatch in the SAME turn (no serialization); the prompt carries a
//     non-enforcing advisory note.
//   - ND3 dependsOn ordering: a task with an unmet `dependsOn` is NOT ready and
//     dispatches only after its dependency is `done`.
//   - ND4 per-task / single-task: the only sequential paths (Codex/Cursor
//     per-task mode, `--task T-NNN`) emit exactly one Agent call per
//     invocation.
//
// Determinism (NFR3): within a turn, ready tasks are dispatched id-sorted.

/** True iff `dir` is a SPEC-014 native-dispatch fixture (has the sentinel). */
const isNativeDispatchFixture = (dir) =>
  existsSync(join(dir, '.native-dispatch-fixture.json'));

// High-contention lock-list (gitignore-style globs). SURFACED AS ADVISORY ONLY
// (FR9/FR9a) — it never serializes dispatch. Kept in lockstep with the advisory
// note in procedures/ship-step2-dag-dispatch.md.
const ND_LOCK_LIST = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '**/index.ts',
  '**/index.js',
  'prisma/schema.prisma',
  '**/migrations/**',
];

// gitignore-subset glob match (sufficient for the lock list).
const ndGlobMatchesPath = (glob, path) => {
  if (glob === path) return true;
  if (glob.startsWith('**/') && !glob.endsWith('/**')) {
    const tail = glob.slice(3);
    return path === tail || path.endsWith('/' + tail);
  }
  if (glob.endsWith('/**')) {
    const seg = glob.replace(/^\*\*\//, '').replace(/\/\*\*$/, '');
    return path.split('/').includes(seg);
  }
  return false;
};

const ndLockListed = (writeSet) =>
  writeSet.some((p) => ND_LOCK_LIST.some((g) => ndGlobMatchesPath(g, p)));

// Parse a fixture task `.md` into a normalized record: id / agent / type /
// status / write_set / depends_on. The write-set is the union of the Create and
// Modify file lists; an empty write-set is fine (independent tasks may declare
// nothing shared). `dependsOn` is read from frontmatter (optional; default []).
const ndReadTask = (taskPath) => {
  const body = readFileSync(taskPath, 'utf-8');
  const fm = readFrontmatter(taskPath) || {};
  const collect = (heading) => {
    const re = new RegExp(`###\\s*${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n###|\\n##|$)`, 'i');
    const m = body.match(re);
    if (!m) return [];
    const out = [];
    for (const line of m[1].split('\n')) {
      const lm = line.match(/^[\s\-*]+`([^`]+)`/);
      if (lm) out.push(lm[1]);
    }
    return out;
  };
  const writeSet = [...collect('Create'), ...collect('Modify')];
  let dependsOn = fm.dependsOn ?? fm.depends_on ?? [];
  if (typeof dependsOn === 'string') dependsOn = dependsOn ? [dependsOn] : [];
  if (!Array.isArray(dependsOn)) dependsOn = [];
  return {
    id: fm.id,
    agent: fm.agent,
    type: fm.type,
    status: fm.status,
    write_set: writeSet,
    depends_on: dependsOn,
  };
};

// Load every seeded T-NNN.md (minus error-report handoffs) into normalized
// records, id-sorted (NFR3 determinism).
const ndLoadFixtureTasks = (fixtureDir) => {
  const tasksDir = join(fixtureDir, 'tasks');
  const taskFiles = globMatch(tasksDir, 'T-.*\\.md').filter((x) => !isTaskFailureHandoffFile(x));
  taskFiles.sort();
  return taskFiles.map((tf) => ndReadTask(join(tasksDir, tf)));
};

// A task is READY iff every id in its dependsOn is in `doneSet`. Tasks already
// `done` are excluded from the ready frontier.
const ndReadyTasks = (tasks, doneSet) =>
  tasks
    .filter((t) => t.status !== 'done' && !doneSet.has(t.id))
    .filter((t) => t.depends_on.every((d) => doneSet.has(d)))
    .sort((a, b) => a.id.localeCompare(b.id));

// Simulate the native dispatch loop: each turn dispatches ALL ready tasks
// together (one Agent call each), marks them done, and repeats until the queue
// drains. Returns { turns, dispatchOrder } where `turns` is an array of arrays
// (one per turn, id-sorted) and `dispatchOrder` is the flattened sequence.
// dependsOn is the ONLY ordering constraint — write-set overlap never blocks.
const ndSimulateDispatch = (tasks) => {
  const doneSet = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id));
  const turns = [];
  // Guard against cycles / unsatisfiable deps: cap iterations at task count + 1.
  let guard = tasks.length + 1;
  while (guard-- > 0) {
    const ready = ndReadyTasks(tasks, doneSet);
    if (ready.length === 0) break;
    const turn = ready.map((t) => t.id);
    turns.push(turn);
    for (const id of turn) doneSet.add(id);
  }
  return { turns, dispatchOrder: turns.flat() };
};

// ── ND1 — parallel emission ───────────────────────────────────────────────
// N independent tasks (no dependsOn) → N Agent calls in ONE turn; no call
// carries an `isolation` field; no `--max-parallel` is referenced. (FR6/7/8)
const verifyND1Parallel = (fixtureDir) => {
  let f = 0;
  const fl = (label, detail) => {
    fail(label, detail);
    f++;
  };
  log(`\n[ND1] native parallel emission — all ready tasks dispatch in one turn, no isolation: ${fixtureDir}\n`);

  const expEnd = JSON.parse(readFileSync(join(fixtureDir, 'expected', 'end-state.json'), 'utf-8'));
  const tasks = ndLoadFixtureTasks(fixtureDir);

  if (tasks.length === expEnd.task_count) {
    pass(`seeded spec has exactly ${tasks.length} tasks (${tasks.map((t) => t.id).join(', ')})`);
  } else {
    fl(`expected ${expEnd.task_count} seeded tasks, got ${tasks.length}`);
  }

  // No task declares a dependsOn (all independent).
  const withDeps = tasks.filter((t) => t.depends_on.length > 0).map((t) => t.id);
  if (withDeps.length === 0) pass('no task declares dependsOn (all independent)');
  else fl(`tasks unexpectedly declare dependsOn: ${withDeps.join(', ')}`);

  const { turns, dispatchOrder } = ndSimulateDispatch(tasks);

  // All ready in ONE turn.
  if (turns.length === expEnd.turns) pass(`dispatch completes in ${turns.length} turn(s)`);
  else fl(`expected ${expEnd.turns} turn(s), got ${turns.length}`);

  const firstTurn = turns[0] || [];
  if (JSON.stringify(firstTurn) === JSON.stringify(expEnd.ready_first_turn)) {
    pass(`first turn dispatches all ${firstTurn.length} tasks: [${firstTurn.join(', ')}]`);
  } else {
    fl('first-turn ready set diverged from expected', `got ${JSON.stringify(firstTurn)}`);
  }

  // One Agent call per ready task in the turn.
  if (firstTurn.length === expEnd.agent_calls_first_turn) {
    pass(`${firstTurn.length} Agent calls emitted in the single turn (one per ready task)`);
  } else {
    fl(`expected ${expEnd.agent_calls_first_turn} Agent calls, got ${firstTurn.length}`);
  }

  // Deterministic id-sorted order (NFR3).
  if (JSON.stringify(dispatchOrder) === JSON.stringify(expEnd.dispatch_order)) {
    pass(`dispatch order is id-sorted: ${dispatchOrder.join(' → ')}`);
  } else {
    fl('dispatch order not id-sorted', `got ${dispatchOrder.join(' → ')}`);
  }

  // No isolation field anywhere in the task frontmatter (FR8). The fixtures
  // never declare one; assert it stays that way.
  const tasksDir = join(fixtureDir, 'tasks');
  const anyIsolation = globMatch(tasksDir, 'T-.*\\.md')
    .filter((x) => !isTaskFailureHandoffFile(x))
    .some((tf) => /\bisolation\b/.test(readFileSync(join(tasksDir, tf), 'utf-8')));
  if (anyIsolation === expEnd.any_isolation_field) pass(`any_isolation_field = ${anyIsolation} (no worktree isolation)`);
  else fl(`any_isolation_field ${anyIsolation} ≠ expected ${expEnd.any_isolation_field}`);

  log(`\n${f === 0 ? '✓ ND1 native parallel emission holds.' : `✗ ${f} ND1 assertion(s) failed.`}`);
  return f;
};

// ── ND2 — advisory lock-list ──────────────────────────────────────────────
// Two tasks share a lock-listed path; they STILL dispatch in the same turn
// (no serialization). The dispatch prompt carries a non-enforcing advisory
// note. (FR9, FR9a, FR6a)
const verifyND2AdvisoryLockList = (fixtureDir) => {
  let f = 0;
  const fl = (label, detail) => {
    fail(label, detail);
    f++;
  };
  log(`\n[ND2] advisory lock-list — shared lock-listed path does NOT serialize: ${fixtureDir}\n`);

  const expEnd = JSON.parse(readFileSync(join(fixtureDir, 'expected', 'end-state.json'), 'utf-8'));
  const tasks = ndLoadFixtureTasks(fixtureDir);

  if (tasks.length === expEnd.task_count) pass(`seeded spec has exactly ${tasks.length} tasks (${tasks.map((t) => t.id).join(', ')})`);
  else fl(`expected ${expEnd.task_count} seeded tasks, got ${tasks.length}`);

  // Both tasks share the lock-listed path.
  const shared = expEnd.shared_lock_listed_path;
  const bothModifyShared = tasks.every((t) => t.write_set.includes(shared));
  if (bothModifyShared) pass(`both tasks modify the lock-listed path "${shared}"`);
  else fl(`both tasks must modify "${shared}"`);

  // The shared path is indeed on the advisory lock-list.
  if (ndLockListed([shared])) pass(`"${shared}" is on the advisory lock-list`);
  else fl(`"${shared}" is not recognized as a lock-listed path`);

  // No dependsOn between them → both ready in the first turn.
  const { turns } = ndSimulateDispatch(tasks);
  const firstTurn = turns[0] || [];
  if (JSON.stringify(firstTurn) === JSON.stringify(expEnd.ready_first_turn)) {
    pass(`both tasks dispatch in the SAME turn: [${firstTurn.join(', ')}]`);
  } else {
    fl('first-turn ready set diverged from expected', `got ${JSON.stringify(firstTurn)}`);
  }

  if (firstTurn.length === expEnd.agent_calls_first_turn) {
    pass(`${firstTurn.length} Agent calls in the single turn (lock-list did NOT serialize)`);
  } else {
    fl(`expected ${expEnd.agent_calls_first_turn} Agent calls, got ${firstTurn.length}`);
  }

  // Not serialized: exactly one turn, both tasks co-dispatched.
  const serialized = turns.length > 1;
  if (serialized === expEnd.serialized) pass(`serialized = ${serialized} (advisory note is NON-enforcing, FR9a)`);
  else fl(`serialized ${serialized} ≠ expected ${expEnd.serialized}`);

  // The dispatch contract is advisory-only: assert there is no enforcement
  // mechanism in the runner (no serialization helper, no overlap-based wave
  // selection). We assert this positively via the simulated single-turn result
  // above; here we record the advisory flags from the fixture's contract.
  if (expEnd.advisory_note_present === true) pass('advisory note is present in the dispatch prompt (FR9)');
  else fl('fixture must declare advisory_note_present = true');
  if (expEnd.advisory_note_enforcing === false) pass('advisory note is non-enforcing (FR9a)');
  else fl('fixture must declare advisory_note_enforcing = false');

  log(`\n${f === 0 ? '✓ ND2 advisory lock-list holds (no serialization).' : `✗ ${f} ND2 assertion(s) failed.`}`);
  return f;
};

// ── ND3 — dependsOn ordering ──────────────────────────────────────────────
// T-002 dependsOn T-001. T-001 dispatches in turn 1; T-002 is NOT ready until
// T-001 is done, then dispatches in turn 2. Ordering comes ONLY from dependsOn.
// (FR7, FR10)
const verifyND3DependsOn = (fixtureDir) => {
  let f = 0;
  const fl = (label, detail) => {
    fail(label, detail);
    f++;
  };
  log(`\n[ND3] dependsOn ordering — dependent task waits for its dependency: ${fixtureDir}\n`);

  const expEnd = JSON.parse(readFileSync(join(fixtureDir, 'expected', 'end-state.json'), 'utf-8'));
  const tasks = ndLoadFixtureTasks(fixtureDir);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  if (tasks.length === expEnd.task_count) pass(`seeded spec has exactly ${tasks.length} tasks (${tasks.map((t) => t.id).join(', ')})`);
  else fl(`expected ${expEnd.task_count} seeded tasks, got ${tasks.length}`);

  // T-002 declares dependsOn = [T-001].
  const t002Deps = byId.get('T-002')?.depends_on || [];
  if (JSON.stringify(t002Deps) === JSON.stringify(expEnd.t002_depends_on)) {
    pass(`T-002 dependsOn = [${t002Deps.join(', ')}]`);
  } else {
    fl('T-002 dependsOn diverged from expected', `got ${JSON.stringify(t002Deps)}`);
  }

  // Before T-001 is done, T-002 must NOT be ready.
  const readyAtStart = ndReadyTasks(tasks, new Set()).map((t) => t.id);
  const t002ReadyAtStart = readyAtStart.includes('T-002');
  if (t002ReadyAtStart === expEnd.t002_ready_before_t001_done) {
    pass(`T-002 ready before T-001 done = ${t002ReadyAtStart} (blocked by dependsOn)`);
  } else {
    fl(`T-002 ready-before-dep ${t002ReadyAtStart} ≠ expected ${expEnd.t002_ready_before_t001_done}`);
  }

  const { turns, dispatchOrder } = ndSimulateDispatch(tasks);

  // First turn: only T-001.
  if (JSON.stringify(turns[0] || []) === JSON.stringify(expEnd.ready_first_turn)) {
    pass(`first turn dispatches only [${(turns[0] || []).join(', ')}]`);
  } else {
    fl('first-turn ready set diverged', `got ${JSON.stringify(turns[0] || [])}`);
  }

  if ((turns[0] || []).length === expEnd.agent_calls_first_turn) {
    pass(`${(turns[0] || []).length} Agent call in the first turn`);
  } else {
    fl(`expected ${expEnd.agent_calls_first_turn} first-turn Agent call(s), got ${(turns[0] || []).length}`);
  }

  // Second turn: T-002, only after T-001 is done.
  if (JSON.stringify(turns[1] || []) === JSON.stringify(expEnd.ready_after_t001_done)) {
    pass(`after T-001 is done, second turn dispatches [${(turns[1] || []).join(', ')}]`);
  } else {
    fl('second-turn ready set diverged', `got ${JSON.stringify(turns[1] || [])}`);
  }

  if (turns.length === expEnd.turns) pass(`dispatch completes in ${turns.length} turns (T-001 → T-002)`);
  else fl(`expected ${expEnd.turns} turns, got ${turns.length}`);

  if (JSON.stringify(dispatchOrder) === JSON.stringify(expEnd.dispatch_order)) {
    pass(`dispatch order respects dependsOn: ${dispatchOrder.join(' → ')}`);
  } else {
    fl('dispatch order diverged', `got ${dispatchOrder.join(' → ')}`);
  }

  log(`\n${f === 0 ? '✓ ND3 dependsOn ordering holds.' : `✗ ${f} ND3 assertion(s) failed.`}`);
  return f;
};

// ── ND4 — per-task / single-task ──────────────────────────────────────────
// The only sequential paths: Codex/Cursor per-task mode and `--task T-NNN`
// each dispatch exactly ONE Agent call per invocation, even when multiple
// ready tasks exist. (FR11)
const verifyND4PerTask = (fixtureDir) => {
  let f = 0;
  const fl = (label, detail) => {
    fail(label, detail);
    f++;
  };
  log(`\n[ND4] per-task / single-task — exactly one Agent call per invocation: ${fixtureDir}\n`);

  const sentinel = JSON.parse(readFileSync(join(fixtureDir, '.native-dispatch-fixture.json'), 'utf-8'));
  const expEnd = JSON.parse(readFileSync(join(fixtureDir, 'expected', 'end-state.json'), 'utf-8'));
  const tasks = ndLoadFixtureTasks(fixtureDir);
  const invocations = JSON.parse(
    readFileSync(join(fixtureDir, sentinel.invocations || 'invocations.json'), 'utf-8'),
  );

  if (tasks.length === expEnd.task_count) pass(`seeded spec has exactly ${tasks.length} tasks (${tasks.map((t) => t.id).join(', ')})`);
  else fl(`expected ${expEnd.task_count} seeded tasks, got ${tasks.length}`);

  // Multiple ready tasks exist — the point of the fixture is that per-task /
  // single-task STILL emit one call despite that.
  const ready = ndReadyTasks(tasks, new Set()).map((t) => t.id);
  if (JSON.stringify(ready) === JSON.stringify(expEnd.ready_tasks)) {
    pass(`${ready.length} ready tasks exist (${ready.join(', ')}) — yet each invocation emits one call`);
  } else {
    fl('ready set diverged from expected', `got ${JSON.stringify(ready)}`);
  }

  // Model one Agent call per invocation: per-task picks the lowest-id ready
  // task; single-task picks the selected task. Either way, exactly one call.
  const callsFor = (inv) => {
    if (inv.mode === 'single-task') return inv.selected_task ? 1 : 0;
    if (inv.mode === 'per-task') return ready.length > 0 ? 1 : 0;
    return 0;
  };

  for (const inv of invocations) {
    const calls = callsFor(inv);
    if (calls === inv.expected_agent_calls && calls === expEnd.expected_agent_calls_per_invocation) {
      pass(`[${inv.name}] (${inv.runtime}/${inv.mode}) → exactly ${calls} Agent call`);
    } else {
      fl(`[${inv.name}] expected ${inv.expected_agent_calls} Agent call(s), got ${calls}`);
    }
  }

  // Regression guard: NO invocation here emits parallel calls (this is the
  // sequential path). Every invocation must be exactly 1.
  const anyParallel = invocations.some((inv) => callsFor(inv) > 1);
  if (!anyParallel) pass('regression: no per-task/single-task invocation emits more than one Agent call');
  else fl('a per-task/single-task invocation emitted parallel calls — must be sequential');

  log(`\n${f === 0 ? '✓ ND4 per-task / single-task holds (one call per invocation).' : `✗ ${f} ND4 assertion(s) failed.`}`);
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

  // ── SPEC-014 native-dispatch fixtures (ND1–ND4) ────────────────────────
  // These carry a `.native-dispatch-fixture.json` sentinel and are NOT full
  // shipped projects, so they bypass detectFixtureMode + the todo-project
  // assertions entirely. They are only meaningful under --verify-ship.
  if (wantVerifyShip && isNativeDispatchFixture(root)) {
    const sentinel = JSON.parse(readFileSync(join(root, '.native-dispatch-fixture.json'), 'utf-8'));
    log(`\nVerifying native-dispatch ${sentinel.gate} fixture in ${root} (runtime: ${runtime})`);
    if (sentinel.gate === 'ND1') {
      failures += verifyND1Parallel(root);
    } else if (sentinel.gate === 'ND2') {
      failures += verifyND2AdvisoryLockList(root);
    } else if (sentinel.gate === 'ND3') {
      failures += verifyND3DependsOn(root);
    } else if (sentinel.gate === 'ND4') {
      failures += verifyND4PerTask(root);
    } else {
      console.error(`Unknown native-dispatch gate: ${sentinel.gate}`);
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
