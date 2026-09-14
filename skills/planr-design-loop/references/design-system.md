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

Reusable component changes apply to each affected instance. Keep a short record
of those instances so review can explain the scope and inspect their screenshots.
Keep source references editable and local; no fonts or runtimes fetched on launch.
