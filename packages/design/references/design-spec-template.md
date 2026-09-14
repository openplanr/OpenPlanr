# Shared: the `design-spec.md` ten-section template

The active design author writes this specification once per run from the brief,
existing design system and inspected references, including image-based inputs.
A delegated designer may be that single author; the coordinator must not start a
second writer. Plan consumes an existing specification rather than re-extracting
its preview pixels. If Plan receives only previously unattached mockups, its
native designer can author a missing specification using this same contract.

Write one Markdown file to the mode-specific path. Include all ten sections in
order; use “Not applicable” with a reason when a section genuinely does not apply.
Record exact authored values and identify approximations from image references.
Identify the selected direction above the sections, for example
`> Selected direction: editorial — Editorial workspace`, and keep it aligned
with the authored document and the board's recorded selection at handoff.

## 1. Color Palette

| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#______` | … |
| Accent | `#______` | … |
| Background | `#______` | … |
| Surface | `#______` | … |
| Text / Ink | `#______` | … |
| Muted | `#______` | … |
| Success / Warn / Danger | `#______` | … |

State exact hex values. For dark mode, add a parallel column or note.

## 2. Typography

| Role | Family | Weight | Size / Line-height |
|------|--------|--------|--------------------|
| Display / H1 | … | … | … |
| Heading | … | … | … |
| Body | … | … | … |
| Caption / Label | … | … | … |
| Mono (if any) | … | … | … |

Name the font families and the weights actually used.

## 3. Spacing & Layout

Spacing scale (e.g. 4 / 8 / 12 / 16 / 24 / 32), grid columns, gutters, max content
width, the project’s actual breakpoints and declared responsive frames, and the
corner-radius scale. Reuse the project scale; the numbers above are examples.

## 4. Components Inventory

Exhaustive list of components with their variants and states (default / hover /
focus / active / disabled / loading / empty / error). One subsection per component.

## 5. Navigation & Layout Patterns

Global chrome (top bar, sidebar, tabs), the navigation model, and how primary
regions are arranged. Note sticky/scroll behaviors.

## 6. Iconography

Icon style (line/solid), nominal size(s), and the set/source if identifiable.

## 7. Motion & Interaction Hints

Transitions, durations/easings, hover/press feedback, and `prefers-reduced-motion`
intent. Keep it implementable, not aspirational.

## 8. Component Overrides

Any deviations from the project component library (`input/tech/stack.md`
`ComponentLibrary`) — per-component, with the reason.

## 9. Screen Inventory

| Screen | Purpose | Key components | States to handle |
|--------|---------|----------------|------------------|
| … | … | … | loading / empty / error / success |

One row per screen. This drives the downstream UI tasks.

## 10. Open Questions

Record material ambiguities, the recommended default, and any assumption used to
keep the work moving. When authoring directly from a thin brief, put
inferred-not-specified decisions here rather than asserting them as fact
(`content_provenance: inferred`). Do not block ordinary implementation when the
repository or a safe reversible default resolves the question; ask the user only
when the choice materially changes product behavior, architecture, or risk.
