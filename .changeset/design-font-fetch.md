---
'openplanr': minor
---

The design skills can now save real typefaces with one command: `node scripts/design.mjs fonts fetch --family "Inter:400,600" --dest <design>/source/assets/fonts`. It downloads Latin `woff2` files and license files from Google Fonts for up to two openly licensed families (OFL or Apache) and three weights each, and writes a local `fonts.css` for the design to import. It refuses other licenses and leaves nothing behind when a download fails. When your host asks for network access, this is the one request to approve; designs still fetch nothing when they open.
