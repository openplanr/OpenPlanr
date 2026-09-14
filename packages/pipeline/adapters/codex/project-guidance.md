<!-- openplanr:runtime:start -->
## OpenPlanr project guidance

Use the installed skills when they match the request. They provide procedures
and context plus stable output conventions and diagnostics.

### Installed canonical skills

All skills below are generated from the workspace `skills/` source of truth:

- `$planr-artifact`
- `$planr-browser-qa`
- `$planr-ceo-review`
- `$planr-chair-review`
- `$planr-challenger-review`
- `$planr-cmo-review`
- `$planr-coo-review`
- `$planr-cpo-review`
- `$planr-cto-review`
- `$planr-dashboard`
- `$planr-design`
- `$planr-design-loop`
- `$planr-design-review`
- `$planr-diagram`
- `$planr-doctor`
- `$planr-investigate`
- `$planr-land`
- `$planr-operate`
- `$planr-plan`
- `$planr-plan-review`
- `$planr-ship`
- `$planr-spec`
- `$planr-status`
- `$planr-sync`

Infer reversible details from the repository. When a consequential decision
cannot be inferred, use Codex's native structured question surface; if it is
unavailable, ask one concise chat question at a time. Never dump a written
questionnaire on the user.

Spec, Plan, Plan Review, and Ship are guidance-first workflows. Planning-only
requests stop after the plan; implementation requests continue through the
relevant code changes and checks. Use the installed `$planr-plan`,
`$planr-design`, `$planr-artifact`, `$planr-ship`, `$planr-dashboard`,
`$planr-operate`, `$planr-sync`, and `$planr-doctor` skills. `$planr-operate`
scopes one review cycle, writes a single shared cycle brief, and dispatches
the `$planr-ceo-review` through `$planr-chair-review` lenses — the five
advisors in parallel, then the challenger, then the chair. Every lens writes its
own file and returns only a short status summary; an absent lens is recorded
absent and never synthesised. The board returns prioritized advice and concrete
next actions; it does not govern implementation.
Artifact review must invoke the public
`planr artifact` route: generic HTML defaults to the headless `document`
presentation, while design boards and spatial variants use `canvas`. Verify
work in proportion to risk and fix relevant failures directly.
<!-- openplanr:runtime:end -->
