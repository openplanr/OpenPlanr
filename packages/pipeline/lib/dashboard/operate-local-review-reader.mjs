import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

const CYCLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const MAX_REPORT_BYTES = 1024 * 1024;
const MAX_CYCLE_BYTES = 4 * MAX_REPORT_BYTES;
const MAX_CYCLE_DIRECTORIES = 1000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const REVIEW_FILES = Object.freeze([
  'board-report.md',
  'cycle.md',
  'brief.md',
  'ceo.md',
  'cto.md',
  'cpo.md',
  'cmo.md',
  'coo.md',
  'challenger.md',
  'chair.md',
]);
const LENS_FILES = Object.freeze([
  ['CEO', 'ceo.md'],
  ['CTO', 'cto.md'],
  ['CPO', 'cpo.md'],
  ['CMO', 'cmo.md'],
  ['COO', 'coo.md'],
  ['Challenger', 'challenger.md'],
  ['Chair', 'chair.md'],
]);

function contained(root, candidate) {
  const child = relative(root, candidate);
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function safeDirectory(path, root = null) {
  try {
    if (lstatSync(path).isSymbolicLink() || !statSync(path).isDirectory()) return null;
    const real = realpathSync(path);
    if (root !== null && !contained(root, real)) return null;
    return real;
  } catch {
    return null;
  }
}

function safeMarkdownFile(cycleRoot, filename) {
  if (!REVIEW_FILES.includes(filename)) return null;
  const lexicalPath = join(cycleRoot, filename);
  try {
    const link = lstatSync(lexicalPath);
    if (link.isSymbolicLink() || !link.isFile() || link.size > MAX_REPORT_BYTES) return null;
    const path = realpathSync(lexicalPath);
    if (!contained(cycleRoot, path)) return null;
    const file = statSync(path);
    if (!file.isFile() || file.size > MAX_REPORT_BYTES) return null;
    return Object.freeze({
      path,
      size: file.size,
      updatedAt: file.mtime.toISOString(),
    });
  } catch {
    return null;
  }
}

function readCycleFiles(operateRoot, cycleId) {
  if (!CYCLE_ID.test(cycleId)) return null;
  const cycleRoot = safeDirectory(join(operateRoot, cycleId), operateRoot);
  if (!cycleRoot) return null;
  const files = {};
  let totalBytes = 0;
  let updatedAt = '';
  for (const filename of REVIEW_FILES) {
    const file = safeMarkdownFile(cycleRoot, filename);
    if (!file || totalBytes + file.size > MAX_CYCLE_BYTES) continue;
    try {
      const markdown = readFileSync(file.path, 'utf8');
      const bytes = Buffer.byteLength(markdown, 'utf8');
      if (bytes > MAX_REPORT_BYTES || totalBytes + bytes > MAX_CYCLE_BYTES) continue;
      files[filename] = markdown;
      totalBytes += bytes;
      if (file.updatedAt > updatedAt) updatedAt = file.updatedAt;
    } catch {
      // An individual note must not hide an otherwise readable board report.
    }
  }
  if (typeof files['board-report.md'] !== 'string') return null;
  return Object.freeze({ files: Object.freeze(files), totalBytes, updatedAt });
}

function cleanInlineMarkdown(value) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replace(/[*_`>#|]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function firstHeading(markdown, fallback) {
  const line = markdown.split(/\r?\n/u).find((entry) => /^#\s+\S/u.test(entry));
  return line ? cleanInlineMarkdown(line.replace(/^#\s+/u, '')) : fallback;
}

function sectionMarkdown(markdown, heading) {
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
  const normalized = heading.toLowerCase();
  const start = lines.findIndex((line) => {
    const match = /^##\s+(.+)$/u.exec(line.trim());
    return match && cleanInlineMarkdown(match[1]).toLowerCase() === normalized;
  });
  if (start < 0) return '';
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/u.test(lines[index])) break;
    body.push(lines[index]);
  }
  return body.join('\n').trim();
}

function sectionText(markdown, heading, limit = 360) {
  return cleanInlineMarkdown(sectionMarkdown(markdown, heading)).slice(0, limit);
}

function fieldsFromMarkdown(markdown) {
  const fields = {};
  for (const line of markdown.split(/\r?\n/u)) {
    const match = /^[-*]\s+\*\*([^*]+):\*\*\s*(.*)$/u.exec(line.trim());
    if (!match) continue;
    fields[cleanInlineMarkdown(match[1]).toLowerCase()] = cleanInlineMarkdown(match[2]);
  }
  return fields;
}

function headingEntries(markdown, prefix) {
  const lines = markdown.split(/\r?\n/u);
  const entries = [];
  let current = null;
  for (const line of lines) {
    const match = new RegExp(
      `^###\\s+(${prefix}\\d+)\\s+[—-]\\s+(?:\\[([^\\]]+)\\]\\s*)?(.+)$`,
      'u',
    ).exec(line.trim());
    if (match) {
      if (current) entries.push(current);
      current = {
        id: match[1],
        priority: match[2] ?? null,
        title: cleanInlineMarkdown(match[3]),
        body: [],
      };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) entries.push(current);
  return entries;
}

function parseDecisions(markdown) {
  return Object.freeze(
    headingEntries(sectionMarkdown(markdown, 'decision queue'), 'D').map((entry) => {
      const fields = fieldsFromMarkdown(entry.body.join('\n'));
      return Object.freeze({
        id: entry.id,
        priority: entry.priority ?? 'Unranked',
        title: entry.title,
        recommendation: fields.recommendation ?? '',
        whyNow: fields['why now'] ?? '',
        owner: fields['suggested owner'] ?? 'Unassigned',
        confidence: fields.confidence ?? 'Not recorded',
        firstStep: fields['first step'] ?? '',
        expectedResult: fields['expected result'] ?? '',
        check: fields.check ?? '',
        dependencies: fields.dependencies ?? 'None',
        revisitWhen: fields['revisit when'] ?? '',
        sources: fields.sources ?? '',
        dissent: fields.dissent ?? '',
      });
    }),
  );
}

function tableRows(markdown) {
  const lines = markdown.split(/\r?\n/u).filter((line) => line.trim().startsWith('|'));
  if (lines.length < 2) return [];
  const parse = (line) =>
    line
      .trim()
      .replace(/^\||\|$/gu, '')
      .split('|')
      .map((cell) => cleanInlineMarkdown(cell));
  const headers = parse(lines[0]);
  return lines.slice(2).map((line) => {
    const values = parse(line);
    return Object.fromEntries(
      headers.map((header, index) => [header.toLowerCase(), values[index] ?? '']),
    );
  });
}

function parseActions(markdown) {
  return Object.freeze(
    tableRows(sectionMarkdown(markdown, 'action plan'))
      .filter((row) => /^A\d+$/u.test(row.id ?? ''))
      .map((row) =>
        Object.freeze({
          id: row.id,
          priority: row.priority || 'Unranked',
          action: row.action || '',
          owner: row['suggested owner'] || 'Unassigned',
          firstStep: row['first step'] || '',
          successMeasure: row['success measure'] || '',
          check: row.check || '',
          dependencies: row['depends on'] || 'None',
          state: /unassigned/iu.test(row['suggested owner'] ?? '') ? 'needs-owner' : 'proposed',
        }),
      ),
  );
}

function parseNamedList(markdown, heading, prefix) {
  const section = sectionMarkdown(markdown, heading);
  const entries = [];
  let fallback = 0;
  for (const line of section.split(/\r?\n/u)) {
    const match =
      /^[-*]\s+(?:\*\*)?((?:[A-Z]\d+)\s+[—-]\s+[^:*]+|[^:]+)(?::\*\*)?\s*:?\s*(.*)$/u.exec(
        line.trim(),
      );
    if (!match) continue;
    const label = cleanInlineMarkdown(match[1]);
    const named = new RegExp(`^(${prefix}\\d+)\\s+[—-]\\s+(.+)$`, 'u').exec(label);
    fallback += 1;
    entries.push(
      Object.freeze({
        id: named?.[1] ?? `${prefix}${fallback}`,
        title: named?.[2] ?? label,
        detail: cleanInlineMarkdown(match[2]),
      }),
    );
  }
  return Object.freeze(entries);
}

function parseScope(markdown) {
  const fields = fieldsFromMarkdown(sectionMarkdown(markdown, 'scope'));
  return Object.freeze({
    subject: fields.subject ?? '',
    window: fields.window ?? '',
    requestedDecision: fields['requested decision'] ?? '',
    custody: fields.custody ?? 'local-only',
  });
}

function lensOutcomeRows(markdown) {
  return tableRows(sectionMarkdown(markdown, 'review coverage'));
}

function findingCount(markdown, prefix = 'F') {
  return (markdown.match(new RegExp(`^###\\s+${prefix}\\d+\\b`, 'gmu')) ?? []).length;
}

function parseLenses(files, board) {
  const coverage = new Map(lensOutcomeRows(board).map((row) => [row.lens?.toLowerCase(), row]));
  return Object.freeze(
    LENS_FILES.map(([name, filename]) => {
      const note = files[filename] ?? '';
      const row = coverage.get(name.toLowerCase()) ?? {};
      const outcome = row.outcome || (note ? 'reported' : 'missing');
      const signalMatch =
        /(?:signal|verdict):\s*([^)]+)/iu.exec(outcome) ??
        /\*\*(?:Signal|Verdict):\*\*\s*([^\n]+)/iu.exec(note);
      const prefix = name === 'Challenger' ? 'X' : name === 'Chair' ? 'D' : 'F';
      return Object.freeze({
        name,
        filename,
        present: Boolean(note),
        outcome,
        signal: cleanInlineMarkdown(signalMatch?.[1] ?? (note ? 'reported' : 'missing')),
        informed: row.informed || '',
        findings: note ? findingCount(note, prefix) : 0,
        recommendation: note ? sectionText(note, 'recommended next move', 520) : '',
      });
    }),
  );
}

function parseEvidence(files, decisions) {
  const candidates = [files['board-report.md'] ?? ''];
  for (const decision of decisions) candidates.push(decision.sources);
  for (const [filename, markdown] of Object.entries(files)) {
    const sourceSection = sectionMarkdown(markdown, 'sources consulted');
    if (sourceSection) candidates.push(sourceSection);
    if (filename === 'brief.md') candidates.push(sectionMarkdown(markdown, 'source pointers'));
  }
  const seen = new Set();
  const evidence = [];
  const tokenPattern = /`([^`\n]{1,240})`/gu;
  for (const sourceText of candidates) {
    for (const match of sourceText.matchAll(tokenPattern)) {
      const reference = match[1].trim();
      const looksLikePath =
        /[/.]/u.test(reference) &&
        /(?:\/|\.(?:md|ts|tsx|js|mjs|yml|yaml|json))(?:[:#]|$)/u.test(reference);
      if (!looksLikePath || seen.has(reference)) continue;
      seen.add(reference);
      evidence.push(
        Object.freeze({
          id: `E${evidence.length + 1}`,
          reference,
          kind:
            reference.includes('#') || /:\d/u.test(reference) ? 'source location' : 'source file',
          freshness: 'captured in cycle',
        }),
      );
      if (evidence.length >= 120) return Object.freeze(evidence);
    }
  }
  return Object.freeze(evidence);
}

function overallSignal(markdown) {
  const summary = sectionMarkdown(markdown, 'executive summary');
  const match =
    /\*\*Overall signal:\s*([^.*]+)[.*]?\*\*/iu.exec(summary) ??
    /Overall signal:\s*([^.!\n]+)/iu.exec(summary);
  return cleanInlineMarkdown(match?.[1] ?? 'review complete');
}

function reportCounts(markdown) {
  return Object.freeze({
    decisions: headingEntries(sectionMarkdown(markdown, 'decision queue'), 'D').length,
    actions: parseActions(markdown).length,
    gaps: parseNamedList(markdown, 'decision-changing gaps', 'G').length,
    issues: parseNamedList(markdown, 'issues', 'I').length,
  });
}

function buildStructuredReview(cycleId, cycle) {
  const markdown = cycle.files['board-report.md'];
  const decisions = parseDecisions(markdown);
  const actions = parseActions(markdown);
  const gaps = parseNamedList(markdown, 'decision-changing gaps', 'G');
  const risks = parseNamedList(markdown, 'risks and dissent', 'R');
  const issues = parseNamedList(markdown, 'issues', 'I');
  const lenses = parseLenses(cycle.files, markdown);
  const evidence = parseEvidence(cycle.files, decisions);
  const presentFiles = REVIEW_FILES.filter((filename) => typeof cycle.files[filename] === 'string');
  const expectedFiles = REVIEW_FILES.filter((filename) => filename !== 'brief.md');
  const missingFiles = expectedFiles.filter((filename) => !presentFiles.includes(filename));
  const scope = parseScope(markdown);
  const summary = sectionText(markdown, 'executive summary', 1200);
  return Object.freeze({
    cycleId,
    title: firstHeading(markdown, cycleId),
    summary: summary || 'Completed local operating review.',
    signal: overallSignal(markdown),
    updatedAt: cycle.updatedAt,
    counts: reportCounts(markdown),
    href: `#/operate/cycles/${encodeURIComponent(cycleId)}`,
    scope,
    decisions,
    actions,
    gaps,
    risks,
    issues,
    lenses,
    evidence,
    recovery: Object.freeze({
      complete: missingFiles.length === 0,
      presentFiles: Object.freeze(presentFiles),
      missingFiles: Object.freeze(missingFiles),
      totalBytes: cycle.totalBytes,
      custody: scope.custody,
    }),
    markdown,
  });
}

function readReport(operateRoot, cycleId, { includeDetail = false } = {}) {
  const cycle = readCycleFiles(operateRoot, cycleId);
  if (!cycle) return null;
  const detail = buildStructuredReview(cycleId, cycle);
  if (includeDetail) return detail;
  return Object.freeze({
    cycleId: detail.cycleId,
    title: detail.title,
    summary: detail.summary.slice(0, 360),
    signal: detail.signal,
    updatedAt: detail.updatedAt,
    counts: detail.counts,
    href: detail.href,
  });
}

function operateRootFor(planrDir) {
  const planrRoot = safeDirectory(planrDir);
  if (!planrRoot) return null;
  return safeDirectory(join(planrRoot, 'operate'), planrRoot);
}

function cycleIds(operateRoot) {
  try {
    return readdirSync(operateRoot, { withFileTypes: true })
      .slice(0, MAX_CYCLE_DIRECTORIES)
      .filter(
        (entry) => entry.isDirectory() && !entry.isSymbolicLink() && CYCLE_ID.test(entry.name),
      )
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export function readLocalOperateReviewIndex(
  planrDir,
  { page = 1, pageSize = DEFAULT_PAGE_SIZE } = {},
) {
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const safePageSize =
    Number.isSafeInteger(pageSize) && pageSize > 0
      ? Math.min(pageSize, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  const operateRoot = operateRootFor(planrDir);
  const allItems = operateRoot
    ? cycleIds(operateRoot)
        .map((cycleId) => readReport(operateRoot, cycleId))
        .filter(Boolean)
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            left.cycleId.localeCompare(right.cycleId),
        )
    : [];
  const total = allItems.length;
  const pageCount = Math.max(1, Math.ceil(total / safePageSize));
  const boundedPage = Math.min(safePage, pageCount);
  const start = (boundedPage - 1) * safePageSize;
  return Object.freeze({
    kind: 'local-operate-review-index',
    schemaVersion: '1.0.0',
    readOnly: true,
    pagination: Object.freeze({
      page: boundedPage,
      pageSize: safePageSize,
      pageCount,
      total,
    }),
    items: Object.freeze(allItems.slice(start, start + safePageSize)),
  });
}

export function readLocalOperateReview(planrDir, cycleId) {
  const operateRoot = operateRootFor(planrDir);
  if (!operateRoot || !CYCLE_ID.test(cycleId)) return null;
  const item = readReport(operateRoot, cycleId, { includeDetail: true });
  if (!item) return null;
  return Object.freeze({
    kind: 'local-operate-review',
    schemaVersion: '1.0.0',
    readOnly: true,
    item,
  });
}
