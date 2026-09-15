/** Normalize generated text, while preserving opaque assets byte for byte. */
export function resourceBytes(value) {
  return Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value)
    : Buffer.from(String(value).replace(/\r\n/gu, '\n'), 'utf8');
}
