---
'openplanr': patch
---

The OpenPlanr plugins for Claude Code, Codex and Cursor now carry instructions only: skills, agents, references, metadata and the icon, with no scripts or executables. Every release checks that no plugin ships a script, a `#!` file, package-manager files, an `npx` launcher without an exact version or pre-approved tools, that no skill text names a credential variable to read or pass on, and that the Claude Code plugin declares no hooks, MCP or LSP servers or settings. The Claude Code plugin README now says the same.
