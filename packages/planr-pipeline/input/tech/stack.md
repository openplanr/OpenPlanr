# stack.md — Project Technical Configuration

> **Owner:** Tech Lead
> **Purpose:** Single source of truth for technology choices. Read by every agent.
>
> **Note for this codebase:** planr-pipeline is a portable Node ESM engine with
> runtime-native adapters and generated browser assets. The artifact engine has
> pinned runtime dependencies for standards-based HTML parsing, deterministic
> local bundling, and browser-compatible raw DEFLATE. The base conformance runner
> remains dependency-free for operators.

---

## Project Identity

```yaml
schemaVersion: "1.0.0"
AppName: "planr-pipeline"
Version: "0.28.2"
Description: "Portable OpenPlanr PO, Design, Review, DEV, QA, artifact review, and delivery pipeline (Protocol v1.0 artifacts + v1.1 capabilities)"
Repository: "https://github.com/openplanr/planr-pipeline"
```

---

## Database

```yaml
DatabaseType: ""          # not applicable — plugin has no DB
DatabaseHost: ""
DatabasePort: ""
DatabaseName: ""
DatabaseUser: ""
DatabasePassword: ""
ORM: ""
MigrationTool: ""
```

---

## Backend Stack

```yaml
Language: "JavaScript (Node ESM)"
Framework: "Portable Node engine with runtime adapters and loopback artifact-review server"
RuntimeVersion: "Node 20+"
AuthStrategy: ""
APIStyle: ""
TestFramework: "node:test; Playwright browser security/visual coverage"
```

---

## Frontend Stack

```yaml
UIFramework: "Generated dependency-free browser shell; sandboxed artifact iframe"
CSSStrategy: "Generated CSS custom properties from registry/artifact-theme.json"
ComponentLibrary: "Portable artifact shell primitives under lib/artifact/ui/"
StateManagement: "Immutable Protocol v1.1 review state and event-driven controllers"
FormLibrary: ""
HTTPClient: "Web Fetch API with ciphertext-only paste client"
```

---

## DevOps / Infrastructure

```yaml
ContainerRuntime: ""      # distributed through npm plus runtime-native adapters
Orchestration: ""
CIProvider: "GitHub Actions"
CloudProvider: "Cloudflare Worker/KV is a downstream hosted-viewer deployment; not required locally"
SecretManagement: "AES-256-GCM key remains client-side in URL fragment; no package telemetry"
```

---

## Code Conventions

```yaml
NamingConvention:
  Files: "kebab-case"
  Components: ""
  Functions: "camelCase"
  Constants: "UPPER_SNAKE_CASE"
  Database:
    Tables: ""
    Columns: ""

FolderStructure: "domain-based (lib/artifact/, lib/pipeline/, agents/, commands/, docs/, schemas/, templates/, conformance/)"
TestCoverage: "unit, integration, protocol conformance, packed-install, browser security, and visual regression"
```

---

## Build & Test Commands (used by DEV agents' correction loop)

> There is no compiled application build. Generated artifact-shell assets must
> be current. Tier-1/Tier-2 tests run via `npm test`; focused artifact and
> conformance scripts are release gates.

```yaml
BuildCommand: "npm run check:artifact-shell && node --check conformance/runner.mjs && node --check conformance/json-schema-validate.mjs"
TestCommand: "npm test"
LintCommand: ""
TypeCheckCommand: ""
```

---

## Active Stack Overlays

> The package ships defaults under its logical `stacks/` asset root. Each
> runtime adapter resolves that root without exposing a runtime-specific path;
> project-local stack overlays win on filename collision. This codebase has no
> active framework stack overlays.

```yaml
ActiveStackFiles: []
```

---

## Exclusions / Constraints

```yaml
DoNotUse:
  - "Third-party npm packages in conformance/runner.mjs (stdlib only — preserves zero-dep posture)"
  - "TypeScript or compiled build steps for the plugin itself"
  - "Remote artifact dependencies, plaintext short-link storage, or allow-same-origin artifact sandboxes"
  - "Runtime skills invoking a globally installed planr-pipeline binary; use planr artifact"

MustPreserve:
  - "agents/*.md YAML frontmatter `tools:` field — manifest-enforced security boundary"
  - "schemas/v1.0.0/ as the canonical v1.0.0 protocol schema source"
  - "conformance/expected/*.json fixture goldens"
  - "registry/artifact-theme.json and docs/artifact-review-approval.md after human design approval"
  - "Protocol v1.0 planning schemas while adding optional v1.1 artifact contracts"
```

---

## Runtime Dependencies

```text
Dependencies:
  parse5: "8.0.1 — standards-based HTML parse/serialize"
  esbuild: "0.28.1 — deterministic local-only JS/module/CSS graph bundling"
  pako: "2.1.0 — Node/browser raw-DEFLATE parity"
DevDependencies:
  playwright: "1.61.1 — browser interaction and sandbox verification"
  pixelmatch: "7.2.0 — visual regression comparison"
  pngjs: "7.0.0 — PNG snapshot IO"
```

## Artifact Review Gates

```text
ArtifactUnitCommand: "npm run test:artifact"
ArtifactBrowserCommand: "npm run test:artifact:browser"
ArtifactContractCommand: "npm run test:artifact:contracts"
ArtifactShareCommand: "npm run test:artifact:share"
ArtifactConformanceCommand: "npm run conformance:artifact-review"
PackageSmokeCommand: "node --test tests/pipeline/artifact-packed-install.test.mjs"
```

---

*Read by: every subagent in the planr-pipeline plugin.*
*Updated by: Tech Lead only.*
