---
'openplanr': patch
---

`/planr:share` formats a Slack draft in the standard Markdown that Slack's connector expects, and keeps Slack's own syntax for text you paste. It treats a chat app name such as `slack` as the app rather than a channel and still asks where to post. With no OpenPlanr project in the folder, it asks which project to use instead of guessing. `/planr:connect` accepts a product name such as `linear`, and reports a connector that is set up but not signed in, with a pointer to the host's connector settings.
