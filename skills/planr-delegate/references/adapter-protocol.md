# Native adapters and experimental generic protocol

Claude Code, Codex and Cursor are native execution adapters. They reuse signed-in
authentication and trusted configuration/environment, stream native events, record
exact session identifiers and continue only those sessions. Implementation tools,
permissions, sandboxing, hooks/plugins/MCP and the build/test/correction loop belong
to the native harness. OpenPlanr adds no blanket tool exclusions or permission-bypass,
force/yolo or blanket MCP-approval flags. Native managed policies remain authoritative.

The native adapters require documented print/event streaming, working-directory and
context access, and exact continuation options. Explicit models are pinned; native
defaults/automatic routing remain native. Unknown routing is native-managed. Local
probes are diagnostic; template/auth/model errors remain actionable without rewriting
messages or silently switching providers. Plain summaries need no model-authored JSON.

## Experimental generic protocol v1

Generic executables remain experimental and use `openplanr.delegate.adapter`, version
1. No new generic engine or extra isolation mode is added. The executable receives
argv arrays and JSON stdin; no shell alias or command-string evaluation is performed.
The profile declares its trusted executable, argv, allowed environment names,
worktree behavior and verified destination. Generic enrollment retains its existing
30-day lifetime and strict destination checks.

`--planr-probe` returns:

```json
{"protocol":"openplanr.delegate.adapter","version":1,"capabilities":{"implementation":true,"structuredResult":true,"exactResume":true},"destination":{"class":"local","origin":"http://127.0.0.1:1234"}}
```

`--planr-run` and `--planr-resume` receive `prompt`, `cwd`, `capsulePath` and, for
continuation, the exact `sessionId`. Their terminal response includes the same
protocol/version, `status` (`completed`, `blocked` or `question`), `sessionId` and
`summary`, with optional check/issue arrays and a structured question. Malformed or
incompatible generic results remain blocked; the native plain-summary policy does
not change this protocol.
