# Release Ledger

The release-ledger verifier checks the compatibility statements appropriate to
the workspace it discovers. A legacy multi-repository release still uses the
frozen five-row ledger. The consolidated OpenPlanr workspace instead binds its
two public packages to the packed-workspace proof and checks the generated root
ecosystem manifest.

Nothing here assigns a version, publishes, deploys, tags, pushes, or promotes.
The ledger and its verifiers are read-only derivations.

## Contracts

The four legacy release contracts are closed, draft 2020-12 JSON with
`additionalProperties: false`, an explicit contract version, and SHA-256/JCS
custody through `lib/protocol/jcs.mjs`. They live under `schemas/v1.3.0/` and
are resolved with `loadReleaseLedgerContract(kind, { protocolVersion:
'1.3.0' })`.

| Contract | What it holds |
|---|---|
| `release-ledger` | One row per frozen repository key, plus the manifest bytes the rows are bound to |
| `release-compatibility-claim` | One consumer row, one producer row, the producer payload digest, and the derivation used |
| `release-ledger-receipt` | A verification outcome, and nothing else |
| `ecosystem-manifest` | The manifest shape the marketplace generator actually emits |

Every record derives both its identity and its digest by canonicalizing itself
with **both** fields removed. A record whose digest was not recomputed after an
edit is refused, never repaired.

## Workspace policies

The verifier selects one of two explicit policies:

| Layout | Package proof boundary | Other domains |
|---|---|---|
| Legacy multi-repository | `pipeline`, `web`, `cli`, `skills`, and `marketplace` | Every frozen repository remains a ledger row |
| Consolidated monorepo | `pipeline` and `cli` | `skills` and `marketplace` are generated root catalogs; `openplanr-web` is external |

The consolidated policy never invents package identities for the root
`skills/` or marketplace metadata. Their generated manifests remain covered by
the workspace generation and conformance checks. The separately deployed
`openplanr-web` repository is not a prerequisite for local strict verification.

The closed `release-ledger@1.3.0` schema remains readable and unchanged. It
still requires all five legacy rows. A consolidated run therefore reports the
validated `packedProofDigest` and compatibility projections without pretending
to emit a five-row legacy ledger.

## Rows

A legacy row binds one repository:

- `packageName` and `declaredVersion` — the editable labels
- `baselineCommit` and `clean` — the checkout the bytes came from
- `sourceInventoryDigest`, `payloadDigest`, `exportSurfaceDigest` — the bytes
- `terminalReceipt` — the receipt that certified those bytes, its terminal
  state, and the payload digest it was bound to

A row is refused when its receipt is missing, is not terminal, or was bound to a
different payload. A dirty tree never becomes a row; it becomes a typed absence.

## Claims and displays

A claim binds a consumer row and a producer row and states one `derivation`.
Its `display` is a projection: it must equal the deterministic render of the
bound rows. When it does not, the claim is refused with
`E_RELEASE_LEDGER_CLAIM_DRIFT` — it is never silently re-rendered.

The published manifest renders exactly the edges in `RELEASE_MANIFEST_CLAIM_EDGES`.
`assertEcosystemManifestProjection` checks each rendered range against its bound
claim and each stated component version against its row label.

## Receipts carry no authority

`release-ledger-receipt` records whether a verification passed. It declares
`authority: "none"` and can never be the receipt a row cites as the receipt that
certified its bytes: a ledger that cited its own verification outcome is refused
with `E_RELEASE_LEDGER_SELF_CERTIFIED`.

## Absences

Missing or unreadable inputs are typed absences carrying an explicit reason from
`RELEASE_LEDGER_ABSENCE_REASONS`. An absence never degrades to a permissive
default, an inferred range, or a passing claim. Claims that depend on an absent
input are reported as unproven.

## Manifest revision versus contract version

`ecosystem-manifest@1.3.0` is the contract version. The manifest document the
marketplace generator emits declares its own `schemaVersion` of `1.1.0`, which
this contract pins. The two are separate on purpose: the emitted bytes and the
frozen `ecosystem-manifest@1.1.0` schema both stay byte-identical, while the
manifest that is actually published finally has a contract that can validate it.

The ledger binds the manifest rather than the manifest binding the ledger, so
adding digest custody required no change to any published manifest byte.

## Running the verifiers

```bash
npm run conformance:release-ledger
npm run verify:release-ledger
npm run verify:release-ledger -- --strict
npm run verify:release-ledger -- --json --proof <proof.json>
```

`conformance:release-ledger` checks the contracts against committed fixtures and
validates the emitted marketplace manifest when that repository is present.

`verify:release-ledger` derives the compatibility projections from the selected
workspace. Rendered ranges that the packages do not derive are refusals and
fail the run. Missing packed payload custody is reported as unproven and fails
only under `--strict`.

For the consolidated repository, run the cross-platform root wrapper. It
generates the current two-package proof in a bounded temporary workspace and
passes that exact JSON file through strict ecosystem and ledger consumption:

```bash
npm run verify:packed:strict
```

The proof must be `openplanr-packed-workspace-proof@1.1.0`, must contain passing
CLI and pipeline package/install checks, and must reproduce the current packed
bytes. Its Protocol inventory binds the 180 original schemas, 12 original
registries, 24 additive Protocol 1.5/1.6 schemas, and ten additive registries.
Without it, consolidated strict mode names exactly
`payload.pipeline` and `payload.cli` as unproven.

For a legacy five-repository release workspace, retain the coordinated package
proof flow:

```bash
npm run verify:release-package -- --ecosystem --json > package-proof.json
npm run verify:release-ledger -- --strict --proof package-proof.json
```

That legacy proof must still supply all five frozen payload and terminal-receipt
rows. A consolidated two-package proof does not weaken the legacy boundary.
