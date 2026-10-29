# Prepare a coherent design system

Reuse the existing app's component patterns, tokens, icon family and typography.
Before drawing a new shell, inspect its real navigation and a representative dense
screen. Reuse local fonts and licensed project assets. Do not substitute a generic
sidebar, color theme or arbitrary spacing rules for established conventions.

If no usable system exists, establish a small project-local system beside the
design source (or in the project's existing system location):

- `tokens.css`: semantic colors including on-color text, spacing, radii, elevation,
  type sizes and responsive breakpoints, with required contrast combinations.
- `brand.md`: purpose, audience, voice, intended visual character, references,
  chosen and rejected directions, and concrete rationale.
- `components.md`: recipes for the components this journey needs, including
  dimensions, variants, keyboard/focus behavior and meaningful state handling.

Link these sources from the design document and use them in authored screens.
For a system outside the design directory, copy only the resolved tokens/assets
needed by the portable preview into its local source and record their upstream
paths in the brief references. Treat that copy as a render snapshot, not a second
project design system. The document's source paths cannot traverse outside its
directory. Extract approximated
values from image references honestly and record uncertainty in Open Questions.

Choose typography for the content: dense data needs legible labels and aligned
numerals, an editorial page needs deliberate type hierarchy, and a field workflow
needs readable controls in narrow space. Match visual density to the task.
Default to one coherent type scale and spacing rhythm; the project's scale wins.

A greenfield system also fixes these, unless project families, palettes or tokens
already decide them:

- Type: one to three families with defined roles (display, body, and mono when
  needed). Give each a fallback stack of close-metric faces so a missing font does
  not reflow the layout.
- Color: zero to two accents in `oklch()`. Two accents share lightness and chroma
  and differ in hue. Tone whites and blacks toward the palette instead of pure
  `#fff` and `#000`. Semantic roles and contrast requirements still apply.

Reusable component changes apply to each affected instance. Keep a short record
of those instances so review can explain the scope and inspect their screenshots.
Keep source references editable and local; nothing is fetched when a design opens.

## Fonts

Reuse the project's own fonts first. When a design needs a new family, snapshot it
while authoring:

- openly licensed families only (OFL or Apache);
- `woff2` files, Latin subset, only the weights the design uses;
- files under `source/assets/fonts/`, with each family's license file beside them;
- local `@font-face` rules, with the upstream URLs in the brief references;
- at most two families and three weights each; one variable file can cover a
  family's weights.

Snapshot with the bundled helper, run from the skill directory (see
[utilities.md](utilities.md)):

```sh
node scripts/design.mjs fonts fetch --family "Inter:400,600" --family "Source Serif 4:400" --dest <design>/source/assets/fonts
```

It is the one command to ask approval for. A host that allowlists network access by
domain needs `raw.githubusercontent.com`, `fonts.googleapis.com` and
`fonts.gstatic.com`. It enforces the rules above, verifies each
license from the Google Fonts catalog, writes `fonts.css`, and prints the files and
total bytes. Start the design stylesheet with `@import "assets/fonts/fonts.css";`
(relative to that stylesheet), then use the families by name. Nothing is fetched when
a design opens.

When the host denies network access, the command fails, or it refuses a license, use
the role's system stack and name that fallback in the return:

| Role | System stack |
| --- | --- |
| Body, humanist sans | `Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", source-sans-pro, sans-serif` |
| Display, geometric sans | `Avenir, Montserrat, Corbel, "URW Gothic", source-sans-pro, sans-serif` |
| Display or body, serif | `Charter, "Bitstream Charter", "Sitka Text", Cambria, serif` |
| Mono | `ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, "DejaVu Sans Mono", monospace` |
