# Conditional delegation cases

`delegation-cases.json` provides manual inputs for evaluating Plan/Ship role
selection and delivered behavior. It is a case pack, not a new runner or CI gate.
The existing model-routing command evaluates skill metadata only; it does not
execute these implementation cases or establish their quality.

Stage each case's `files` in a disposable project, add the same package/test
configuration to both arms, and supply its `request`. Use `node --test` for the
included Node fixtures. The UI case additionally needs the existing browser
verification environment. Never run the authorization fixture against a service.

Compare a main-session baseline with conditional delegation using the same
model, input bytes, tools and acceptance criteria. Score the criteria by examining
the delivered change and its checks, not the worker's confidence. Record actual
role identities, correctness, rework, wall time, and combined parent/worker usage
using the existing host transcripts and evaluation reports. Deduplicate tool-use
records and label missing usage unavailable. Registration and non-error tool
results are not evidence of improved outcomes.

The cases cover a small coherent backend fix, a separable UI/API change, and an
authorization review. Test missing native-role support by repeating the UI/API
case without those definitions: sequential completion must disclose that no
specialist ran. For database implementation, the worker must be backend; live
introspection is a separate read-only assignment, not a migration implementer.

Model comparisons need a separately agreed budget and execution environment.
No result is claimed by committing these inputs. Integrate them with the existing
evaluation work when its implementation-quality suite is available; do not turn
the metadata-routing command into a second orchestration harness.
