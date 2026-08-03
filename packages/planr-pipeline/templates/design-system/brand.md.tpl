# GENERATOR:name — Brand identity

> The source of truth for how this product looks, sounds, and feels. Pairs with
> `tokens.css` (visual) and `components.md` (per-surface recipes). Written by
> `/planr-pipeline:design`; the generator fills every GENERATOR: field from the
> brand answers / existing-app scan, and every design **continues** this.

## 1. Positioning
**Value proposition (one line):** GENERATOR:value-prop
**Who it's for (primary persona):** GENERATOR:persona — what they judge it on.

## 2. Personality (priority order — higher wins on conflict)
1. GENERATOR:adj-1 · 2. GENERATOR:adj-2 · 3. GENERATOR:adj-3 · 4. GENERATOR:adj-4
**What we are NOT:** GENERATOR:anti (e.g. playful, trendy, maximalist, cute).

## 3. Voice & tone
Speaks like GENERATOR:voice. Lead with the outcome; plain language; active voice.

| Do | Don't |
| --- | --- |
| Say it in as few words as carry the meaning | Pad with "simply / just / easily" |
| Specific status ("3 records couldn't be saved") | Vague ("Something went wrong") |
| Sentence case everywhere (buttons, titles, menus) | Title Case / ALL CAPS for emphasis |
| Calm, factual errors + the next step | Alarmist ("Fatal!", "Oops!") or emoji |
| One name per concept, used consistently | Mixing synonyms for the same thing |

**Microcopy** (fill from the product):
- Empty state: GENERATOR:empty — orient, then one clear action.
- Error: GENERATOR:error — what happened + what to do.
- Confirm (destructive): name the object + the consequence + escape hatch.

## 4. Naming & vocabulary
The product is **GENERATOR:name** (exact casing). Domain terms — use exactly, never mix
synonyms: GENERATOR:vocab. Everything else is sentence case.

## 5. Color & contrast (AA)
ONE saturated brand hue (`--primary`); status colors signal state only — color is
information, not decoration. All text/background pairs in `tokens.css` are AA (≥4.5:1),
verified with `lib/design/contrast.mjs`. Pairings to avoid: GENERATOR:avoid (e.g. amber
text on a light surface — use amber as a fill/badge with dark text instead).
