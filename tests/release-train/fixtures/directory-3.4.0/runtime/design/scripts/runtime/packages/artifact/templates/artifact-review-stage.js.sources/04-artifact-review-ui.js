// 04-artifact-review-ui.js:2190-2192
var shareState = shareOptions ? createPasteShare({
  create: (request) => shareOptions.createShare(request),
  commit: shareOptions.resumePreparedShare,
  indexedDB: window.indexedDB
}) : null;
