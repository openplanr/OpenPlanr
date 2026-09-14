import { jcsHash, serializeJcs } from "./closed-json-contract.mjs";

/** Browser-safe RFC 8785 serialization for already-parsed closed JSON data. */
export const canonicalizeJson = serializeJcs;

/** Browser-safe SHA-256 commitment over RFC 8785 JSON bytes. */
export const sha256Jcs = jcsHash;
