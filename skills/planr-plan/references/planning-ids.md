# Allocate planning IDs

`SPEC-NNN`, `US-NNN` and `T-NNN` are project-global and monotonic. Allocate them
with your own file tools; never reuse a deleted ID and never fall back to
`US-001` or `T-001` because the sequence looked empty.

1. **Find the specs root.** Read `.planr/config.json` and take
   `outputPaths.agile` (default `.planr`). The specs root is
   `<agile>/specs`. Stop and report when the config is missing or not valid
   JSON, or when the specs root does not exist or is not a directory; do not
   create it.
2. **Read the stored sequence.** If `<specs root>/.id-sequence.json` exists, it
   must have `kind: "planning-id-sequence"`, `protocolVersion: "1.7.0"` and a
   positive integer `next.SPEC`, `next.US` and `next.T`. Stop and report when it
   does not; never repair or replace it silently. A missing file means every
   stored `next` is 1.
3. **Scan existing IDs.** List the specs root recursively, skipping directories
   whose names start with `.`. For each file or directory name that starts with
   `SPEC-`, `US-` or `T-` followed by three or more digits, keep the highest
   number per kind.
4. **Choose the first ID.** For each kind, `next = max(stored next, highest + 1)`.
   Number the new artifacts upward from `next`, padded to at least three digits
   (`US-015`, `T-120`).
5. **Never overwrite.** Immediately before writing each artifact, confirm no file
   or directory with that ID exists anywhere under the specs root. If one does,
   take the next number and check again.
6. **Advance the sequence.** After writing, write `.id-sequence.json` in the
   specs root:

   ```json
   {
     "kind": "planning-id-sequence",
     "schemaVersion": "1.0.0",
     "protocolVersion": "1.7.0",
     "next": { "SPEC": 4, "US": 16, "T": 42 }
   }
   ```

   Each `next` is one past the highest ID you wrote, or the value from step 4
   for a kind you did not use. Never lower a value.

Re-run steps 2–4 right before writing rather than reusing numbers from earlier in
the session: another writer may have added artifacts since.
