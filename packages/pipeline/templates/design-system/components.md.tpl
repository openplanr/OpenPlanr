# GENERATOR:name — Component recipes

> How to compose surfaces from the tokens in `tokens.css`. **One hard rule:**
> components consume **tokens only** — a raw hex, raw px, or off-grid spacing in a
> component is a defect (the linter flags it). Use `var(--…)`, the 4-point spacing
> scale, the type scale, and the radius/elevation/motion tokens.

## Foundations everything inherits
- **Spacing:** the 4-point grid (`--space-*`). Never an arbitrary value.
- **Type:** `--text-sm` (13px) default chrome, `--text-base` body; `tabular-nums` on all numbers.
- **Icons:** one set, outline, consistent size per density. Never emoji as UI icons.
- **Elevation:** one ladder (`--shadow-sm/md/lg`). Two stacked surfaces differ by one level.
- **Motion:** `--ease` + `--duration-fast/base/slow` (≤260ms, nothing bounces); honor `prefers-reduced-motion`.
- **Focus:** every interactive element shows the `--ring` focus ring — the AA state indicator; never remove it.

## Per-surface recipes (fill from the product's real surfaces)
- **Buttons** — GENERATOR:buttons (variants, sizes, the one primary that uses `--primary`).
- **Inputs / forms** — label above field, inline error in `--destructive`, `--ring` on focus.
- **Cards / lists** — `--card` on `--background`, hairline `--border`, `--shadow-sm` at rest.
- **Tables** — dense rows, `tabular-nums`, right-aligned numbers, sticky header.
- **Nav / shell** — GENERATOR:shell (the real sidebar/topbar this product uses).
- **Overlays** — dialogs/menus at the top of the elevation ladder, `--ring`-able, Esc to close.

## The premium-polish details (acceptance criteria, not nice-to-haves)
1. **Optical alignment** over mechanical; right-align + `tabular-nums` on figures.
2. **Motion restraint** — one easing/duration vocabulary, same curve for the same kind of change.
3. **One elevation language** — no ad-hoc shadows; adjacent surfaces differ by one level.
4. **Hairlines + a single accent** — separate with `--border`, not boxes-in-boxes; one `--primary` per screen reads more premium than five.
5. **Never a blank frame** — every >100ms wait is a skeleton matching the real layout; optimistic with an honest rollback.
