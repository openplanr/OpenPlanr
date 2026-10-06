---
'openplanr': minor
---

**Breaking:** `openplanr report --push slack` is removed, together with the `distribution.slackWebhookUrl` and `distribution.slackChannel` settings, so the repository config holds no webhook secret. It ships in a minor release as a deliberate exception to the major-release rule, because the push kept a webhook secret in a committed file. `--push github` is unchanged, and a rejected target now stops the command before anything is written or pushed. If your config had a webhook URL, revoke the webhook in Slack, since the URL sat in a committed file, then delete it from `.planr/config.json`.
