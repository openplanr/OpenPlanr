# Verifying a release

Every OpenPlanr package version is published by `publish-packages.yml` from a reviewed
commit on `main`, with an npm provenance attestation, and is never republished: a
correction is always a new version.

The release workflow rebuilds each package from its build commit, compares the archive
file by file with what it publishes, then creates a package-qualified tag
(`<package>@<version>`) at that commit and a GitHub release carrying the integrity
string, the attested build commit, and the run that produced it.

## Check a version yourself

```bash
npm install openplanr@<version> --ignore-scripts
npm audit signatures
```

`npm audit signatures` verifies the registry signature and the provenance attestation,
which names the source commit and the workflow run that built the archive. The same
evidence is on the [releases page](https://github.com/openplanr/OpenPlanr/releases), one
release per published version, and in npm's provenance panel on each package page:

- [`openplanr`](https://www.npmjs.com/package/openplanr)
- [`planr-pipeline`](https://www.npmjs.com/package/planr-pipeline)
- [`@openplanr/protocol`](https://www.npmjs.com/package/@openplanr/protocol)

To rebuild an archive yourself, check out the tag, run `npm ci && npm run generate && npm run build`,
then `npm pack --ignore-scripts` in the package directory and compare the result with the
archive the registry serves.

## Notes

`@openplanr/protocol@0.2.0` was published by hand moments before its workflow run and
carries a registry signature but no build attestation. Every later version of every
package was published by the workflow. `planr-pipeline` versions `0.43.0` and `0.44.0`
were internal release candidates that were never published; the registry history runs
`0.42.0` → `0.45.0`.

## License

OpenPlanr is [MIT licensed](../LICENSE); see also the [CLI](../packages/cli/LICENSE) and
[pipeline](../packages/pipeline/LICENSE) license files and
[THIRD_PARTY-DIAGRAM-NOTICES.md](../packages/pipeline/THIRD_PARTY-DIAGRAM-NOTICES.md).
Third-party dependencies retain their own licenses.
