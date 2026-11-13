---
"openplanr": patch
"@openplanr/dashboard-app": patch
---

Home stays available when an item's `dependsOn` is a single id, empty or not a list. A single id counts as one dependency in Home, Detail and the inspector. In Home and Data health, a value that is not an id shows as an unresolved dependency.
