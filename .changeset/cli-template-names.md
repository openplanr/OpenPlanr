---
'openplanr': patch
---

`planr template save --name` and `planr template delete` now accept only lowercase words joined by hyphens (such as `rest-endpoint`, at most 64 characters) and fail with `E_TEMPLATE_NAME_INVALID` for anything else, so a name like `../../package` or an absolute path can no longer write or delete a file outside `.planr/templates`. Both commands refuse a templates directory that links outside the planning directory (`E_TEMPLATE_DIR_OUTSIDE`), and `save` replaces an existing template file atomically instead of writing through a link.
