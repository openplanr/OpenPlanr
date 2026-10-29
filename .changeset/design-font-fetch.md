---
'openplanr': minor
---

The design skills can now save real typefaces with `node scripts/design.mjs fonts fetch --family "Inter:400,600" --dest <design>/source/assets/fonts`. It downloads Latin `woff2` and license files from Google Fonts for up to two OFL or Apache families, three weights each, and writes a local `fonts.css`. Other licenses are refused and a failed download leaves nothing behind. Hosts that allowlist domains need `raw.githubusercontent.com`, `fonts.googleapis.com` and `fonts.gstatic.com`.
