---
description: Outcome eval, explicit invocation, run with the plugin only. See ../README.md.
max_turns: 60
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Write, Edit, Skill, Agent, Bash]
plugins: ["../../../dist/plugins/claude/openplanr"]
---

/planr:release Write release notes for what shipped since v1.4.0 and tell me the version.
