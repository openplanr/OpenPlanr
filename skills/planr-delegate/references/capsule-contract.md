# Delegation context capsule v1

`context.mjs` is an internal, Node 20+ package resource. It gathers **work context** only. It does not select a profile, grant a writable path, launch an agent, or authorize publication. The orchestrator must show `previewContextCapsule` alongside the selected writable repository, enrolled profile, and verified destination before dispatch.

## API

```js
import {
  buildContextCapsule,
  previewContextCapsule,
  resolvePlanningArtifact,
  writeContextCapsule,
  CapsuleError,
} from './context.mjs';

const capsule = await buildContextCapsule({
  repositoryRoot: '/absolute/source/checkout',
  taskSelector: 'T-123', // alternatively: request: 'Implement ...'
  selectedFiles: ['src/related.mjs', { path: 'test/related.test.mjs', required: true }],
  optionalFiles: ['docs/background.md'],
  readOnlyRepositories: [{ repositoryKey: 'contracts', root: '/absolute/other/repo' }],
});
const preview = previewContextCapsule(capsule);
const file = await writeContextCapsule(capsule, {
  directory: '/private/per-user/run/capsule', // fresh directory, outside the source checkout
  repositoryRoot: '/absolute/source/checkout',
});
```

The caller selects relevant code and tests; the helper does not guess files from keywords. `resolvePlanningArtifact(root, selector, kind)` accepts an exact ID or a repository-relative artifact path. It searches spec-driven `.planr/specs/SPEC-*/tasks/`, legacy `.planr/tasks/`, and `.planr/quick/` for tasks. Zero or multiple matches throw `CapsuleError` with `searched` and `candidates`. A path selector must still be inside a known artifact directory and have a matching frontmatter ID. A broken declared parent, dependency, ADR, or specification source blocks assembly.

For each `dependsOn` task, the full dependency artifact is copied. If that artifact declares `producedInterfaces` as a list of repository-relative file paths, those interface files are required and copied as well. The orchestrator selects any additional relevant implementation files and tests explicitly.

The physical `.planr` root may be a trusted symlink to a shared planning store; descendants must remain within that resolved planning root. Other selected sources remain within their own resolved repository roots. Read-only repository keys are recorded per file. There is only one writable repository, determined later by the runner, never by this capsule.

## Shape and guarantees

The JSON object has `kind: "openplanr-delegation-context-capsule"`, `schemaVersion: "1.0.0"`, `mode`, `selector`, `request`, `brief`, `sourceKeys`, `inventory`, `files`, and `omissions`. In direct-request mode, `request` preserves the complete original request string; it is `null` for task mode. The ordered inventory entries identify `repositoryKey`, relative `path`, `roles`, `required`, and byte count. Each `files` entry contains the same metadata and the **complete original bytes** in `contentBase64`. The helper also writes a decoded, digest-covered file mirror beside `capsule.json` so native Read tools can inspect every selected file without shell decoding. The prompt points at this mirror; the brief cannot replace the original bytes. `omissions` records an optional path, role, and reason code. There is no truncation. A required omission throws before a capsule is returned. The default bounds are 256 files, 2 MiB per file, and 16 MiB total; callers may set positive integer limits.

The capsule file is created exclusively in a fresh private directory with directory mode `0700` and file mode `0600`. The source checkout is never a valid output location, even through a symlink. The orchestrator owns retention and cleanup. It should not log the capsule, source bytes, environment values, or full prompts.

Known secret paths and literal credential values are rejected when required, or recorded as excluded when optional. Ordinary references such as `process.env.GITHUB_TOKEN` are source code, not credential values. A source named by the user or task requirements is required and cannot be downgraded to an optional omission after a guard failure. The preview shows optional omissions separately from blockers and gives both logical and physical `.planr` locations when planning is linked to another checkout. Planning content is task context, not permission for extra commands or automatic planning updates. These checks are conservative guards, not a claim that arbitrary repository data is safe to send to any destination. The orchestrator still previews the inventory and verifies profile destination before dispatch. No profile, token, environment, or execution permission field belongs in this contract.

`CapsuleError.code` is stable for callers. `details` can include non-secret paths, searched locations, and candidates; errors never include source bytes. Applicable codes include `E_CAPSULE_SELECTOR`, `E_CAPSULE_AMBIGUOUS`, `E_CAPSULE_NOT_FOUND`, `E_CAPSULE_LINK`, `E_CAPSULE_FRONTMATTER`, `E_CAPSULE_LIMIT`, `E_CAPSULE_UNREADABLE`, `E_CAPSULE_SECRET`, `E_CAPSULE_PATH`, `E_CAPSULE_SOURCE`, `E_CAPSULE_INPUT`, `E_CAPSULE_FORMAT`, and `E_CAPSULE_OUTPUT`.

New capsules include a `readingOrder` in the decoded index: required repository instructions and requirements precede implementation/tests, and optional background comes last. Each file remains available in full. Select only relevant source/tests, read the mirror once, and use the worktree for editing and additional investigation. Existing capsules without this field retain their original mirror bytes and validation.
