# Installing the OpenPlanr Skill

Three channels, each self-contained. Pick the one that matches your environment.

---

## Claude Code

**Prerequisites:** Claude Code CLI installed and signed in.

### Two-step install

```bash
/plugin marketplace add openplanr/skills
/plugin install openplanr@openplanr-skills
```

The first command registers this repo as a plugin marketplace. The second installs the OpenPlanr plugin from that marketplace. The plugin contains a single skill named `openplanr` which Claude Code activates automatically when it detects planning intent.

### Verify

Ask Claude Code:

> *"Plan an epic for a new notifications service."*

The skill should activate and Claude Code should ask clarifying questions or run `planr epic create`. You can also list installed plugins and skills via:

```
/plugin
```

and look for `openplanr` under your installed plugins.

### Local development (for contributors)

To test a local checkout of this repo before publishing:

```bash
/plugin marketplace add file:///absolute/path/to/openplanr-skills
/plugin install openplanr@openplanr-skills
```

Changes to `SKILL.md` and references take effect on the next plugin reload.

---

## Claude.ai (Pro, Max, Team, Enterprise)

**Prerequisites:** A paid Claude.ai plan that supports custom skills.

### Download and package

```bash
git clone https://github.com/openplanr/skills
cd skills/skills/openplanr
zip -r ../../openplanr-skill.zip .
```

This produces `openplanr-skill.zip` in the repo root — it contains `SKILL.md`, the `references/` directory, and the `examples/` directory.

### Upload

1. Open Claude.ai.
2. Go to **Settings → Capabilities → Skills** (exact path may vary by plan — see Anthropic's [custom skills guide](https://support.claude.com/en/articles/12512198-creating-custom-skills) for the current UI).
3. Upload `openplanr-skill.zip`.
4. Enable the skill for the workspace(s) you want.

### Verify

In a new chat, mention OpenPlanr or use planning language:

> *"I have a PRD for our billing redesign — can you break it into epics and tasks with OpenPlanr?"*

Claude should invoke the skill automatically. If it doesn't, re-check that the skill is enabled in Settings and try a more explicit prompt.

---

## Claude API

**Prerequisites:** A Claude API key and an SDK installed (`anthropic` for Python, `@anthropic-ai/sdk` for TypeScript, etc.).

Full quickstart: <https://docs.claude.com/en/api/skills-guide>.

### Upload (Python example)

```python
from anthropic import Anthropic

client = Anthropic()

# Package the skill folder as a zip first:
#   cd skills/openplanr && zip -r ../../openplanr-skill.zip .
with open("openplanr-skill.zip", "rb") as f:
    skill = client.beta.skills.create(
        name="openplanr",
        file=f,
    )

print(skill.id)
```

### Invoke

Pass the skill's ID when creating a message:

```python
response = client.beta.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    skills=[{"id": skill.id}],
    messages=[{
        "role": "user",
        "content": "Plan out the user authentication feature from ./prd.md",
    }],
)
print(response.content)
```

Claude will invoke the skill when the user's intent matches; the skill's instructions tell Claude to run `planr` via the bash tool (which you must enable in your tools configuration).

---

## Post-install sanity check

Regardless of channel, run these five prompts to confirm activation works on the common triggers:

1. "Help me plan out a new authentication system."
2. "I have a PRD — can you break it into epics and tasks?"
3. "Estimate story points for this story: a user can reset their password via email."
4. "What's the status of our planning for this project?"
5. "Generate agent rules from my planning artifacts."

The skill should trigger on all five. It should NOT trigger on unrelated requests like "write a function to parse JSON" or "debug this TypeScript error."

If a trigger fails, please [open an issue](https://github.com/openplanr/skills/issues) with the exact prompt and the environment (Claude Code / Claude.ai / API).

---

## Uninstall

### Claude Code

```
/plugin uninstall openplanr@openplanr-skills
/plugin marketplace remove openplanr-skills
```

### Claude.ai

Settings → Capabilities → Skills → disable/delete the `openplanr` skill.

### Claude API

```python
client.beta.skills.delete(skill.id)
```
