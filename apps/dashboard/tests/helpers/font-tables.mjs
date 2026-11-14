import assert from 'node:assert/strict';
import { brotliDecompressSync } from 'node:zlib';

const tags = [
  'cmap',
  'head',
  'hhea',
  'hmtx',
  'maxp',
  'name',
  'OS/2',
  'post',
  'cvt ',
  'fpgm',
  'glyf',
  'loca',
  'prep',
  'CFF ',
  'VORG',
  'EBDT',
  'EBLC',
  'gasp',
  'hdmx',
  'kern',
  'LTSH',
  'PCLT',
  'VDMX',
  'vhea',
  'vmtx',
  'BASE',
  'GDEF',
  'GPOS',
  'GSUB',
  'EBSC',
  'JSTF',
  'MATH',
  'CBDT',
  'CBLC',
  'COLR',
  'CPAL',
  'SVG ',
  'sbix',
  'acnt',
  'avar',
  'bdat',
  'bloc',
  'bsln',
  'cvar',
  'fdsc',
  'feat',
  'fmtx',
  'fvar',
  'gvar',
  'hsty',
  'just',
  'lcar',
  'mort',
  'morx',
  'opbd',
  'prop',
  'trak',
  'Zapf',
  'Silf',
  'Glat',
  'Gloc',
  'Feat',
  'Sill',
];

export function fontTable(bytes, requested) {
  assert.equal(bytes.toString('ascii', 0, 4), 'wOF2');
  assert.notEqual(bytes.toString('ascii', 4, 8), 'ttcf', 'Expected a single font');
  let offset = 48;
  const uintBase128 = () => {
    let value = 0;
    for (let index = 0; index < 5; index += 1) {
      const byte = bytes.readUInt8(offset);
      offset += 1;
      assert(!(index === 0 && byte === 0x80), 'Invalid table length');
      value = value * 128 + (byte & 0x7f);
      assert(value <= 0xffffffff, 'Table length overflow');
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error('Invalid table length');
  };
  const entries = [];
  for (let index = 0; index < bytes.readUInt16BE(12); index += 1) {
    const flags = bytes.readUInt8(offset);
    offset += 1;
    let tag = tags[flags & 63];
    if ((flags & 63) === 63) {
      tag = bytes.toString('ascii', offset, offset + 4);
      offset += 4;
    }
    const originalLength = uintBase128();
    const transform = flags >>> 6;
    const transformed = tag === 'glyf' || tag === 'loca' ? transform !== 3 : transform !== 0;
    const length = transformed ? uintBase128() : originalLength;
    entries.push({ tag, length, transformed });
  }
  const data = brotliDecompressSync(bytes.subarray(offset, offset + bytes.readUInt32BE(20)));
  let tableOffset = 0;
  for (const { tag, length, transformed } of entries) {
    if (tag === requested) {
      assert(!transformed, `Cannot inspect transformed ${tag}`);
      assert(tableOffset + length <= data.length);
      return data.subarray(tableOffset, tableOffset + length);
    }
    tableOffset += length;
  }
  throw new Error(`Font has no ${requested} table`);
}

export function variationAxes(bytes) {
  const table = fontTable(bytes, 'fvar');
  const offset = table.readUInt16BE(4);
  const axisSize = table.readUInt16BE(10);
  return Array.from({ length: table.readUInt16BE(8) }, (_, index) => {
    const start = offset + index * axisSize;
    return {
      tag: table.toString('ascii', start, start + 4),
      min: table.readInt32BE(start + 4) / 65536,
      default: table.readInt32BE(start + 8) / 65536,
      max: table.readInt32BE(start + 12) / 65536,
    };
  });
}
