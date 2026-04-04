import matter from 'gray-matter';
import type { ArtifactFrontmatter } from '../models/types.js';

export interface ParsedMarkdown {
  data: ArtifactFrontmatter;
  content: string;
}

export function parseMarkdown(raw: string): ParsedMarkdown {
  // gray-matter returns Record<string, unknown>; we cast to ArtifactFrontmatter
  // which is safe because the index signature accepts extra fields.
  const { data, content } = matter(raw);
  return { data: data as ArtifactFrontmatter, content };
}

export function toMarkdownWithFrontmatter(data: ArtifactFrontmatter, content: string): string {
  return matter.stringify(content, data);
}
