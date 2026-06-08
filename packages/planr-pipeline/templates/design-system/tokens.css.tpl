/* Design-system tokens — portable CSS custom properties (planr, v0.18.0).
   Written by /planr-pipeline:design to <design-system>/tokens.css and linked by
   every generated screen, so designs continue ONE feel. Light + dark; spacing on
   the 4-point grid (matches lib/design/tokens.mjs); AA-verified text pairs.
   The generator replaces GENERATOR: values with the project's real brand. */
:root {
  /* GENERATOR:palette — the project's real palette. Keep text pairs AA (≥4.5:1);
     verify with lib/design/contrast.mjs. ONE saturated brand hue (--primary). */
  --background: #ffffff;
  --foreground: #14181f;          /* ~16:1 on --background */
  --muted: #f4f5f7;
  --muted-foreground: #5b6472;    /* AA on --background */
  --card: #ffffff;
  --card-foreground: #14181f;
  --primary: #3b5bdb;             /* the one saturated brand color */
  --primary-foreground: #ffffff;
  --accent: #eef1fd;
  --accent-foreground: #25337a;
  --border: #e6e8ee;
  --input: #e6e8ee;
  --ring: #3b5bdb;
  --success: #1f7a4d; --success-foreground: #ffffff;
  --warning: #8a5300; --warning-foreground: #ffffff;
  --destructive: #b42d2d; --destructive-foreground: #ffffff;
  --info: #1f5fbf; --info-foreground: #ffffff;

  /* Type */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --text-xs: 12px; --text-sm: 13px; --text-base: 14px; --text-lg: 17px;
  --text-xl: 20px; --text-2xl: 24px; --text-3xl: 30px;
  --weight-normal: 400; --weight-medium: 500; --weight-semibold: 600; --weight-bold: 700;

  /* Spacing — the 4-point grid (the linter enforces this scale). */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-6: 24px; --space-8: 32px; --space-12: 48px; --space-16: 64px;

  /* Radii / elevation / motion */
  --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px; --radius-xl: 16px;
  --shadow-sm: 0 1px 2px rgba(20, 24, 31, .06);
  --shadow-md: 0 4px 12px rgba(20, 24, 31, .10);
  --shadow-lg: 0 12px 32px rgba(20, 24, 31, .14);
  --ease: cubic-bezier(.2, 0, 0, 1);
  --duration-fast: 120ms; --duration-base: 180ms; --duration-slow: 260ms;
}

.dark {
  /* GENERATOR:palette-dark — deep cool surface, not pure black; keep AA in dark too. */
  --background: #0e1116; --foreground: #e9edf4;
  --muted: #1a1f27; --muted-foreground: #9aa4b2;
  --card: #161b22; --card-foreground: #e9edf4;
  --primary: #8aa0f2; --primary-foreground: #0e1116;
  --accent: #1d2740; --accent-foreground: #cdd7fb;
  --border: #232a35; --input: #2a313d; --ring: #8aa0f2;
}

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
