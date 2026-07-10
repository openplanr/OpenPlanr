import { existsSync, realpathSync, readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

export function safeResolve(base, rel) {
  const realBase = realpathSync(base);
  const abs = resolve(realBase, rel);
  if (abs !== realBase && !abs.startsWith(realBase + sep)) {
    throw new Error('path traversal blocked');
  }
  return abs;
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
  res.writeHead(200, {
    'content-type': mimeMap[extname(abs).toLowerCase()] ?? 'application/octet-stream',
  });
  res.end(readFileSync(abs));
  return true;
}
