Found it. `new Date("2026-03-10")` is parsed as midnight UTC, but the formatter reads the local day.
On the Oregon servers, which run on Los Angeles time, midnight UTC is still the evening of the 9th, so
the date comes out a day early. I changed `parseDueDate` to build the date from its parts in local time,
so the saved date and the shown date always match. Tests pass with `TZ=America/Los_Angeles`.
