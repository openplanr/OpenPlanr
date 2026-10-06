---
'openplanr': minor
---

`openplanr report --push slack` is removed, together with the `distribution.slackWebhookUrl` and `distribution.slackChannel` settings, so the repository config holds no webhook secret. `--push github` is unchanged, and a rejected target now stops the command before anything is written or pushed. If your config had a webhook URL, revoke the webhook in Slack, since the URL sat in a committed file, then delete it from `.planr/config.json`.
