---
"openplanr": patch
---

Rebuild the dashboard command palette. It opens on the items you opened recently and the Plan views, instead of an empty result. Scopes with counts (All, Items, Views, Commands, and Operate when a cycle is bound) filter the results without changing what you typed. Each row shows the ID, the title with the matched text tinted, and the status. The preview lists the spec, story, dependencies and last update, with the next command at the bottom. Cmd or Ctrl+C copies the selected row's command when no text is selected, and the footer confirms the copy for two seconds. A search with no match says so and hides the preview. Hovering the selected row no longer stacks two highlights. The `@type` prefixes still filter, and Search stays reachable from the rail and the palette's views. Recent items are kept in this browser, five per project.
