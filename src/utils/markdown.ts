import YAML from 'yaml';
import type { ArtifactFrontmatter } from '../models/types.js';

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
