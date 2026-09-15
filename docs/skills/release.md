# Local skill release maintenance

BL‑020 prepares deterministic release products locally. It does not create a
remote, upload a skill, publish npm packages, deploy, tag, transfer, or archive
anything; those effects belong to the separately approved public-release work.

## Stage and verify

```bash
npm ci
npm run build
npm run generate
npm run check:generated
npm run skill:evaluate:catalog
npm run skill:package
npm run skill:package:check
npm run skill:verify:codex-plugin
npm run skill:verify:release
npm run verify:packed:strict
```

`release/release-index.json` is registry-derived. It lists every canonical
skill, compatibility alias, host projection, archive digest, version, installed
file count, and local-only publication state. Each individual archive is a
normal skill directory rooted by `SKILL.md`; the unified archive contains both
Claude and Codex plugin manifests and the generated host content.

Run the performance harness under Node 20, 22, and the local Node 26. Keep the
results in the BL‑020 verification report and call out any budget exception.
Generated check mode must leave no diff beyond the already intended working
changes.

## Versioning and handoff

Use the existing independent component versions and the skill graph's version
impact report. Never invent a digest or edit a generated manifest. After every
local gate passes, hand the exact release index, evaluation report, performance
report, packed-package proof, and remaining public actions to BL‑014. Public
publication still needs a separate instruction.
