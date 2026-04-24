import YAML from 'yaml';
import type { ArtifactFrontmatter } from '../models/types.js';

/** A single line from an OpenPlanr/Linear task list (`- [x] **1.0** ...`). */
export interface TaskCheckboxLine {
  id: string;
  title: string;
  done: boolean;
  parentId: string | null;
  depth: number;
  lineIndex: number;
  /** The full text of the line (including leading whitespace). */
  lineText: string;
}

export interface ParsedMarkdown {
  data: ArtifactFrontmatter;
  content: string;
}

const FRONTMATTER_REGEX = /^---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*\r?\n?([\s\S]*)$/;

export function parseMarkdown(raw: string): ParsedMarkdown {
  const match = FRONTMATTER_REGEX.exec(raw);
  if (!match) {
    return { data: {} as ArtifactFrontmatter, content: raw };
  }

  const yamlStr = match[1];
  const content = match[2];

  const data = YAML.parse(yamlStr) ?? {};
  return { data: data as ArtifactFrontmatter, content };
}

export function toMarkdownWithFrontmatter(data: ArtifactFrontmatter, content: string): string {
  const yamlStr = YAML.stringify(data).trimEnd();
  return `---\n${yamlStr}\n---\n${content}`;
}

/**
 * Parse OpenPlanr task list checkbox lines (same format as `parseTaskMarkdown` in `task-parser.ts`).
 * Exposes 0-based `lineIndex` (the array index into `content.split('\n')`).
 */
export function parseTaskCheckboxLines(content: string): TaskCheckboxLine[] {
  const lines = content.split('\n');
  const tasks: TaskCheckboxLine[] = [];
  let currentGroupId: string | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (line === undefined) {
      continue;
    }
    const match = line.match(/^(\s*)- \[(x| )]\s+\*{0,2}(\d+\.\d+)\*{0,2}\s+(.+)$/);
    if (!match) continue;

    const indent = match[1].length;
    const done = match[2] === 'x';
    const id = match[3];
    const title = match[4].trim();
    const depth = indent > 0 ? 1 : 0;
    if (depth === 0) {
      currentGroupId = id;
    }
    tasks.push({
      id,
      title,
      done,
      parentId: depth === 0 ? null : currentGroupId,
      depth,
      lineIndex,
      lineText: line,
    });
  }
  return tasks;
}

const RECONCILED_PART = /^\d+\.\d+:[01]$/;

/** Serialize a reconciled id→done map: `1.0:1,1.1:0,2.0:1` (ids sorted with numeric sort). */
export function serializeTaskCheckboxReconciled(
  m: ReadonlyMap<string, boolean> | Readonly<Record<string, boolean>>,
): string {
  const entries = m instanceof Map ? [...m.entries()] : Object.entries(m);
  return entries
    .filter(([k, v]) => typeof v === 'boolean' && k.includes('.'))
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([k, v]) => `${k}:${v ? 1 : 0}`)
    .join(',');
}

export function parseTaskCheckboxReconciled(s: string | undefined): Map<string, boolean> {
  const m = new Map<string, boolean>();
  if (!s?.trim()) return m;
  for (const part of s.split(/[,;]/)) {
    const p = part.trim();
    if (!p || !RECONCILED_PART.test(p)) continue;
    const [id, b] = p.split(':') as [string, string];
    m.set(id, b === '1');
  }
  return m;
}

/**
 * Apply new done states to matching `N.M` task lines; preserves non-matching lines and all other text.
 */
export function applyTaskCheckboxStateMap(
  content: string,
  idToDone: ReadonlyMap<string, boolean>,
): string {
  if (idToDone.size === 0) return content;
  return content
    .split('\n')
    .map((line) => {
      const m2 = line.match(/^(\s*)- \[(x| )]\s+\*{0,2}(\d+\.\d+)\*{0,2}\s+(.+)$/);
      if (!m2) return line;
      const id = m2[3];
      if (!idToDone.has(id)) return line;
      const want = idToDone.get(id) ? 'x' : ' ';
      return line.replace(/- \[(x| )]/, `- [${want}]`);
    })
    .join('\n');
}
