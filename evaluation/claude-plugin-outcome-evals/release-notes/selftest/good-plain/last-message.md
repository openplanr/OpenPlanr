The next version should be 2.0.0: two changes break existing clients.

Here's what shipped since v1.4.0. Breaking: the CSV export endpoint, GET /notes/export, is gone (call
GET /notes and convert the JSON yourself), and updating a note now rejects a done value that isn't true or
false, so send a boolean rather than "true". New: you can filter the note list by done status, and the list
comes back soonest due first. Titles longer than 120 characters are now rejected. Updates with an invalid
due date are rejected instead of saved, and titles are trimmed on update. Note pinning was added and then
reverted, so it isn't in this release. Behind the scenes we added an editorconfig, renamed the response
helper, started running tests in CI and added a test for due-date validation.
