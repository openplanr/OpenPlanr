# Use design lineage during Ship

`design-lineage.json` is optional. Its absence is normal and must not change an
ordinary Ship run.

When present, validate the sidecar and compare its package identity with the exact
approved implementation handoff. Load only mappings whose `taskIds` include the
selected task. From that subset, load only the referenced `REQ-NNN` requirements
and their source records. Do not ingest unrelated screens, requirements, package
versions, or complete design documents.

Treat the context as **current** when lineage, immutable package history, and the
current approved pointer identify the same package; **stale** when the exact
package is missing, changed, superseded, revoked, or disagrees with the sidecar;
and **absent** when there is no sidecar.

Carry current requirement statements, verification intents, accessibility and
responsive expectations into the implementation and checks. For stale context,
name the mismatch and use the evidence only as historical context; never silently
upgrade it to approved scope. The selected task, parents, and repository rules
remain authoritative.

Ship is a later, separate user invocation. Reading lineage never starts Plan,
another task, release, publication, deployment, or a Git operation. Delivery
status is a read-only projection of the approved package, lineage, task state, and
Ship closure. Never write delivery state back into an approved package.
