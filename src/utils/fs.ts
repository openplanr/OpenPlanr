import { mkdir, writeFile as fsWriteFile, readFile as fsReadFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await fsWriteFile(filePath, content, 'utf-8');
}

export async function readFile(filePath: string): Promise<string> {
  return fsReadFile(filePath, 'utf-8');
}

export async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true).catch(() => false);
}

export async function listFiles(dirPath: string, pattern?: RegExp): Promise<string[]> {
  const exists = await access(dirPath).then(() => true).catch(() => false);
  if (!exists) return [];

  const entries = await readdir(dirPath);
  if (pattern) {
    return entries.filter((e) => pattern.test(e));
  }
  return entries;
}
