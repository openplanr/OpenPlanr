---
"openplanr": minor
---

Installed-tuple reconciliation and a safe, honest upgrade path (SPEC-006).

Until now the CLI could tell you your install had drifted and then leave you to
derive the fix yourself across two package managers. `doctor` already computed
component, digest, adapter, and CLI drift correctly — nothing acted on it, and
nothing read back the compatibility ranges the ecosystem manifest already
publishes.

**Reconcile the installed tuple, not "is something newer".** A new
`planr upgrade status [--json]` reads the published compatibility manifest,
compares it against the real installed tuple — this CLI plus both host-plugin
versions — and reports `aligned`, `upgrade-available`, `incompatible`, or
`unknown`. The warn-versus-fail distinction is not re-derived: `doctor`'s inline
lock-drift classification is extracted into a single exported
`classifyComponentDrift` that both surfaces call, so a CLI merely trailing an
upgrade stays a warning while a genuinely incompatible tuple fails. Every
pre-existing `doctor` assertion passes unchanged as proof the extraction
preserved its behaviour. An absent plugin is recorded as absent, never as a
violation, so a planning-only install does not read as broken.

**Offline capability is preserved by construction.** The manifest fetch trusts a
short-TTL cache without any network round-trip, carries a hard timeout that wins
even when a fetch hangs, falls back to a stale cache when the network fails, and
reports `unknown` when there is neither — so a captive portal, a VPN, or an
airplane can never make `planr` block. Proven by offline and hung-network tests
and by a packed-install end-to-end test that reads the real installed version
rather than a fixture.

**Execute the half it owns; prescribe the half it cannot.**
`planr upgrade apply [--yes] [--json]` performs `npm install -g openplanr@<target>`
and prints the plugin commands it structurally cannot run — plugin installation is
a host command, not something a CLI can own. The prescription is rendered from the
plugin integration's own operation list, so the printed commands can never drift
from what an apply would really run, and the marketplace-refresh command is always
placed first: without it the installer reinstalls the stale version and the user
believes they upgraded. A grep gate proves the upgrade service never imports the
plugin-apply path, and an end-to-end test proves no mutating plugin command is
ever spawned.

**A partially-upgraded install can never report success.** The previously
installed version is captured as a restorable backup before any mutation, and the
on-disk version is re-read afterwards. A clean exit that did not land the target
restores the previous version automatically and states exactly what was restored
and how to retry. On success, the changelog entries strictly between the old and
new version are summarised verbatim — never inventing a change the changelog does
not carry — and `CHANGELOG.md` now ships in the package so that summary works on a
real installation rather than only in-repo.

**The offer comes to you.** An available upgrade now surfaces on an ordinary
interactive command as a four-way choice — upgrade now · always keep me current ·
not now · never ask — so nobody has to run a diagnostic to discover they are
stale; accepting resumes the command you originally invoked. "Not now" snoozes
with escalating backoff (24 hours, then 48, then a week) so it never nags.
`auto_upgrade` and `update_check` are real settings, neither inferred from a bare
invocation, and "never ask again" is a permanent opt-out that always states the
exact command reversing it. A snooze, a never-ask, or a disabled check
short-circuits before any reconcile, so a command that already declined touches no
network and adds no delay; the state file is read fail-open, and the offer never
surfaces for machine-readable or non-interactive invocations.

**Upgrades can now carry state forward.** Idempotent migrations keyed to a version
run automatically when an upgrade crosses that version, for state a reinstall
cannot repair — stale config, orphaned files, a changed on-disk layout. A strict
lower bound means a migration at or below the installed version never re-runs, and
one migration failing neither aborts the others nor is swallowed into an overall
success. The legacy operating-profile migration is registered as the proving case
by delegating to the existing implementation, reusing its exact-backup, journalled
write with rollback, and idempotency guarantees rather than forking them; the
standalone `operate profiles migrate` command keeps working unchanged. A migration
failure reports failure while still reporting the npm step's real success, so a
half-migrated install can never claim to be clean.
