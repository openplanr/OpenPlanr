import {
  lstatSync, readFileSync, readdirSync, realpathSync, statSync,
} from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

const CYCLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const MAX_REPORT_BYTES = 1024 * 1024;
const MAX_CYCLE_DIRECTORIES = 1000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

function contained(root, candidate) {
  const child = relative(root, candidate);
  return child !== '..'
    && !child.startsWith(`..${sep}`)
    && !isAbsolute(child);
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

function safeReportPath(operateRoot, cycleId) {
  if (!CYCLE_ID.test(cycleId)) return null;
  const cycleRoot = safeDirectory(join(operateRoot, cycleId), operateRoot);
  if (!cycleRoot) return null;
  const lexicalReport = join(cycleRoot, 'board-report.md');
  try {
    const link = lstatSync(lexicalReport);
    if (link.isSymbolicLink() || !link.isFile() || link.size > MAX_REPORT_BYTES) return null;
    const report = realpathSync(lexicalReport);
    if (!contained(cycleRoot, report)) return null;
    const file = statSync(report);
    if (!file.isFile() || file.size > MAX_REPORT_BYTES) return null;
    return Object.freeze({ path: report, updatedAt: file.mtime.toISOString() });
  } catch {
    return null;
  }
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

function sectionText(markdown, heading) {
  const lines = markdown.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`);
  if (start < 0) return '';
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/u.test(lines[index])) break;
    if (lines[index].trim()) body.push(lines[index].trim());
  }
  return cleanInlineMarkdown(body.join(' ')).slice(0, 360);
}

function reportCounts(markdown) {
  return Object.freeze({
    decisions: (markdown.match(/^###\s+D\d+\b/gmu) ?? []).length,
    actions: (markdown.match(/^\|\s*A\d+\s*\|/gmu) ?? []).length,
    issues: (markdown.match(/^[-*]\s+\*\*I\d+\b/gmu) ?? []).length,
  });
}

function readReport(operateRoot, cycleId, { includeMarkdown = false } = {}) {
  const file = safeReportPath(operateRoot, cycleId);
  if (!file) return null;
  try {
    const markdown = readFileSync(file.path, 'utf8');
    if (Buffer.byteLength(markdown, 'utf8') > MAX_REPORT_BYTES) return null;
    const title = firstHeading(markdown, cycleId);
    const summary = sectionText(markdown, 'executive summary');
    const item = {
      cycleId,
      title,
      summary: summary || 'Completed local operating review.',
      updatedAt: file.updatedAt,
      counts: reportCounts(markdown),
      href: `#/operate/cycles/${encodeURIComponent(cycleId)}`,
    };
    if (includeMarkdown) item.markdown = markdown;
    return Object.freeze(item);
  } catch {
    return null;
  }
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
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && CYCLE_ID.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export function readLocalOperateReviewIndex(planrDir, { page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const safePageSize = Number.isSafeInteger(pageSize) && pageSize > 0
    ? Math.min(pageSize, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  const operateRoot = operateRootFor(planrDir);
  const allItems = operateRoot
    ? cycleIds(operateRoot)
      .map((cycleId) => readReport(operateRoot, cycleId))
      .filter(Boolean)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)
        || left.cycleId.localeCompare(right.cycleId))
    : [];
  const total = allItems.length;
  const pageCount = Math.max(1, Math.ceil(total / safePageSize));
  const boundedPage = Math.min(safePage, pageCount);
  const start = (boundedPage - 1) * safePageSize;
  return Object.freeze({
    kind: 'local-operate-review-index',
    schemaVersion: '1.0.0',
    readOnly: true,
    pagination: Object.freeze({ page: boundedPage, pageSize: safePageSize, pageCount, total }),
    items: Object.freeze(allItems.slice(start, start + safePageSize)),
  });
}

export function readLocalOperateReview(planrDir, cycleId) {
  const operateRoot = operateRootFor(planrDir);
  if (!operateRoot || !CYCLE_ID.test(cycleId)) return null;
  const item = readReport(operateRoot, cycleId, { includeMarkdown: true });
  if (!item) return null;
  return Object.freeze({
    kind: 'local-operate-review',
    schemaVersion: '1.0.0',
    readOnly: true,
    item,
  });
}
