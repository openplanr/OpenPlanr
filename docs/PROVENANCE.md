# Release provenance

Every OpenPlanr package version is published by the release workflow from a reviewed
commit on `main`, with an npm provenance attestation, and is never republished: a
correction is always a new version. This page records the proof for each version so
anyone can check that what the registry serves is what the repository built.

For each version, the release train compares the published archive file by file with
the archive packed from the build commit, records the registry integrity string and the
attested build commit, and creates a package-qualified tag (`<package>@<version>`) plus a
GitHub release carrying the same evidence. The payload digest is the SHA-256 of the
sorted per-file SHA-256 list of the archive.

To verify a version yourself:

```bash
npm install openplanr@<version> --ignore-scripts
npm audit signatures
```

## Published versions

| Package | Version | Published (UTC) | Channel | Build commit in attestation | Payload SHA-256 | Registry integrity |
| --- | --- | --- | --- | --- | --- | --- |
| `@openplanr/protocol` | `0.2.0` | 2026-09-17 00:09:37 | Outside `publish-packages.yml`; registry signature, no SLSA attestation | none | `908514e543aac2e65a017686f46806e89902243ae4b37235fc20c5dc09d0fad5` | `sha512-qaEB3Pyms/1qlepqKn2QdgUeKVlwGGCob4Tcd5ZlSxFGHAiIZKAfQLabnyMrUnmNT7PnWs8IjNWfOzNrK43bvw==` |
| `planr-pipeline` | `0.45.0` | 2026-09-17 00:17:51 | `publish-packages.yml` run 35165636890; SLSA v1 attestation | `8c05a49f5814dbac7d46e3e813e025e0d789b9f6` | `8af0841ca59f7e7d06d7971b1afc4b46f5d2bf12d65091a49c2f9390bd17b8a3` | `sha512-wxRiboEopbLrZxrIA5t4iAOw8k1lu/XVZZ3Uw37ppHhhnv3HP056RCqga7lbqntUL08MUMoMihJud7TD/i8P+w==` |
| `openplanr` | `2.0.0` | 2026-09-17 00:43:07 | `publish-packages.yml` run 35167294414; SLSA v1 attestation | `0bd38b4eeaa64f7a48a647611f859b2f408b6f22` | `69b80ada4072d2f73788b3ce587fd337eda7645601a6fcc68b76e9bf7e7376ad` | `sha512-C00jRt0+6Kpk5DHhmoFzuCiGF7MSJEEzUloGSEPVheMgESHLjjzY6UIwJMyEaKDrmyLteflDtW1XY+sYHf7iKw==` |
| `openplanr` | `2.0.1` | 2026-09-17 17:19:34 | `publish-packages.yml` run 35244051006; SLSA v1 attestation | `80456b17757221b952a394e4fe1987376774e468` | `3c4c730975a1785693ac90ecfc86ec26dc71c3badab556a9ef75c32c3bb2cd5d` | `sha512-FLt7nIEKhn2df0rCJh2Cl8LkKbrUmjPlCygcJTq/MZAhctEr0v1qR9KGLlJ66ELpIx3+fNYE9ZC9tmQYo2PZVw==` |
| `@openplanr/protocol` | `0.3.0` | 2026-09-17 20:10:48 | `publish-packages.yml` run 35268793491; SLSA v1 attestation | `745c3320ea8c26d52e786a11b891e7323f65809e` | `09ad63da2fe386f907419ec1ce0f4daef73123b1b7fa997455f70fd2d7a7b0e9` | `sha512-zz1KWf+6aOHSNGzinaiU1HsJIKKEPNxUQlLUKIn7EleIOJ7z3MOW7Aej7qMuZCHrBr0/HGkGn1cnWV1xOOLRBg==` |
| `planr-pipeline` | `0.45.1` | 2026-09-17 20:18:33 | `publish-packages.yml` run 35269463777; SLSA v1 attestation | `745c3320ea8c26d52e786a11b891e7323f65809e` | `5547524816047bf48f46e79db5e35dfe1ed63077f417f450afacf9ff7cb561b2` | `sha512-Gr4kPwseyIlPYYO2XaWofepOuUYJWHYpLJdZxKPGnSYmuBOAdLeeEhmAqBPTJEBq210rG4wp2otwGbK4GbUuOA==` |
| `openplanr` | `2.1.0` | 2026-09-17 20:25:46 | `publish-packages.yml` run 35270101679; SLSA v1 attestation | `745c3320ea8c26d52e786a11b891e7323f65809e` | `5585526e4ee8b51c3579bfb8a0288dcc8ec439da424f48dd7e85bb4587537b22` | `sha512-O5sdDMNJu4iTykfYG75xJTtDuoCxkS/wkP2aqcHIwdWQXGUsPbauP+we10NAG9avgYF5sIWPBIMs/z7sj7e54w==` |
| `openplanr` | `2.1.1` | 2026-09-17 21:20:10 | `publish-packages.yml` run 35275009599; SLSA v1 attestation | `b357aa171395d076312a8ce64c817cde2e99e137` | `d968d3ff3e059da523c22c54e69ad97f85a48ace00d0d7ace3cdc7aa6c77a60b` | `sha512-IRFpAMmMCIQg/TVzmJ+p/u8aD7rEg/YsHY7SIGpv36pEGdA+JAnbLNcBrtHqgQjs8nsTlsi9o21mmJG/b6v6Xw==` |
| `@openplanr/protocol` | `0.4.0` | 2026-09-18 01:29:32 | `publish-packages.yml` run 35293885133; SLSA v1 attestation | `d99190b91fc0dc7632201747d1c76fbb6cc1654b` | `c18b4d237146ddffa834d9a42e58837c8a061a6cca1a9c1df3931e7e402cb017` | `sha512-VpwVfQH1n+irBpgSLBPd5dt6kIYRZv+x6kKqOKpLTMqpbd2PvE9xIi6rWbZFsjbT+A0pcY+6fkuNi8W92wPuBA==` |
| `planr-pipeline` | `0.45.2` | 2026-09-18 01:49:39 | `publish-packages.yml` run 35295582718; SLSA v1 attestation | `d99190b91fc0dc7632201747d1c76fbb6cc1654b` | `a12bb5ea5767cae2d319e676bbea369a5d634e504b6d2c6bcd8876865c1eab7a` | `sha512-nvgasarrI/ek5gJR2xwnGbIj8QwNc3kAioeNuW0WMacuEYgtlIJPeJgTwMmY+mirpmyta2p56gEtZOxle8hO6Q==` |
| `openplanr` | `2.2.0` | 2026-09-18 02:04:45 | `publish-packages.yml` run 35296907004; SLSA v1 attestation | `d99190b91fc0dc7632201747d1c76fbb6cc1654b` | `a08108c84fccc49ecfb3410d2ca71de587fe2edc00752503bd8268cf319005c6` | `sha512-8ATEljC7k4P6ufYUcad8q6q+nogZnhoLXjyFSQtx6cMhoHuso9JlBcgBrm9Tqv467g+OBxQEXjN1kJ6vGSV5eQ==` |
| `planr-pipeline` | `0.45.3` | 2026-09-18 15:39:16 | `publish-packages.yml` run 35363181266; SLSA v1 attestation | `1746c7fbaf57dae9096a1d48e945ac48f96bf3c3` | `fcb5cd79007027c0b3f6c6aebb3841fd269f8440182784007f7aed3cc3e0b110` | `sha512-T5dpryI7Bu7GBJgnwY4ZyzBtqQzX6VXxKzihdttEw2GtgWMl+JZYcR0iNsUUgR9zY3deSKciO3vw8mmtb/t/Xw==` |
| `openplanr` | `2.2.1` | 2026-09-18 15:42:11 | `publish-packages.yml` run 35363181266; SLSA v1 attestation | `1746c7fbaf57dae9096a1d48e945ac48f96bf3c3` | `729bf07eba79fc7817c9d5667e9d7603d07f86aa02a0063d2f08d0111e496342` | `sha512-wLewqIiUyuTj957IKmIrYB9U+xHUjMhHCpJKM+G78R8CqACK2Pb6ail3rw7i1ELRHhXADMCuvbkmNKv/coTUcA==` |
| `planr-pipeline` | `0.45.4` | 2026-09-18 18:39:39 | `publish-packages.yml` run 35380998548; SLSA v1 attestation | `6c586203fc439c470e538fde45a1f8e68f5d35a0` | `9c1023bfeb944f2183d6fc002f6593d3fc659a49e839ffa1ccf8374db250810a` | `sha512-krPzEufF1KwqwAu0M/BUBH1Oe/q0U0lijNMOMdzuqo/a1XV59ZPFXDKYVz5AuLOetOyzVMNzpPK6C0BYlT/Ltw==` |
| `openplanr` | `2.2.2` | 2026-09-18 18:44:17 | `publish-packages.yml` run 35380998548; SLSA v1 attestation | `6c586203fc439c470e538fde45a1f8e68f5d35a0` | `f57ec75ebc1080582aeaa1681723b0a0f08e2121719e5e4b4388bcf5b43cae9c` | `sha512-EuTZDBcO8h7hfbteWKN0yAP9kZ0vRtay+OpIHsfclFPYZcmercd2BCbv3zqEuqMagRmd24Enj1Pvz1tylH5G+Q==` |

`@openplanr/protocol@0.2.0` was published by hand moments before its workflow run and
therefore carries a registry signature but no build attestation; every later version of
every package was published by the workflow.

## License

OpenPlanr is [MIT licensed](../LICENSE); see also the [CLI](../packages/cli/LICENSE) and
[pipeline](../packages/pipeline/LICENSE) license files and
[THIRD_PARTY-DIAGRAM-NOTICES.md](../packages/pipeline/THIRD_PARTY-DIAGRAM-NOTICES.md).
Third-party dependencies retain their own licenses.
