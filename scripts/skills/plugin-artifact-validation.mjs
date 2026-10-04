import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
} from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

export const PLUGIN_CHECKLIST_URL = 'https://claude.com/docs/plugins/pre-submission-checklist';
export const PLUGIN_ARTIFACT_LIMITS = Object.freeze({
  files: 512,
  textBytes: 256 * 1024,
  fileBytes: 5 * 1024 * 1024,
});

const utf8 = new TextDecoder('utf-8', { fatal: true });
const imageExtensions = new Map([
  ['.png', 'png'],
  ['.jpg', 'jpeg'],
  ['.jpeg', 'jpeg'],
  ['.gif', 'gif'],
  ['.webp', 'webp'],
]);
const fontExtensions = new Map([
  ['.ttf', 'truetype'],
  ['.otf', 'opentype'],
  ['.woff', 'woff'],
  ['.woff2', 'woff2'],
]);
const binaryExtensions = new Set([
  '.wasm',
  '.pdf',
  '.ico',
  '.zip',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.node',
  '.pyc',
  '.pyo',
  '.class',
  '.mcpb',
  '.dxt',
]);

function starts(bytes, signature) {
  return bytes.subarray(0, signature.length).equals(Buffer.from(signature));
}

function binaryFormat(bytes) {
  if (starts(bytes, [0x7f, 0x45, 0x4c, 0x46])) return 'elf';
  if (starts(bytes, [0x4d, 0x5a])) return 'pe';
  if (starts(bytes, [0, 0x61, 0x73, 0x6d])) return 'webassembly';
  if (starts(bytes, [0x50, 0x4b, 3, 4]) || starts(bytes, [0x50, 0x4b, 5, 6])) return 'zip';
  if (starts(bytes, [0x1f, 0x8b])) return 'gzip';
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  if (starts(bytes, [0, 0, 1, 0])) return 'icon';
  if (starts(bytes, [0xca, 0xfe, 0xba, 0xbe])) return 'java-or-mach-o';
  if (
    [
      [0xfe, 0xed, 0xfa, 0xce],
      [0xce, 0xfa, 0xed, 0xfe],
      [0xfe, 0xed, 0xfa, 0xcf],
      [0xcf, 0xfa, 0xed, 0xfe],
      [0xbe, 0xba, 0xfe, 0xca],
      [0xca, 0xfe, 0xba, 0xbf],
      [0xbf, 0xba, 0xfe, 0xca],
    ].some((signature) => starts(bytes, signature))
  )
    return 'mach-o';
  if (starts(bytes, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0])) return 'xz';
  if (starts(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7zip';
  if (starts(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 7])) return 'rar';
  if (bytes.subarray(257, 262).toString('ascii') === 'ustar') return 'tar';
  return null;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function completePng(bytes) {
  let offset = 8;
  let header = false;
  let pixels = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/u.test(type)) return false;
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return false;
    if (!header) {
      if (type !== 'IHDR' || length !== 13) return false;
      if (!bytes.readUInt32BE(offset + 8) || !bytes.readUInt32BE(offset + 12)) return false;
      const depth = bytes[offset + 16];
      const color = bytes[offset + 17];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (
        !depths[color]?.includes(depth) ||
        bytes[offset + 18] ||
        bytes[offset + 19] ||
        bytes[offset + 20] > 1
      )
        return false;
      header = true;
    } else if (type === 'IHDR') return false;
    if (type === 'IDAT') pixels = true;
    if (type === 'IEND') return length === 0 && pixels && end === bytes.length;
    offset = end;
  }
  return false;
}

function completeJpeg(bytes) {
  let offset = 2;
  let frame = false;
  let scan = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9) return frame && scan && offset === bytes.length;
    if (marker === 0xd8 || marker === undefined || marker === 0) return false;
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8 || !bytes.readUInt16BE(offset + 3) || !bytes.readUInt16BE(offset + 5))
        return false;
      frame = true;
    }
    offset += length;
    if (marker !== 0xda) continue;
    if (!frame || length < 6) return false;
    scan = true;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const next = bytes[offset + 1];
      if (next === 0 || (next >= 0xd0 && next <= 0xd7)) {
        offset += 2;
        continue;
      }
      break;
    }
  }
  return false;
}

function completeGif(bytes) {
  if (bytes.length < 14 || !bytes.readUInt16LE(6) || !bytes.readUInt16LE(8)) return false;
  let offset = 13 + (bytes[10] & 0x80 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0);
  let image = false;
  const skipBlocks = () => {
    while (offset < bytes.length) {
      const length = bytes[offset++];
      if (!length) return true;
      if (offset + length > bytes.length) return false;
      offset += length;
    }
    return false;
  };
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) return image && offset === bytes.length;
    if (marker === 0x21) {
      if (offset >= bytes.length) return false;
      offset += 1;
      if (!skipBlocks()) return false;
    } else if (marker === 0x2c) {
      if (
        offset + 9 > bytes.length ||
        !bytes.readUInt16LE(offset + 4) ||
        !bytes.readUInt16LE(offset + 6)
      )
        return false;
      const packed = bytes[offset + 8];
      offset += 9 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
      if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset++] > 8) return false;
      if (!bytes[offset] || !skipBlocks()) return false;
      image = true;
    } else return false;
  }
  return false;
}

function completeWebp(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length) return false;
  let offset = 12;
  let pixels = false;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    if (end > bytes.length) return false;
    if (type === 'VP8 ') {
      if (length < 10 || bytes.toString('hex', offset + 11, offset + 14) !== '9d012a') return false;
      if (
        !(bytes.readUInt16LE(offset + 14) & 0x3fff) ||
        !(bytes.readUInt16LE(offset + 16) & 0x3fff)
      )
        return false;
      pixels = true;
    } else if (type === 'VP8L') {
      if (length < 5 || bytes[offset + 8] !== 0x2f || bytes[offset + 12] & 0xe0) return false;
      pixels = true;
    } else if (type === 'VP8X' && length !== 10) return false;
    else if (type === 'ANMF') {
      if (length < 24) return false;
      const nested = bytes.subarray(offset + 24, end);
      const riff = Buffer.alloc(12);
      riff.write('RIFF');
      riff.writeUInt32LE(nested.length + 4, 4);
      riff.write('WEBP', 8);
      if (!completeWebp(Buffer.concat([riff, nested]))) return false;
      pixels = true;
    }
    offset = end + (length % 2);
  }
  return pixels && offset === bytes.length;
}

function completeFont(bytes, kind) {
  if (kind === 'woff' || kind === 'woff2') {
    const header = kind === 'woff' ? 44 : 48;
    if (
      bytes.length < header ||
      bytes.readUInt32BE(8) !== bytes.length ||
      !bytes.readUInt16BE(12) ||
      bytes.readUInt16BE(14)
    )
      return false;
    if (!bytes.readUInt32BE(16)) return false;
    if (kind === 'woff2')
      return bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= bytes.length - header;
    const count = bytes.readUInt16BE(12);
    if (header + count * 20 > bytes.length) return false;
    for (let offset = header; offset < header + count * 20; offset += 20) {
      const start = bytes.readUInt32BE(offset + 4);
      const compressed = bytes.readUInt32BE(offset + 8);
      if (
        start < header + count * 20 ||
        start + compressed > bytes.length ||
        compressed > bytes.readUInt32BE(offset + 12)
      )
        return false;
    }
    return true;
  }
  if (bytes.length < 12) return false;
  const count = bytes.readUInt16BE(4);
  if (!count || 12 + count * 16 > bytes.length) return false;
  let head = false;
  for (let offset = 12; offset < 12 + count * 16; offset += 16) {
    const start = bytes.readUInt32BE(offset + 8);
    const length = bytes.readUInt32BE(offset + 12);
    if (start < 12 + count * 16 || start + length > bytes.length) return false;
    if (bytes.toString('ascii', offset, offset + 4) === 'head' && length >= 54) head = true;
  }
  return head;
}

function mediaFormat(bytes) {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return ['png', completePng(bytes)];
  if (starts(bytes, [0xff, 0xd8])) return ['jpeg', completeJpeg(bytes)];
  if (/^GIF8[79]a$/u.test(bytes.subarray(0, 6).toString('ascii')))
    return ['gif', completeGif(bytes)];
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    return ['webp', completeWebp(bytes)];
  const tag = bytes.toString('ascii', 0, 4);
  const kind = starts(bytes, [0, 1, 0, 0])
    ? 'truetype'
    : { OTTO: 'opentype', wOFF: 'woff', wOF2: 'woff2' }[tag];
  return kind ? [kind, completeFont(bytes, kind)] : null;
}

function hasCharacter(text, predicate) {
  for (let index = 0; index < text.length; index += 1)
    if (predicate(text.charCodeAt(index))) return true;
  return false;
}

// Tab, line feed and carriage return are text; other C0 controls and DEL are binary data.
const binaryControl = (code) => (code < 0x20 && ![9, 10, 13].includes(code)) || code === 0x7f;

function validPath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !/^[A-Za-z]:|^\/|\\/u.test(path) &&
    !hasCharacter(path, (code) => code < 0x20) &&
    path
      .split('/')
      .every(
        (part) =>
          part &&
          part !== '.' &&
          part !== '..' &&
          !/[.: ]$/u.test(part) &&
          !/[:?*|<>"]/u.test(part) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      )
  );
}

/** Records a path; returns a finding when it collides on a case-insensitive filesystem. */
function portableConflict(path, names, directories) {
  const parts = path.split('/');
  let finding = null;
  for (let depth = 1; depth < parts.length; depth += 1) {
    const directory = parts.slice(0, depth).join('/');
    const folded = directory.toLowerCase();
    if (names.has(folded))
      finding ??= ['path-conflict', 'A file and a directory cannot share a path.'];
    const recorded = directories.get(folded);
    if (recorded === undefined) directories.set(folded, directory);
    else if (recorded !== directory)
      finding ??= ['duplicate-path', 'Paths must be unique on case-insensitive filesystems.'];
  }
  const folded = path.toLowerCase();
  if (names.has(folded))
    finding ??= ['duplicate-path', 'Paths must be unique on case-insensitive filesystems.'];
  else if (directories.has(folded))
    finding ??= ['path-conflict', 'A file and a directory cannot share a path.'];
  names.set(folded, path);
  return finding;
}

/** Exact bytes of a file below the plugin-file limit; larger files keep only their size. */
function readRegularFile(absolute, path) {
  // A file swapped for a FIFO after lstat must not block the read.
  const descriptor = openSync(
    absolute,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) return { path, type: 'special', mode: stat.mode };
    if (stat.size >= PLUGIN_ARTIFACT_LIMITS.fileBytes)
      return { path, type: 'file', mode: stat.mode, size: stat.size };
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    for (let read = -1; read !== 0 && length < bytes.length; length += read)
      read = readSync(descriptor, bytes, length, bytes.length - length, null);
    if (length !== stat.size) throw new Error(`${path} changed size while it was inspected.`);
    return { path, type: 'file', mode: stat.mode, bytes: bytes.subarray(0, length) };
  } finally {
    closeSync(descriptor);
  }
}

/** Read a plugin directory as inspection entries; links and special files are reported, never followed. */
export function readDirectoryEntries(directory) {
  const root = resolve(directory);
  if (!lstatSync(root).isDirectory())
    throw new Error(`Directory inspection requires a real directory, not a link: ${root}`);
  const entries = [];
  const visit = (current, prefix) => {
    for (const name of readdirSync(current).sort()) {
      const absolute = join(current, name);
      const path = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) visit(absolute, path);
      else if (stat.isFile()) entries.push(readRegularFile(absolute, path));
      else
        entries.push({
          path,
          type: stat.isSymbolicLink() ? 'symlink' : 'special',
          mode: stat.mode,
        });
    }
  };
  visit(root, '');
  return entries;
}

/** Validate portable paths, file formats and size bounds on exact unpacked plugin bytes. */
export function inspectDirectoryEntries(entries) {
  if (!Array.isArray(entries)) throw new TypeError('Directory entries must be an array.');
  const findings = [];
  const files = [];
  const names = new Map();
  const directories = new Map();
  let bytes = 0;
  const fail = (code, path, size, kind, reason) =>
    findings.push({ code, path, size, kind, reason });
  if (entries.length > PLUGIN_ARTIFACT_LIMITS.files)
    fail(
      'file-count',
      null,
      null,
      'inventory',
      `The plugin exceeds ${PLUGIN_ARTIFACT_LIMITS.files} files.`,
    );
  for (const entry of entries) {
    const path = typeof entry?.path === 'string' ? entry.path : null;
    if (!validPath(path)) {
      fail('unsafe-path', path, null, 'entry', 'Use a portable relative file path.');
      continue;
    }
    const conflict = portableConflict(path, names, directories);
    if (conflict) fail(conflict[0], path, null, 'entry', conflict[1]);
    if (
      (entry.type && !['file', 'regular'].includes(entry.type)) ||
      ((entry.mode ?? 0) & 0o170000) === 0o120000
    ) {
      fail(
        'non-regular-entry',
        path,
        null,
        'entry',
        'Only regular files may be packaged; links are not followed.',
      );
      continue;
    }
    if (!(entry.bytes instanceof Uint8Array)) {
      if (Number.isSafeInteger(entry.size) && entry.size >= PLUGIN_ARTIFACT_LIMITS.fileBytes)
        fail('file-size', path, entry.size, 'file', 'Every plugin file must be under 5 MiB.');
      else fail('missing-bytes', path, null, 'entry', 'Inspection requires exact file bytes.');
      continue;
    }
    const content = Buffer.from(entry.bytes);
    const size = content.length;
    bytes += size;
    if (size >= PLUGIN_ARTIFACT_LIMITS.fileBytes)
      fail('file-size', path, size, 'file', 'Every plugin file must be under 5 MiB.');
    if (/(?:^|\/)(?:\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)(?:\/|$)/iu.test(path))
      fail('system-file', path, size, 'file', 'Remove operating-system metadata from the plugin.');
    const extension = extname(path).toLowerCase();
    const binary = binaryFormat(content);
    if (binary || binaryExtensions.has(extension)) {
      fail(
        'unsupported-binary',
        path,
        size,
        binary ?? extension.slice(1),
        'Ship readable source rather than this binary format.',
      );
      files.push({ path, size, kind: binary ?? extension.slice(1) });
      continue;
    }
    const media = mediaFormat(content);
    if (media) {
      const [kind, complete] = media;
      if (!complete)
        fail('malformed-media', path, size, kind, 'The media container is truncated or invalid.');
      if ((imageExtensions.get(extension) ?? fontExtensions.get(extension)) !== kind)
        fail('media-extension', path, size, kind, 'The extension must match the media format.');
      files.push({ path, size, kind });
      continue;
    }
    if (imageExtensions.has(extension) || fontExtensions.has(extension)) {
      fail(
        'malformed-media',
        path,
        size,
        'unknown',
        'The file does not contain its declared media format.',
      );
      files.push({ path, size, kind: 'unknown' });
      continue;
    }
    if (size >= PLUGIN_ARTIFACT_LIMITS.textBytes)
      fail('text-size', path, size, 'text', 'Each non-image/font file must be under 256 KiB.');
    let text;
    try {
      text = utf8.decode(content);
    } catch {
      fail('invalid-text', path, size, 'binary', 'Text must be valid UTF-8.');
    }
    if (text !== undefined) {
      if (hasCharacter(text, binaryControl))
        fail('binary-text', path, size, 'binary', 'Text contains binary control bytes.');
      if (/^version https:\/\/git-lfs\.github\.com\/spec\/v1(?:\r?\n|$)/u.test(text))
        fail(
          'lfs-pointer',
          path,
          size,
          'pointer',
          'Package the real regular file rather than a Git LFS pointer.',
        );
      if (
        /\.[cm]?js$/u.test(extension) &&
        /(?:eval|Function)\s*\(\s*(?:atob\s*\(\s*["'][A-Za-z0-9+/=]{256,}["']|Buffer\.from\s*\(\s*["'][A-Za-z0-9+/=]{256,}["']\s*,\s*["']base64["'])/u.test(
          text,
        )
      )
        fail(
          'encoded-execution',
          path,
          size,
          'javascript',
          'Replace directly executed encoded payloads with readable source.',
        );
    }
    files.push({ path, size, kind: text === undefined ? 'binary' : 'text' });
  }
  return {
    passed: findings.length === 0,
    checklist: PLUGIN_CHECKLIST_URL,
    fileCount: entries.length,
    bytes,
    files,
    findings,
  };
}

export function assertDirectoryEntries(entries) {
  const report = inspectDirectoryEntries(entries);
  if (!report.passed) {
    const error = new Error(
      `Plugin artifact validation failed:\n${report.findings
        .map(
          ({ code, path, size, reason }) =>
            `- ${code}: ${path ?? '(inventory)'}${size === null ? '' : ` (${size} bytes)`}: ${reason}`,
        )
        .join('\n')}`,
    );
    error.code = 'E_PLUGIN_ARTIFACT_INVALID';
    error.report = report;
    throw error;
  }
  return report;
}
