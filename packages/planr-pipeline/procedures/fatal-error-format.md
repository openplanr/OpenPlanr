# Procedure: standardized fatal errors (commands)

Use this shape whenever `/plan`, `/ship`, or `/planr-pipeline:status` must **abort**. Print **exactly two lines** to stderr (or the nearest equivalent).

**Line 1 — what failed:** `⚠ <concise outcome or missing prerequisite>`

**Line 2 — remediation:** `Repair: /planr-pipeline:<command> <exact reuse string the human should paste>`

Replace `<command>` and the reuse string with the real invocation (include slug, `--task`, etc.). Do **not** add stack traces, long prose, or extra blank lines unless the runtime requires one trailing newline after line 2.

---

*Referenced by:* `commands/plan.md`, `commands/ship.md`, `commands/status.md`, `procedures/mode-detection.md` (when tightening error UX).
