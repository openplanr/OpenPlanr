import { lstatSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { assertPlanningNode } from '../graph-engine.mjs';
import { findPlanningArtifactSource, readPlanningArtifactNode } from '../graph-reader.mjs';
import {
  PLANNING_FILE_LINK_ERROR_CODES,
  validPlanningFilePath,
} from '../planning-file-link-contracts.mjs';

export function declaredPlanningFiles(node) {
  const paths = new Set();
  let inFiles = false;
  let filesDepth = 0;
  let fence = null;
  let comment = false;
  const lines = (node.body ?? '').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (comment || line.includes('<!--')) {
      comment = !line.includes('-->');
      continue;
    }
    if (/^(?: {4}|\t)/u.test(line)) continue;
    const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        /^\s*(?:`+|~+)\s*$/u.test(line)
      )
        fence = null;
      continue;
    }
    if (fence !== null) continue;
    // Raw HTML can hide apparent Markdown lists, so later text cannot grant file access.
    if (/^ {0,3}<(?:[A-Za-z!]|\?)/u.test(line)) break;
    if (line.trim() && /^\s{0,3}(?:=+|-+)\s*$/u.test(lines[index + 1] ?? '')) {
      inFiles = false;
      continue;
    }
    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (heading) {
      if (/^Files$/iu.test(heading[2])) {
        inFiles = true;
        filesDepth = heading[1].length;
      } else if (heading[1].length <= filesDepth) inFiles = false;
      continue;
    }
    if (!inFiles) continue;
    const item = /^\s*[-*+]\s+(?:`([^`]+)`|([^\s`]+))\s*$/u.exec(line);
    const path = item?.[1] ?? item?.[2];
    if (validPlanningFilePath(path)) paths.add(path);
  }
  return paths;
}

function contained(root, target) {
  const child = relative(root, target);
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function fileLinkError(error) {
  return {
    state: 'error',
    reason: 'The declared file could not be checked.',
    errorCode: PLANNING_FILE_LINK_ERROR_CODES.includes(error?.code) ? error.code : 'UNKNOWN',
  };
}

function inspectPlanningFile(projectRoot, path) {
  const unavailable = (reason) => ({
    state: 'unavailable',
    reason,
    errorCode: null,
    canonicalPath: null,
  });
  try {
    const root = realpathSync(projectRoot);
    const target = resolve(root, path);
    if (!contained(root, target)) return unavailable('The file path escapes the project.');
    // Check each existing parent even when the leaf is missing or a dangling symlink.
    let current = root;
    const parts = relative(root, target).split(sep);
    for (let index = 0; index < parts.length; index += 1) {
      current = resolve(current, parts[index]);
      try {
        const entry = lstatSync(current);
        const real = realpathSync(current);
        if (!contained(root, real)) return unavailable('The file resolves outside the project.');
        if (index < parts.length - 1 && !statSync(real).isDirectory())
          return unavailable('A file parent is not a directory.');
        if (entry.isSymbolicLink()) current = real;
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
          return unavailable(
            'The declared file does not exist. Copy its path to locate it manually.',
          );
        throw error;
      }
    }
    const canonical = realpathSync(current);
    if (!contained(root, canonical)) return unavailable('The file resolves outside the project.');
    if (!statSync(canonical).isFile())
      return unavailable('The declared path is not a regular file.');
    return { state: 'available', reason: null, errorCode: null, canonicalPath: canonical };
  } catch (error) {
    return { ...fileLinkError(error), canonicalPath: null };
  }
}

export function resolvePlanningFileLink(projectRoot, path) {
  const { canonicalPath, ...result } = inspectPlanningFile(projectRoot, path);
  const encoded = canonicalPath?.split(sep).filter(Boolean).map(encodeURIComponent).join('/');
  return { ...result, editorUrl: encoded ? `vscode://file/${encoded}` : null };
}

export function readPlanningFileLinkArtifact(planrDir, summary) {
  const source = findPlanningArtifactSource(planrDir, summary.id);
  const unavailable = () => ({
    detail: null,
    result: {
      state: 'unavailable',
      reason:
        'The selected artifact source is unavailable. Refresh its detail before requesting a file link.',
      errorCode: null,
      editorUrl: null,
    },
  });
  if (!source) return unavailable();
  const projectRoot = dirname(planrDir);
  const sourcePath = relative(projectRoot, source).split(sep).join('/');
  if (!validPlanningFilePath(sourcePath)) return unavailable();
  const { canonicalPath, ...result } = inspectPlanningFile(projectRoot, sourcePath);
  if (!canonicalPath) return { detail: null, result: { ...result, editorUrl: null } };
  // Only the selected artifact supplies declarations; target file bodies are never opened.
  const sourceRoot = resolve(dirname(canonicalPath), relative(dirname(source), planrDir));
  let value;
  try {
    value = readPlanningArtifactNode(canonicalPath, sourceRoot);
  } catch (error) {
    return { detail: null, result: { ...fileLinkError(error), editorUrl: null } };
  }
  if (!value) return unavailable();
  const node = assertPlanningNode(value, summary.id);
  return { detail: { node, sourcePath }, result: null };
}
