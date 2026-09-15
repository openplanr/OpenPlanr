# Diagram renderer third-party notices

OpenPlanr's offline diagram renderer uses the following unmodified packages and
assets. They remain under their own licenses; OpenPlanr's source remains MIT.

## resvg-js 2.6.2

- Packages: `@resvg/resvg-js` and its platform-specific optional dependency
- License: Mozilla Public License 2.0
- Source: <https://github.com/thx/resvg-js>

The packages are dynamically installed npm dependencies. OpenPlanr does not copy
or modify their source.

## Inter font 0.4.2

- Package: `@expo-google-fonts/inter`
- Used asset: `400Regular/Inter_400Regular.ttf`
- Package licenses: MIT and SIL Open Font License 1.1
- Source: <https://github.com/expo/google-fonts>

The packaged font is loaded directly at runtime so rendering remains offline and
does not depend on host fonts or a font CDN.
