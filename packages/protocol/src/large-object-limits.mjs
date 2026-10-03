/** Canonical resource limits; dependency-free for generated CLI projections. */
export const LARGE_OBJECT_LIMITS = Object.freeze({
  uniqueHtmlBytes: 100 * 1024 * 1024,
  decodedBytes: 128 * 1024 * 1024,
  catalogBytes: 8 * 1024 * 1024,
  manifestBytes: 64 * 1024,
  chunkBytes: 1024 * 1024,
  chunkPlaintextBytes: 1024 * 1024 - 16,
  chunks: 129,
  ciphertextBytes: 128 * 1024 * 1024 + 129 * 16,
  sources: 256,
  views: 4096,
  resources: 1024,
  eventBytes: 256 * 1024,
  eventPageBytes: 1024 * 1024,
  eventPageCount: 100,
});
