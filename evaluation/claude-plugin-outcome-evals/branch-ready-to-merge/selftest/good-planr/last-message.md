**Not ready to merge.** Landing review written to `.planr/reviews/feature-search-land.md`:

- F-1 (high): the search query goes straight into `new RegExp`, unescaped.
- F-2 (high): `note.body.toLowerCase()` crashes on notes with a null body.
- F-3 (medium): `test/search.test.js` has no assertion.

Tests pass, but only because the new test checks nothing. Nothing was merged or pushed.
