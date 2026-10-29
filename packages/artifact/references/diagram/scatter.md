# Scatter plot

- Grammar ID: `scatter`
- Layout family: `chart`
- Required primitives: `series`, `axis`
- Allowed primitives: `node`, `series`, `axis`, `annotation`, `emphasis`
- Directions: `top-down`, `left-right`, `right-left`, `bottom-up`, `radial`
- Mermaid: `unsupported`
- Excalidraw: `editable`

## Renderer mapping

Axes are declared horizontally, then vertically. Bar and categorical line keys share category slots across series. Numeric line and scatter keys supply horizontal values; series values supply vertical values. Temporal horizontal axes accept date keys and logarithmic axes require positive values. Bars require categorical or ordinal horizontal axes and a linear vertical axis. Scatter nodes with semantic positions use normalized plot coordinates. Other nodes remain supporting cards.

Canonical SVG, HTML and PNG render axes and data marks. Editable Excalidraw export and authoring migration are unsupported for these charts; the runtime emits a fidelity report without an editable file.

## Use this grammar

Scatter plot semantic grammar using the chart layout family.

## Readability

Simplified 7; balanced 12; faithful 24; hard split threshold 24. Labels stay within 80 characters, with at most 12 crossings and 6 incoming relations per item.
