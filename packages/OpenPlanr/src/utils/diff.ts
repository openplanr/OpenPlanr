/**
 * Minimal line-based unified diff for revise preview.
 *
 * Implements a Wagner–Fischer LCS over lines, then prints hunks with
 * `+` / `-` prefixes. Not a general-purpose diff tool — scoped to small
 * planning artifacts (typically <1K lines), where O(m×n) time/memory is
 * comfortable. Line equality is exact after trimming trailing newlines.
 *
 * We don't pull in an npm diff library because (a) the algorithm is small,
 * (b) the format we emit is fixed and narrow, and (c) keeping the
 * dependency footprint tight is a stated project preference.
 */

interface DiffItem {
  kind: 'same' | 'add' | 'remove';
  line: string;
}

interface Hunk {
  oldStart: number;
  newStart: number;
  items: DiffItem[];
}

export interface UnifiedDiffOptions {
  /** Number of unchanged context lines around each change. Default: 3. */
  context?: number;
  /** Labels printed on the file-header `---` / `+++` rows. */
  oldLabel?: string;
  newLabel?: string;
}

/**
 * Compute a unified diff between two strings. Empty string on either side
 * is valid. Trailing newlines are normalized so a file that ends in `\n`
 * does not spuriously diff against one that does not.
 */
export function unifiedDiff(
  oldText: string,
  newText: string,
  options: UnifiedDiffOptions = {},
): string {
  const contextLines = options.context ?? 3;
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  const items = lcsDiff(oldLines, newLines);
  const hunks = buildHunks(items, contextLines);
  if (hunks.length === 0) return ''; // identical

  const out: string[] = [];
  out.push(`--- ${options.oldLabel ?? 'a'}`);
  out.push(`+++ ${options.newLabel ?? 'b'}`);
  for (const hunk of hunks) {
    const oldLen = hunk.items.filter((i) => i.kind !== 'add').length;
    const newLen = hunk.items.filter((i) => i.kind !== 'remove').length;
    out.push(`@@ -${hunk.oldStart + 1},${oldLen} +${hunk.newStart + 1},${newLen} @@`);
    for (const it of hunk.items) {
      const prefix = it.kind === 'add' ? '+' : it.kind === 'remove' ? '-' : ' ';
      out.push(`${prefix}${it.line}`);
    }
  }
  return out.join('\n');
}

function splitLines(s: string): string[] {
  if (s.length === 0) return [];
  // Preserve empty-trailing-line behavior: drop a single trailing '' so the
  // diff of "a\n" vs "a" is empty rather than noisy.
  const lines = s.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Build a sequence of DiffItems from two line arrays using LCS backtracking.
 */
function lcsDiff(a: string[], b: string[]): DiffItem[] {
  const m = a.length;
  const n = b.length;
  // dp[i][j] = length of LCS of a[0..i) and b[0..j)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      dp[i + 1][j + 1] = a[i] === b[j] ? dp[i][j] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const items: DiffItem[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      items.push({ kind: 'same', line: a[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      items.push({ kind: 'remove', line: a[i - 1] });
      i--;
    } else {
      items.push({ kind: 'add', line: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    items.push({ kind: 'remove', line: a[--i] });
  }
  while (j > 0) {
    items.push({ kind: 'add', line: b[--j] });
  }
  items.reverse();
  return items;
}

// ---------------------------------------------------------------------------
// Apply a unified diff
// ---------------------------------------------------------------------------

export interface ApplyDiffResult {
  ok: boolean;
  /** New content when ok=true. */
  result?: string;
  /** Human-readable reason when ok=false (mismatched context, malformed hunk, etc.). */
  error?: string;
  /** Zero-based index of the first hunk that failed, when ok=false. */
  failedHunkIndex?: number;
}

/**
 * Apply a unified diff to source text. Strict: every hunk's context and
 * removed lines must match the source exactly (after trailing-newline
 * normalization) or the entire apply fails. No fuzzing. This matches what
 * the revise replay path wants — "the diff we planned for is still valid"
 * is a binary question.
 *
 * Accepts the same format our own `unifiedDiff` emits (standard unified
 * with `---`/`+++` headers and `@@ -A,B +C,D @@` hunk markers) so a diff
 * round-trips through this pair without surprises.
 */
export function applyUnifiedDiff(source: string, diffText: string): ApplyDiffResult {
  const sourceLines = splitLines(source);
  const hunks = parseHunks(diffText);

  if (hunks === null) {
    return { ok: false, error: 'malformed diff (could not locate any @@ hunk header)' };
  }

  // Build the result line-by-line, walking source with a cursor and
  // replacing chunks that fall inside each hunk.
  const out: string[] = [];
  let cursor = 0; // 0-based position in sourceLines

  for (let h = 0; h < hunks.length; h++) {
    const hunk = hunks[h];
    const hunkStart = hunk.oldStart - 1; // diff hunks are 1-based

    if (hunkStart < cursor) {
      return {
        ok: false,
        error: `hunk ${h + 1} (@@ -${hunk.oldStart},${hunk.oldLen}) overlaps or precedes previous hunk`,
        failedHunkIndex: h,
      };
    }
    if (hunkStart > sourceLines.length) {
      return {
        ok: false,
        error: `hunk ${h + 1} starts at line ${hunk.oldStart} but source has only ${sourceLines.length} lines`,
        failedHunkIndex: h,
      };
    }

    // Emit unchanged source lines up to the hunk start.
    while (cursor < hunkStart) {
      out.push(sourceLines[cursor++]);
    }

    // Walk the hunk body. Verify every context and removed line matches
    // the corresponding source line; emit context + added lines into out.
    for (const item of hunk.items) {
      if (item.kind === 'same') {
        if (sourceLines[cursor] !== item.line) {
          return {
            ok: false,
            error: `hunk ${h + 1} context mismatch at source line ${cursor + 1}: expected "${item.line}" but found "${sourceLines[cursor] ?? '<eof>'}"`,
            failedHunkIndex: h,
          };
        }
        out.push(item.line);
        cursor++;
      } else if (item.kind === 'remove') {
        if (sourceLines[cursor] !== item.line) {
          return {
            ok: false,
            error: `hunk ${h + 1} removal mismatch at source line ${cursor + 1}: expected "${item.line}" but found "${sourceLines[cursor] ?? '<eof>'}"`,
            failedHunkIndex: h,
          };
        }
        cursor++; // skip the removed source line
      } else {
        // 'add' — contribute to the new stream without advancing cursor
        out.push(item.line);
      }
    }
  }

  // Emit any remaining unchanged source lines after the last hunk.
  while (cursor < sourceLines.length) {
    out.push(sourceLines[cursor++]);
  }

  // Our unified-diff emitter does not carry the "\ No newline at end of
  // file" marker, so we can't distinguish "result ends with \n" from
  // "result does not" when only the diff and source are in hand. We pick
  // a rule that's safe for the workload we actually serve — revise
  // writes markdown artifacts, which conventionally end with a trailing
  // newline. Policy: empty result stays empty; non-empty result always
  // ends with a single trailing newline.
  const joined = out.join('\n');
  if (joined.length === 0) return { ok: true, result: '' };
  return { ok: true, result: `${joined}\n` };
}

interface ParsedHunk {
  oldStart: number;
  oldLen: number;
  newStart: number;
  newLen: number;
  items: DiffItem[];
}

/** Parse unified-diff text into hunks. Returns null when no hunk header is found. */
function parseHunks(diffText: string): ParsedHunk[] | null {
  const lines = diffText.split('\n');
  const hunks: ParsedHunk[] = [];

  const hunkHeaderRe = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

  let current: ParsedHunk | null = null;
  for (const line of lines) {
    // Skip file headers; they are informational, not part of any hunk.
    if (line.startsWith('---') || line.startsWith('+++')) continue;

    const header = hunkHeaderRe.exec(line);
    if (header) {
      if (current) hunks.push(current);
      current = {
        oldStart: Number(header[1]),
        oldLen: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLen: header[4] === undefined ? 1 : Number(header[4]),
        items: [],
      };
      continue;
    }

    if (!current) continue; // lines before the first header are ignored
    if (line.length === 0) {
      // An empty line inside a hunk represents a blank context line. The
      // leading-space prefix gets stripped by some tools / MD code-fences,
      // so we tolerate bare empty lines and treat them as context.
      current.items.push({ kind: 'same', line: '' });
      continue;
    }

    const prefix = line[0];
    const body = line.slice(1);
    if (prefix === ' ') current.items.push({ kind: 'same', line: body });
    else if (prefix === '+') current.items.push({ kind: 'add', line: body });
    else if (prefix === '-') current.items.push({ kind: 'remove', line: body });
    // Any other prefix (e.g., '\\' for "\ No newline at end of file") is
    // ignored; we don't round-trip that marker.
  }
  if (current) hunks.push(current);

  return hunks.length > 0 ? hunks : null;
}

/** Group items into hunks that include `context` unchanged lines around each change. */
function buildHunks(items: DiffItem[], context: number): Hunk[] {
  const hunks: Hunk[] = [];
  let oldIdx = 0;
  let newIdx = 0;

  // First pass: mark index of every item in old/new streams
  const marks = items.map((it) => {
    const m = { item: it, oldIdx, newIdx };
    if (it.kind !== 'add') oldIdx++;
    if (it.kind !== 'remove') newIdx++;
    return m;
  });

  let i = 0;
  while (i < marks.length) {
    if (marks[i].item.kind === 'same') {
      i++;
      continue;
    }
    // Change region: expand left by `context`, then run forward including
    // intermediate small same-runs (≤ 2*context apart → merge).
    const start = Math.max(0, i - context);
    let end = i;
    while (end < marks.length) {
      if (marks[end].item.kind !== 'same') {
        end++;
        continue;
      }
      // Look ahead: is the next change within 2*context?
      let sameRun = 0;
      let k = end;
      while (k < marks.length && marks[k].item.kind === 'same') {
        sameRun++;
        k++;
      }
      if (k >= marks.length || sameRun > 2 * context) {
        // Close the hunk after `context` trailing same-lines.
        end += Math.min(context, sameRun);
        break;
      }
      end = k;
    }
    const slice = marks.slice(start, Math.min(end, marks.length));
    hunks.push({
      oldStart: marks[start].oldIdx,
      newStart: marks[start].newIdx,
      items: slice.map((s) => s.item),
    });
    i = end;
  }
  return hunks;
}
