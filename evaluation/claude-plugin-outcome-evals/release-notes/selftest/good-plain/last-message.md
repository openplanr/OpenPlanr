The next version should be 2.0.0, because the CSV export endpoint was removed and that breaks anyone
still calling it.

Here's what shipped since v1.4.0. The CSV export endpoint, GET /notes/export, is gone (breaking): call
GET /notes and convert the JSON yourself. You can now filter the note list by done status, and the list
comes back soonest due first. Updates with an invalid due date are rejected instead of saved, and titles
are trimmed on update. Behind the scenes we added an editorconfig, renamed the response helper, started
running tests in CI and added a test for due-date validation.
