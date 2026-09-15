import { SkillRuntimeError } from '../errors.mjs';

const UTF8 = 0x0800;
const STORE = 0;
const DOS_DATE_1980_01_01 = 0x0021;

const CRC_TABLE = Object.freeze(Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
}));

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function safePath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') || path.includes('\\')) {
    throw new SkillRuntimeError('E_SKILL_ARCHIVE_PATH_INVALID', 'Archive entries must use non-empty package-relative POSIX paths.', { path });
  }
  const parts = path.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new SkillRuntimeError('E_SKILL_ARCHIVE_PATH_INVALID', 'Archive entries must not contain empty or traversal path segments.', { path });
  }
  return path;
}

/** Create a byte-stable, store-only ZIP without timestamps, extras, or platform metadata drift. */
export function createDeterministicZip(entries) {
  const normalized = entries.map(({ path, bytes, mode = 0o644 }) => ({
    path: safePath(path),
    bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8'),
    mode: (mode & 0o111) !== 0 ? 0o755 : 0o644,
  })).sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(normalized.map(({ path }) => path)).size !== normalized.length) {
    throw new SkillRuntimeError('E_SKILL_ARCHIVE_PATH_DUPLICATE', 'Archive entries must have unique paths.');
  }
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of normalized) {
    const name = Buffer.from(entry.path, 'utf8');
    const crc = crc32(entry.bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(UTF8, 6);
    header.writeUInt16LE(STORE, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(entry.bytes.length, 18);
    header.writeUInt32LE(entry.bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, entry.bytes);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(0x0314, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(UTF8, 8);
    directory.writeUInt16LE(STORE, 10);
    directory.writeUInt16LE(0, 12);
    directory.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(entry.bytes.length, 20);
    directory.writeUInt32LE(entry.bytes.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt16LE(0, 30);
    directory.writeUInt16LE(0, 32);
    directory.writeUInt16LE(0, 34);
    directory.writeUInt16LE(0, 36);
    directory.writeUInt32LE(((0o100000 | entry.mode) << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + entry.bytes.length;
  }

  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(normalized.length, 8);
  end.writeUInt16LE(normalized.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...local, centralBytes, end]);
}

/** Read archives emitted by createDeterministicZip for isolated install proofs. */
export function readDeterministicZip(archive) {
  const bytes = Buffer.isBuffer(archive) ? archive : Buffer.from(archive);
  if (bytes.length < 22 || bytes.readUInt32LE(bytes.length - 22) !== 0x06054b50) {
    throw new SkillRuntimeError('E_SKILL_ARCHIVE_INVALID', 'Archive has no deterministic ZIP end record.');
  }
  const count = bytes.readUInt16LE(bytes.length - 12);
  let cursor = bytes.readUInt32LE(bytes.length - 6);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new SkillRuntimeError('E_SKILL_ARCHIVE_INVALID', 'Archive central directory is invalid.', { index });
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const path = safePath(bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'));
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new SkillRuntimeError('E_SKILL_ARCHIVE_INVALID', 'Archive local entry is invalid.', { path });
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const content = bytes.subarray(start, start + size);
    if (crc32(content) !== bytes.readUInt32LE(cursor + 16)) throw new SkillRuntimeError('E_SKILL_ARCHIVE_CRC', `Archive content is corrupt for ${path}.`, { path });
    entries.push(Object.freeze({
      path,
      bytes: Buffer.from(content),
      mode: ((externalAttributes >>> 16) & 0o111) !== 0 ? 0o755 : 0o644,
    }));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return Object.freeze(entries);
}
