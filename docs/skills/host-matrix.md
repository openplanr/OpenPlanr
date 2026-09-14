# Skill host matrix

OpenPlanr compiles one canonical skill graph into semantically equivalent,
host-native projections. Generated files are outputs, not alternate sources.

| Capability | Claude Code | Codex | Cursor | Pipeline compatibility |
|---|---|---|---|---|
| Primary unit | Claude skill/plugin | Codex plugin skill | `.mdc` rule | packed skill asset |
| Explicit invocation | `/planr:*` | `$planr:*` in the plugin; `$planr-*` in direct mode | Composer mention | adapter dispatch |
| Automatic matching | description metadata | description metadata with implicit invocation | rule description | registry routing |
| Structured questions | native question when available | native composer question when available | Composer chat | terminal/headless resolver |
| On-demand content | relative packaged references | relative packaged references | generated rule references | package-relative references |
| UI metadata | plugin manifest | `.codex-plugin/plugin.json` and `agents/openai.yaml` | rule frontmatter | adapter manifest |
| Recommended install | unified plugin | unified plugin | project rule | exact npm package |

Host profiles may change supported syntax, invocation wording, metadata, and
question surfaces. They may not change the OpenPlanr context, workflow, output
contract, or error semantics. Vendor-specific paths, commands, variables, and
model-selection instructions are rejected outside their owning projection.

Every projection must be readable without this source repository. The release
verifier opens each entrypoint, links every support file, checks native metadata,
and compares installed bytes with the deterministic release manifest.
