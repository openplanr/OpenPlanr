# ADR-005: Artifact Review, Bundling, and Sharing Security Boundary

## Status

Accepted

## Context

OpenPlanr artifact review executes project-authored HTML while keeping local and
remote review deterministic, portable, and private. HTML is not a flat file:
stylesheets, module graphs, fonts, images, SVG, and responsive sources can all
cross filesystem or network boundaries. Regex-only rewriting cannot safely
model that graph, and a digest is useful only when every producer hashes the
same bytes.

The remote short-link service must not become a plaintext artifact store. The
local and hosted viewers must also assume artifact scripts are hostile even
when those scripts are useful and intentionally interactive.

## Decision

### Parsing and dependency graph

- Pin `parse5@8.0.1` as the HTML parser and serializer.
- Pin `esbuild@0.28.1` for statically resolvable local JavaScript/module and CSS
  graphs. A local-only resolver rejects remote, protocol-relative, absolute,
  bare, unresolved, and nonliteral imports.
- Resolve lexical paths beneath the configured root, follow the final realpath,
  and reject symlink escape. Files are read through one accounting layer, once
  per final realpath, with limits of 1,000 unique files and 10 MiB decoded input.
- Enforce a separate immutable 10 MiB generated-output budget while references
  are rewritten, then verify the exact serialized UTF-8 byte length. Repeated
  references therefore cannot amplify a small input graph into an unbounded
  artifact before envelope validation.
- Esbuild emits binary dependencies as deterministic bounded placeholders,
  never as expanded data URLs. The bundler counts every placeholder occurrence,
  verifies that count against esbuild metadata, reserves its exact base64 size,
  and substitutes only after the complete output is proven beneath the cap. The
  reserved placeholder namespace is forbidden in source. `srcset` candidates
  and nested SVG rewrites reserve against the same fixed ceiling before joins or
  serialization.
- Reject forms, navigation targets, external resources, machine paths,
  repository remotes, environment references, and recognized secret material.
  Data-URI module/import rules, SVG SMIL mutation, and SVG base-URL attributes
  are also rejected rather than delegated to runtime policy.
- Supported binary assets become data URLs; content hashes deduplicate graph
  accounting and provide stable asset records.

### Canonicalization and digests

- Normalize text to UTF-8 without BOM and LF line endings.
- Canonical JSON recursively orders object fields, emits no insignificant
  whitespace, and preserves array order because artifact/variant order is
  product state.
- An artifact SHA-256 is calculated over its canonical bundled HTML bytes.
- `reviewOf` is SHA-256 over the canonical envelope containing
  `schemaVersion`, ordered `artifacts`, and `viewer`, explicitly excluding
  `review`. Adding feedback can therefore never change the reviewed identity.
- Protocol v1.1 adds artifact schemas without modifying Protocol v1.0 schemas
  or existing design-feedback files.

### Execution sandbox

- Artifact HTML renders only in an opaque-origin iframe with exactly
  `sandbox="allow-scripts"`; `allow-same-origin`, forms, navigation, popups,
  downloads, and storage permissions are not granted.
- The embedding document allows artifact frames only from generated Blob URLs.
  The artifact receives an early CSP that blocks network connections, forms,
  base URLs, objects, and nested frames while allowing only packaged data/blob
  assets needed for local interaction.
- Hosted viewers deliver CSP, no-referrer, no-store, and noindex controls as
  response headers. Meta-delivered policies are an offline defense, not a
  replacement for response headers.

### Private sharing and storage

- Fragment shares contain compressed payload bytes after `#`; fragments are
  not sent in HTTP requests. They are encoded, not encrypted.
- Large shares compress before AES-256-GCM encryption. The random 256-bit key
  exists only in the URL fragment. The service receives only version, IV,
  ciphertext, expiry, size, and a deletion-token hash.
- Short shares are immutable, expire after an allowed 1/7/30-day TTL, and are
  deleted with a one-time bearer token. The service returns generic errors and
  does not log payloads, keys, ciphertext, or tokens.

## Consequences

- Bundling is asynchronous and requires Node.js 20 or newer.
- Unsupported or ambiguous dependency forms fail closed rather than producing
  a partially self-contained artifact.
- Identical supported inputs produce identical bundled bytes and digests across
  supported operating systems and Node versions.
- Dynamic artifact interaction remains possible, but network-dependent apps
  must provide an offline review build.
- The Cloudflare Worker and hosted shell remain downstream consumers of the
  package contracts; they cannot redefine canonical bytes or weaken storage and
  sandbox controls.

## Verification

- Positive fixtures cover classic/module scripts, recursive CSS, images, SVG,
  fonts, `srcset`, and duplicate content.
- Negative fixtures cover traversal, symlink escape, remote resources, forms,
  unresolved dependencies, bare/nonliteral imports, file/byte limits, and
  machine-data redaction.
- Schema fixtures and Web Crypto tests prove that Node and browser SHA-256 use
  identical canonical bytes.
- Browser hostile-artifact tests verify internal interaction while outbound
  requests, navigation, persistence, popups, and parent access fail.
