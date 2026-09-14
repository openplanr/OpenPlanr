import { existsSync, realpathSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

export function isPathContained(base, candidate) {
  const rel = relative(base, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/** Resolve lexically beneath base without following the candidate's final symlink. */
export function resolveContainedPath(base, rel) {
  const realBase = realpathSync(base);
  const candidate = resolve(realBase, rel);
  if (!isPathContained(realBase, candidate)) throw new Error('path traversal blocked');
  return { realBase, candidate };
}

/** Resolve and follow the final path, then prove it still belongs to the real root. */
export function resolveContainedRealPath(base, rel) {
  const { realBase, candidate } = resolveContainedPath(base, rel);
  const realCandidate = realpathSync(candidate);
  if (!isPathContained(realBase, realCandidate)) throw new Error('symlink escape blocked');
  return { realBase, candidate, realPath: realCandidate };
}

export function safeResolve(base, rel) {
  return resolveContainedPath(base, rel).candidate;
}

export function serveStaticFile(res, baseDir, relPath, mimeMap) {
  if (!existsSync(baseDir)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'directory not found' }));
    return false;
  }
  const rel = relPath && relPath !== '/' ? relPath.replace(/^\/+/, '') : 'index.html';
  let abs;
  try {
    abs = safeResolve(baseDir, rel);
  } catch (e) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: e.message }));
    return false;
  }
  if (!existsSync(abs)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: `not found: ${rel}` }));
    return false;
  }
  try {
    abs = resolveContainedRealPath(baseDir, rel).realPath;
  } catch (e) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: e.message }));
    return false;
  }
  res.writeHead(200, {
    'content-type': mimeMap[extname(abs).toLowerCase()] ?? 'application/octet-stream',
  });
  res.end(readFileSync(abs));
  return true;
}
