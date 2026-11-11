# Bar chart

- Grammar ID: `bar`
- Layout family: `chart`
- Required primitives: `series`, `axis`
- Allowed primitives: `node`, `series`, `axis`, `annotation`, `emphasis`
- Directions: `top-down`, `left-right`, `right-left`, `bottom-up`, `radial`
- Mermaid: `unsupported`
- Excalidraw: `editable`

## Renderer mapping

Axes are declared horizontally, then vertically. Bar and categorical line keys share category slots across series. Ordinal axes preserve each series' key order and reject cycles; at every step, the ready key with the earliest first appearance across the declared series comes next. Unconstrained keys follow first appearance. List the full order in the first series to control it. Numeric line and scatter keys supply horizontal values; series values supply vertical values. Temporal horizontal axes accept date keys and logarithmic axes require positive values. Bars require categorical or ordinal horizontal axes and a linear vertical axis. Scatter nodes with semantic positions use normalized plot coordinates. Other nodes remain supporting cards.

Canonical SVG, HTML and PNG render axes and data marks. Editable Excalidraw export and authoring migration are unsupported for these charts; the runtime emits a fidelity report without an editable file.

## Use this grammar

Bar chart semantic grammar using the chart layout family.

## Readability

Simplified 7; balanced 12; faithful 24; hard split threshold 24. Labels stay within 80 characters, with at most 12 crossings and 6 incoming relations per item.
