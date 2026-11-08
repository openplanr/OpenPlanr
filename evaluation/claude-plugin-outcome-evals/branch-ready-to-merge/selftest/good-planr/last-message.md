**Not ready to merge.** Landing review written to `.planr/reviews/feature-search-share-land.md`: six
findings. The raw query goes into `new RegExp`, null bodies crash search, concurrent share creation races,
pagination drops an item per page, one test passes only by creation order, and another asserts nothing.
The rename, the tracked TODO and the route order are fine.
