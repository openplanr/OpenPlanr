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

## pako 2.1.0

- Package: `pako`
- Licenses: MIT (all files except `lib/zlib`) and zlib (`lib/zlib`)
- Source: <https://github.com/nodeca/pako>

pako is bundled unmodified into `templates/design/design-board-adapter.js`.
The bundle keeps pako's `@license` header in place; the full copyright notices
and license terms below travel with the bundle.

### MIT License

Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

### zlib License

(C) 1995-2013 Jean-loup Gailly and Mark Adler

This software is provided 'as-is', without any express or implied
warranty. In no event will the authors be held liable for any damages
arising from the use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not
   claim that you wrote the original software. If you use this software
   in a product, an acknowledgment in the product documentation would be
   appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.
