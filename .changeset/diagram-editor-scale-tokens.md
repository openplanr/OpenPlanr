---
"@openplanr/artifact": patch
"planr-pipeline": patch
---

Diagram editor: type, spacing, control heights and corner radii come from one token scale. Text uses 10, 11, 12, 14, 16 and 20px with integer line heights and weights 400, 500 and 600; the base text moves from 13px to 12/18px. Buttons, fields, outline rows, menu items and section headers are 36px tall (44px on phones), spacing sits on a 4px grid, and radii are 4, 8, 12 and 14px. Field borders reach 3:1 (#858e99 light, #5e6875 dark; they were 1.33:1 and 1.39:1), and every editor input's placeholder uses the muted text colour. Hosts can set `--planr-color-{interactive,input,input-border,rule-strong,primary-soft,danger-soft,warning,scrim}`, `--planr-radius-{small,medium,large}`, `--planr-font-mono` and `--planr-shadow-{sm,md,lg}`; unset, the editor keeps its own values.
