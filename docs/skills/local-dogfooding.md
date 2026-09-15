# Local skill dogfooding

Use this journey to verify skills built from the current monorepo checkout.
The explicit workspace binary identifies the installation being tested.

```bash
cd /path/to/OpenPlanr
node --version
npm ci
npm run build
npm run generate
npm run skill:package
npm run skill:verify:release

PLANR_BIN="$PWD/node_modules/.bin/planr"
"$PLANR_BIN" --version
"$PLANR_BIN" setup --runtime codex --scope user \
  --skill-mode unified-plugin --dry-run --json
"$PLANR_BIN" setup --runtime codex --scope user \
  --skill-mode unified-plugin
"$PLANR_BIN" setup --runtime claude --scope user --dry-run --json
"$PLANR_BIN" setup --runtime claude --scope user --yes
"$PLANR_BIN" doctor --json
```

The setup preview must identify the packaged local marketplace and one selected
mode. Doctor must report the same mode and must not report simultaneous direct
and plugin ownership. Restart the selected host, open the OpenPlanr plugin
Contents view, and verify that each advertised skill opens with its support
files. Claude must match the canonical registry (currently 25 skills), report
nine agents and zero commands; Codex must report the same skills and no
compatibility aliases.

For a target project, keep using the explicit workspace binary when setup or
doctor must come from this checkout:

```bash
OPENPLANR_REPO=/path/to/OpenPlanr
cd /path/to/project
"$OPENPLANR_REPO/node_modules/.bin/planr" status --md
```

Representative unified-plugin invocations are `$planr:spec`, `$planr:plan`,
`$planr:ship`, `$planr:status`, `$planr:diagram`, and `$planr:operate`. A natural-language
request should also match from metadata alone. Genuine missing choices should
appear through the host's question UI; optional context should produce useful
partial work rather than a process gate.

In Claude Code, use the corresponding `/planr:*` names. Plan and Ship
must still work when `planr` is absent from `PATH`, provider keys are unset, and
network access is unavailable. The active host agent authors and implements;
the CLI does not provide semantic fallbacks.
