---
'openplanr': minor
---

`openplanr report --push slack` is removed, together with the `distribution.slackWebhookUrl` and `distribution.slackChannel` settings, so the repository config holds no webhook secret. Delete a webhook URL you added to `.planr/config.json`; `--push github` is unchanged.
