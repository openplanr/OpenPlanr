# Shared: the `design-spec.md` 10-section template (single source of truth)

> **Why this file exists:** `design-spec.md` has two possible authors —
> `designer-agent` (extracts it from PNG mockups) and the `/planr-pipeline:design`
> generator (authors it directly from the brief alongside a generated artifact).
> Both **include this template** so the 10-section contract lives in exactly one
> place and cannot drift (SPEC-015 finding H1). Neither author redefines the
> sections; they fill this shape.
>
> **One writer per run** (SPEC-015 finding E2): if PNGs exist, `designer-agent`
> owns `design-spec.md` and the generator produces only the visual artifact. If no
> PNGs exist and the user is generating, the generator authors `design-spec.md`
> directly from the brief — never by re-reading the pixels it just produced.

The output is a single Markdown file written to the mode-specific path (see each
mode's `designer.md`). It MUST contain all 10 sections below, in order.

---

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
width, breakpoints (375 / 768 / 1024 / 1440), and the corner-radius scale.

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

Every ambiguity that must be resolved before DEV (per `docs/rules.md` G6, this
section must be cleared before `/ship`). When authoring directly from a thin brief,
put inferred-not-specified decisions here rather than asserting them as fact
(`content_provenance: inferred`).
