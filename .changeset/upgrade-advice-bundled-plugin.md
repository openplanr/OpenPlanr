---
'openplanr': patch
---

`planr upgrade status` and `planr upgrade apply` now judge and prescribe the plugin `planr setup` installs, `planr@openplanr-local` from the bundled `openplanr-local` marketplace, instead of the retired `openplanr@openplanr` and `planr-pipeline@openplanr` plugins. After a CLI upgrade the prescribed commands refresh `openplanr-local`, update `planr@openplanr-local`, and remove leftover legacy plugins; when the marketplace was never registered the advice is `planr setup --runtime claude --scope user`. `planr setup` and `planr doctor` also warn when a marketplace-installed `planr@openplanr` sits beside `planr@openplanr-local` and give the exact `claude plugin uninstall` command to keep one, without removing anything themselves.
